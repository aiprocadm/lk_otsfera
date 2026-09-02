import type { PrismaClient } from '@prisma/client';
import type { SessionPayload } from '@/lib/auth/jwt';
import { recordAudit } from '@/lib/auth/audit';
import { log } from '@/lib/logging';
import { organizationNameKey } from '@/lib/services/import/oneCAccountCard/counterparty-key';
import { resolveLeadIssueScope } from '@/lib/services/documents/issueScope';

/**
 * `У-161` (этап 7) — «Создать организацию из лида» с переносом уже выпущенных
 * коммерческих предложений.
 *
 * **Зачем отдельное действие, а не побочный эффект.** Коммерческое предложение
 * выставляют клиенту, которого ещё нет в системе: у него есть только название
 * и контакт. Когда переговоры доходят до договора, клиента заводят
 * организацией — и вот тут выпущенные ему бумаги обязаны переехать вместе с
 * ним. Иначе у одного клиента получаются две нити документов: одна на лиде,
 * невидимая из его карточки, вторая — новая, с нуля.
 *
 * Места, где лид получает организацию, в проекте до этого не было вовсе:
 * `lead.organizationId` ставился только при создании лида и дальше не менялся
 * (спека §3.1). Поэтому «навесить перенос на существующий переход» не на что.
 *
 * **Что здесь НЕ делается и почему.**
 * - Не создаётся новая компания-исполнитель. Образец из админского экрана
 *   (`admin/organizations.ts`) заводит `Company` на каждую организацию — с ним
 *   организация сразу оказалась бы «чужой компании», и перенос отказал бы сам
 *   себе. Берём образец очереди разбора выписки: организация в компании
 *   сотрудника.
 * - Не меняется `companyId` документов. Номер уникален в пределах компании
 *   (`Document_companyId_type_number_version_key`), а счётчик номеров чужой
 *   компании о занятом номере не узнает — следующий выпуск упёрся бы в
 *   ошибку базы.
 * - Не обнуляется `leadId` у документа. Во-первых, это запрещено проверкой
 *   `Document_proposal_needs_lead`, пока контрагент не проставлен, а поставить
 *   оба поля разными запросами нельзя. Во-вторых, связь с лидом — история:
 *   по ней видно, откуда пришёл клиент.
 * - Не трогается статус документа. Перенос — это смена адресата, а не событие
 *   жизненного цикла бумаги.
 */

export type CreateOrgFromLeadResult =
  | {
      ok: true;
      organizationId: string;
      /** `false` — привязали существующую организацию, а не создали новую. */
      created: boolean;
      /** Сколько предложений переехало на организацию. */
      transferred: number;
    }
  | {
      ok: false;
      error:
        | 'forbidden'
        | 'not_found'
        | 'no_company'
        | 'lead_not_active'
        | 'already_linked'
        | 'name_required'
        | 'org_in_other_company';
    };

export async function createOrganizationFromLead(
  prisma: PrismaClient,
  session: SessionPayload,
  args: {
    leadId: string;
    name?: string | undefined;
    inn?: string | null | undefined;
    kpp?: string | null | undefined;
  }
): Promise<CreateOrgFromLeadResult> {
  // Гейт тот же, что у выпуска предложения (`resolveLeadIssueScope`): один
  // источник правды на «может ли этот сотрудник трогать этого лида». Второе
  // правило рядом с первым обязано разъехаться (§4).
  const scope = await resolveLeadIssueScope(prisma, session, args.leadId);
  if (!scope.ok) return { ok: false, error: scope.error };
  const lead = scope.lead;
  const companyId = scope.companyId;

  // Организация у лида уже есть — заводить вторую значило бы раздвоить
  // клиента. Отдельный код, а не «не найдено»: человек видит карточку и
  // должен понять, что делать не нужно ничего.
  if (lead.organizationId) return { ok: false, error: 'already_linked' };

  const name = (args.name ?? lead.clientCompanyName).trim();
  if (!name) return { ok: false, error: 'name_required' };
  const inn = args.inn?.trim() || null;

  /**
   * ИНН у организации уникален ГЛОБАЛЬНО, а не в пределах компании
   * (`Organization.inn @unique`). Значит «просто создать» нельзя: тёзка может
   * жить и в соседней компании-исполнителе.
   *
   * - тёзка В СВОЕЙ компании — привязываем её, а не плодим дубль: это тот же
   *   клиент, просто заведённый раньше;
   * - тёзка в ЧУЖОЙ компании — отказ. Привязать её значило бы отдать чужому
   *   клиенту наши бумаги: канал видимости строится по контрагенту и про
   *   компанию не знает.
   */
  const twin = inn
    ? await prisma.organization.findUnique({
        where: { inn },
        select: { id: true, companyId: true },
      })
    : await prisma.organization.findFirst({
        where: { companyId, nameKey: organizationNameKey(name) },
        select: { id: true, companyId: true },
      });
  if (twin && twin.companyId !== companyId) return { ok: false, error: 'org_in_other_company' };

  const result = await prisma.$transaction(async (tx) => {
    const organizationId =
      twin?.id ??
      (
        await tx.organization.create({
          // `У-84`: ключ названия ставится при каждом создании — по нему
          // ищутся дубли у организаций без ИНН.
          data: {
            name,
            nameKey: organizationNameKey(name),
            inn,
            kpp: args.kpp?.trim() || null,
            companyId,
          },
          select: { id: true },
        })
      ).id;

    await tx.lead.update({ where: { id: lead.id }, data: { organizationId } });

    // Сделка лида получает ту же организацию: без неё выигрыш сделки упрётся
    // в «нужна организация», хотя клиент уже заведён.
    await tx.deal.updateMany({ where: { leadId: lead.id }, data: { organizationId } });

    /**
     * Переезжают ВСЕ предложения лида этой компании, независимо от состояния.
     *
     * Не только черновики: отправленное вручную предложение — ровно та
     * история, ради которой клиенту и заводят карточку. Оставить его на лиде
     * значило бы сказать «мы вам ничего не предлагали», и принять или
     * отклонить его в кабинете стало бы нечем. Заменённые версии тоже: цепочка
     * версий не должна рваться пополам, иначе у организации окажется бумага
     * без предшественника.
     *
     * Фильтр по компании обязателен: лиды в проекте single-tenant, и на одном
     * лиде могут висеть предложения РАЗНЫХ компаний-исполнителей. Без него
     * бумага чужого учебного центра уехала бы к нашему клиенту.
     */
    const moved = await tx.document.updateMany({
      where: { leadId: lead.id, type: 'commercial_proposal', companyId },
      // Тип и идентификатор контрагента ставятся ОДНИМ оператором: половина
      // контрагента нарушает `Document_counterparty_both_or_none`.
      data: { counterpartyType: 'organization', counterpartyId: organizationId },
    });

    return { organizationId, created: !twin, transferred: moved.count };
  });

  try {
    await recordAudit(prisma, {
      userId: session.sub,
      action: result.created ? 'organization_created_manual' : 'lead_organization_linked',
      entity: 'organization',
      entityId: result.organizationId,
      after: {
        leadId: lead.id,
        transferredProposals: result.transferred,
      },
    });
  } catch (e) {
    // Сбой журнала не отменяет уже сделанного (§3): организация создана,
    // бумаги переехали, и откатывать это ради записи в аудит хуже.
    log.error('[leads/toOrganization] audit failed', {
      leadId: lead.id,
      organizationId: result.organizationId,
      error: e instanceof Error ? e.message : String(e),
    });
  }

  return { ok: true, ...result };
}
