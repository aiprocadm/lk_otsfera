import type { PrismaClient } from '@prisma/client';
import {
  buildFirstStepsView,
  type FirstStepItem,
  type FirstStepsView,
} from '@/lib/dashboard/firstSteps';

/**
 * «Первые шаги» партнёра (`У-239`, `Р-Э6-5`): реквизиты партнёра → первая
 * организация в портфеле → бот → команда (только у администратора партнёра —
 * рядовой менеджер партнёра команду не приглашает, и пункт ему не показываем).
 * Ничего не хранится, кроме «Закрыть» на членстве `PartnerUser`.
 */
export type PartnerFirstStepsArgs = {
  partnerId: string;
  userId: string;
  /** `partnerRole === 'admin'` — только ему доступна «Команда». */
  isPartnerAdmin: boolean;
};

export async function getPartnerFirstSteps(
  prisma: PrismaClient,
  args: PartnerFirstStepsArgs
): Promise<FirstStepsView> {
  const { partnerId, userId } = args;
  const [membership, partner, orgs, viewer, team] = await Promise.all([
    prisma.partnerUser.findUnique({
      where: { partnerId_userId: { partnerId, userId } },
      select: { onboardingDismissedAt: true },
    }),
    prisma.partner.findUnique({
      where: { id: partnerId },
      select: { inn: true, legalAddress: true },
    }),
    prisma.organization.count({ where: { partnerId } }),
    prisma.user.findUnique({
      where: { id: userId },
      select: { telegramChatId: true, maxChatId: true },
    }),
    args.isPartnerAdmin
      ? prisma.partnerUser.count({ where: { partnerId, isActive: true } })
      : Promise.resolve(null),
  ]);

  const items: FirstStepItem[] = [
    {
      key: 'requisites',
      title: 'Заполнить реквизиты',
      hint: 'ИНН и юридический адрес нужны для договора и комиссионных отчётов',
      href: '/partner/settings?tab=profile',
      done: Boolean(partner?.inn && partner?.legalAddress),
    },
    {
      key: 'firstOrganization',
      title: 'Добавить первую организацию',
      hint: 'Клиент в портфеле — с него начинаются заявки и заказы',
      href: '/partner/portfolio',
      done: orgs > 0,
    },
    {
      key: 'bot',
      title: 'Привязать бота',
      hint: 'Уведомления о заказах и документах — в Telegram или MAX',
      href: '/partner/settings?tab=profile',
      done: Boolean(viewer?.telegramChatId || viewer?.maxChatId),
    },
  ];
  if (team !== null) {
    items.push({
      key: 'team',
      title: 'Пригласить команду',
      hint: 'Коллеги увидят свои организации и заявки в этом же кабинете',
      // Вкладка настроек, а не прежний `/partner/team`: тот адрес был шлюзом
      // и удалён (`У-263`, прогон сопровождения №37) — шаг вёл бы в 404.
      href: '/partner/settings?tab=team',
      // Один активный участник — это сам администратор.
      done: team > 1,
    });
  }
  return buildFirstStepsView(items, membership?.onboardingDismissedAt);
}

/** «Закрыть» — на членстве `PartnerUser`, со скоупом партнёра (см. организацию). */
export async function dismissPartnerFirstSteps(
  prisma: PrismaClient,
  args: { partnerId: string; userId: string }
): Promise<{ ok: true } | { ok: false; error: 'not_found' }> {
  const r = await prisma.partnerUser.updateMany({
    where: { partnerId: args.partnerId, userId: args.userId, isActive: true },
    data: { onboardingDismissedAt: new Date() },
  });
  return r.count > 0 ? { ok: true } : { ok: false, error: 'not_found' };
}
