/**
 * «Входящие обращения» (этап 7 ТЗ 13.10.2026, `У-318`, `Р-7-6`): каналы
 * очереди и разбор фильтров из адреса — один для кабинетов менеджера,
 * руководителя и администратора.
 */
export const INTAKE_CHANNELS = ['telegram', 'max', 'whatsapp', 'email', 'cabinet', 'call'] as const;
export type IntakeChannel = (typeof INTAKE_CHANNELS)[number];

export const INTAKE_CHANNEL_LABEL: Record<IntakeChannel, string> = {
  telegram: 'Telegram',
  max: 'MAX',
  whatsapp: 'WhatsApp',
  email: 'Почта',
  cabinet: 'Из кабинета',
  call: 'Звонки',
};

function isIntakeChannel(value: unknown): value is IntakeChannel {
  return typeof value === 'string' && (INTAKE_CHANNELS as readonly string[]).includes(value);
}

/** Фильтры из адреса: незнакомый канал — как будто его нет. */
export function parseIntakeView(sp: Record<string, string | string[] | undefined>): {
  channel: IntakeChannel | undefined;
  onlyImportant: boolean;
} {
  return {
    channel: isIntakeChannel(sp.channel) ? sp.channel : undefined,
    onlyImportant: sp.important === '1',
  };
}
