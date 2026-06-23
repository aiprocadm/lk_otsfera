export const REMINDER_THRESHOLDS = [90, 60, 30, 7] as const;

export type ExpiringCertificate = {
  id: string;
  validUntil: Date | null;
  /** Пороги, по которым напоминание уже отправлено (из CertificateReminder). */
  sentThresholds: number[];
};

export type DueReminder = { certificateId: string; thresholdDays: number };

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/**
 * Для каждого удостоверения определяет «активный» порог — наименьший из порогов,
 * в чью зону уже вошли (daysLeft <= threshold), — и эмитирует его, если он ещё
 * не был отправлен. Один порог за прогон: следующий (более мелкий) добьётся при
 * последующих ежедневных прогонах.
 */
export function selectDueReminders(
  certs: ExpiringCertificate[],
  today: Date
): DueReminder[] {
  // Сортируем пороги по возрастанию для поиска тесной полосы.
  const ascThresholds = [...REMINDER_THRESHOLDS].sort((a, b) => a - b) as number[];

  const out: DueReminder[] = [];
  for (const c of certs) {
    if (!c.validUntil) continue;
    const daysLeft = Math.ceil((c.validUntil.getTime() - today.getTime()) / MS_PER_DAY);
    if (daysLeft < 0) continue;

    // Активный порог: наименьший t такой, что daysLeft <= t.
    const active = ascThresholds.find((t) => daysLeft <= t);
    if (active != null && !c.sentThresholds.includes(active)) {
      out.push({ certificateId: c.id, thresholdDays: active });
    }
  }
  return out;
}
