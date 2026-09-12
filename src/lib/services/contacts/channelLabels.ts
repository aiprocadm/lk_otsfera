import type { ContactChannelType } from '@prisma/client';
import { MESSENGER_LABELS } from '@/lib/services/messengers/channels';

/** Типы каналов контакта в порядке показа в формах (`У-180`). */
export const CONTACT_CHANNEL_TYPES: readonly ContactChannelType[] = [
  'phone',
  'email',
  'telegram',
  'whatsapp',
  'max',
];

/** Подписи типов каналов — мессенджеры берутся из их реестра, чтобы не разъехаться. */
export const CONTACT_CHANNEL_LABELS: Record<ContactChannelType, string> = {
  phone: 'Телефон',
  email: 'E-mail',
  telegram: MESSENGER_LABELS.telegram,
  whatsapp: MESSENGER_LABELS.whatsapp,
  max: MESSENGER_LABELS.max,
};

export function isContactChannelType(value: string): value is ContactChannelType {
  return (CONTACT_CHANNEL_TYPES as readonly string[]).includes(value);
}
