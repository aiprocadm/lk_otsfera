import { moscowDaysUntil } from '@/lib/tasks/due';

export const REMINDER_THRESHOLDS = [90, 60, 30, 7] as const;

export type ExpiringCertificate = {
  id: string;
  validUntil: Date | null;
  /** Пороги, по которым напоминание уже отправлено (из CertificateReminder). */
  sentThresholds: number[];
};

export type DueReminder = { certificateId: string; thresholdDays: number };

/**
 * Для каждого удостоверения определяет «активный» порог — наименьший из порогов,
 * в чью зону уже вошли (daysLeft <= threshold), — и эмитирует его, если он ещё
 * не был отправлен. Один порог за прогон: следующий (более мелкий) добьётся при
 * последующих ежедневных прогонах.
 *
 * `today` — момент прогона. Остаток дней — **московский**, тем же правилом
 * сроков, что у значков и фильтров реестра (`lib/tasks/due.ts`, прогон
 * сопровождения №36, `Р-М-3`): `0` — срок сегодня, `-1` — истёк вчера.
 * Было `Math.ceil((срок − сейчас) / сутки)` от момента прогона: срок
 * «30.09 12:00 МСК» в 07:00 МСК 23.09 давал 8 дней, и напоминание «через 7
 * дн.» уходило только на следующий день — когда значок уже писал «через 6
 * дн.».
 */
export function selectDueReminders(certs: ExpiringCertificate[], today: Date): DueReminder[] {
  // Сортируем пороги по возрастанию для поиска тесной полосы.
  const ascThresholds = [...REMINDER_THRESHOLDS].sort((a, b) => a - b) as number[];

  const out: DueReminder[] = [];
  for (const c of certs) {
    if (!c.validUntil) continue;
    const daysLeft = moscowDaysUntil(c.validUntil, today);
    if (daysLeft < 0) continue;

    // Активный порог: наименьший t такой, что daysLeft <= t.
    const active = ascThresholds.find((t) => daysLeft <= t);
    if (active != null && !c.sentThresholds.includes(active)) {
      out.push({ certificateId: c.id, thresholdDays: active });
    }
  }
  return out;
}
