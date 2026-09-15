import { randomUUID } from 'node:crypto';
import type { PrismaClient } from '@prisma/client';
import { log } from '@/lib/logging';
import { isFeatureEnabled } from '@/lib/featureFlags';
import { getQueue } from '@/lib/jobs/queues';
import { conditionsSchema, matchesConditions, type AutomationEventPayload } from './conditions';
import type { AutomationTriggerKey } from './catalog';

/**
 * Диспетчер событий правил (`У-223`).
 *
 * ПОЧЕМУ ЯВНЫЙ ВЫЗОВ, А НЕ ПОДПИСКА. Решение `Р-Б-6` говорит, что правила
 * «слушают реестр событий уведомлений». Слушать там нечего: реестр —
 * пассивный каталог метаданных, а уведомления создаются в девятнадцати местах
 * двумя независимыми путями. Строить шину событий значит переписать все
 * девятнадцать — это не объём этапа 4. Поэтому событие испускается явным
 * вызовом из того же сервиса, где случилась бизнес-операция, а каталог
 * триггеров ссылается на реестр уведомлений там, где событие уже кого-то
 * уведомляет. Полноту врезки держит страж `automation.emit-coverage`.
 *
 * ВСЁ ЗДЕСЬ FAIL-OPEN (§3 CLAUDE.md). Сбой правил не имеет права отменить
 * смену статуса заказа или выпуск счёта: бизнес-операция уже совершилась,
 * робот — это надстройка. Поэтому наружу не летит ни одно исключение.
 */

export type EmitArgs = {
  trigger: AutomationTriggerKey;
  /** Правила компанейские: без компании выбирать нечего. */
  companyId: string | null | undefined;
  payload: AutomationEventPayload;
  /**
   * Откуда событие. `'automation'` — событие порождено действием правила:
   * такие отбрасываются немедленно.
   *
   * Третий заслон против зацикливания (`Р-Б-6`). Первые два — непересечение
   * каталогов и запрет импорта диспетчера из файла действий — проверяются
   * стражем `automation.no-loop`. Этот нужен на будущее: когда каталог
   * действий однажды расширят, первые два придётся пересматривать сознательно,
   * а этот сработает сам.
   */
  source?: 'automation' | undefined;
};

/**
 * Испустить событие: найти подходящие активные правила компании и поставить
 * каждое в очередь исполнения.
 *
 * Возвращает число поставленных правил — это нужно тестам и журналу, но НЕ
 * вызывающему: он не обязан ничего делать с результатом.
 */
export async function emitAutomationEvent(
  prisma: PrismaClient,
  args: EmitArgs
): Promise<number> {
  try {
    // Правило робота, порождённое роботом, не запускает робота.
    if (args.source === 'automation') return 0;
    // Флаг раскатки: пока выключен, диспетчер не трогает даже базу.
    if (!isFeatureEnabled('automation')) return 0;
    if (!args.companyId) return 0;

    const rules = await prisma.automationRule.findMany({
      where: { companyId: args.companyId, trigger: args.trigger, isActive: true },
      select: { id: true, conditions: true },
    });
    if (rules.length === 0) return 0;

    const eventId = randomUUID();
    let queued = 0;
    for (const rule of rules) {
      if (!ruleMatches(rule.conditions, args.payload, rule.id)) continue;
      const ok = await enqueueRun({
        ruleId: rule.id,
        eventId,
        companyId: args.companyId,
        payload: args.payload,
      });
      if (ok) queued += 1;
    }
    return queued;
  } catch (error) {
    // Ни одна поломка правил не отменяет бизнес-операцию.
    log.error('[automation/dispatch] emit failed', {
      trigger: args.trigger,
      error: error instanceof Error ? error.message : String(error),
    });
    return 0;
  }
}

/**
 * Условия правила из базы — это `Json`, то есть что угодно. Кривые условия
 * (правило сохранили старой версией, кто-то поправил строку руками) не должны
 * ронять диспетчер и не должны срабатывать «на всякий случай»: неизвестная
 * форма условий означает «не запускать».
 */
function ruleMatches(raw: unknown, payload: AutomationEventPayload, ruleId: string): boolean {
  const parsed = conditionsSchema.safeParse(raw ?? {});
  if (!parsed.success) {
    log.warn('[automation/dispatch] условия правила не разобраны — правило пропущено', { ruleId });
    return false;
  }
  return matchesConditions(parsed.data, payload);
}

/**
 * Постановка в очередь с ДЕТЕРМИНИРОВАННЫМ `jobId`.
 *
 * Это первый, дешёвый слой идемпотентности: повторная постановка того же
 * события того же правила не создаёт второй задачи в очереди. Второй слой —
 * `AutomationRun @@unique([ruleId, eventId])` в базе — обязателен, потому что
 * BullMQ и так может доставить задачу дважды (ретраи, перезапуск воркера), а
 * «повторная доставка события не создаёт вторую задачу» — прямой пункт `У-227`.
 */
async function enqueueRun(job: {
  ruleId: string;
  eventId: string;
  companyId: string;
  payload: AutomationEventPayload;
}): Promise<boolean> {
  // Своя обёртка, а не только внешняя: у события может быть несколько правил,
  // и падение очереди на первом не должно лишать срабатывания остальные.
  // Плюс §3 CLAUDE.md: постановка в очередь деградирует, а не роняет вызов.
  try {
    const queue = getQueue('automation.run');
    await queue.add('run', job, { jobId: automationJobId(job.ruleId, job.eventId) });
    return true;
  } catch (error) {
    log.error('[automation/dispatch] не удалось поставить правило в очередь', {
      ruleId: job.ruleId,
      error: error instanceof Error ? error.message : String(error),
    });
    return false;
  }
}

export function automationJobId(ruleId: string, eventId: string): string {
  return `auto_${ruleId}_${eventId}`;
}
