/**
 * Единый реестр каналов уведомлений (D1). Добавление канала = новая
 * реализация `NotificationChannel` + строка здесь; фан-ауты и места
 * генерации событий не меняются (критерий приёмки трека D).
 */
import { emailChannel } from './email';
import { telegramChannel } from './telegram';
import { maxChannel } from './max';
import { whatsappChannel } from './whatsapp';
import type { NotificationChannel } from './types';

export function getChannels(): NotificationChannel[] {
  return [emailChannel, telegramChannel, maxChannel, whatsappChannel];
}
