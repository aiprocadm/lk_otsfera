/**
 * Единый реестр каналов уведомлений (D1). Добавление канала = новая
 * реализация `NotificationChannel` + строка здесь; фан-ауты и места
 * генерации событий не меняются (критерий приёмки трека D).
 */
import type { NotificationChannel } from './types';
import { emailChannel } from './email';
import { telegramChannel } from './telegram';

export function getChannels(): NotificationChannel[] {
  return [emailChannel, telegramChannel];
}
