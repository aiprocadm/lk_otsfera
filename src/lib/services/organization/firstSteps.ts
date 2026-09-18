import type { PrismaClient } from '@prisma/client';
import {
  buildFirstStepsView,
  type FirstStepItem,
  type FirstStepsView,
} from '@/lib/dashboard/firstSteps';

/**
 * «Первые шаги» заказчика (`У-239`, `Р-Э6-5`): реквизиты → сотрудники → бот →
 * первое обращение или заявка. Каждый пункт — проверка по данным и ссылка на
 * экран, где он выполняется; ничего не хранится, кроме «Закрыть» на членстве.
 */
export type OrgFirstStepsArgs = { organizationId: string; userId: string };

/**
 * Куда вести за первым обращением.
 *
 * Раньше адрес выбирался по флагам: раздел под выключенным флагом отвечает
 * 404, а ссылка «первого шага» не имеет права туда вести. Флаги
 * `client_requests` и `enrollment_requests` сняты (`У-262`) — раздел обращений
 * есть всегда, и выбирать больше не из чего.
 */
const FIRST_REQUEST_HREF = '/organization/requests';

export async function getOrgFirstSteps(
  prisma: PrismaClient,
  args: OrgFirstStepsArgs
): Promise<FirstStepsView> {
  const { organizationId, userId } = args;
  const [membership, org, students, viewer, requests, enrollments] = await Promise.all([
    prisma.organizationUser.findUnique({
      where: { organizationId_userId: { organizationId, userId } },
      select: { onboardingDismissedAt: true },
    }),
    prisma.organization.findUnique({
      where: { id: organizationId },
      select: { inn: true, legalAddress: true },
    }),
    prisma.student.count({ where: { organizationId } }),
    prisma.user.findUnique({
      where: { id: userId },
      select: { telegramChatId: true, maxChatId: true },
    }),
    prisma.clientRequest.count({ where: { organizationId } }),
    prisma.enrollmentRequest.count({ where: { organizationId } }),
  ]);

  const items: FirstStepItem[] = [
    {
      key: 'requisites',
      title: 'Заполнить реквизиты',
      hint: 'ИНН и юридический адрес нужны для договоров и счетов',
      href: '/organization/company?tab=settings',
      done: Boolean(org?.inn && org?.legalAddress),
    },
    {
      key: 'employees',
      title: 'Добавить сотрудников',
      hint: 'Кого будете обучать — из справочника они попадают в заявки',
      href: '/organization/company?tab=employees',
      done: students > 0,
    },
    {
      key: 'bot',
      title: 'Привязать бота',
      hint: 'Уведомления о заказах и документах — в Telegram или MAX',
      href: '/organization/settings?tab=profile',
      done: Boolean(viewer?.telegramChatId || viewer?.maxChatId),
    },
    {
      key: 'firstRequest',
      title: 'Подать первое обращение или заявку',
      hint: 'Расскажите, чему нужно обучить, — менеджер ответит в кабинете',
      href: FIRST_REQUEST_HREF,
      done: requests + enrollments > 0,
    },
  ];
  return buildFirstStepsView(items, membership?.onboardingDismissedAt);
}

/**
 * «Закрыть» — на членстве, не на пользователе. Неактивное или чужое членство
 * не трогаем: `updateMany` со скоупом вместо `update` по id, чтобы нельзя было
 * закрыть блок в организации, где человека нет.
 */
export async function dismissOrgFirstSteps(
  prisma: PrismaClient,
  args: OrgFirstStepsArgs
): Promise<{ ok: true } | { ok: false; error: 'not_found' }> {
  const r = await prisma.organizationUser.updateMany({
    where: { organizationId: args.organizationId, userId: args.userId, isActive: true },
    data: { onboardingDismissedAt: new Date() },
  });
  return r.count > 0 ? { ok: true } : { ok: false, error: 'not_found' };
}
