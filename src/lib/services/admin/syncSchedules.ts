import type { PrismaClient } from '@prisma/client';
import { ALL_SCHEDULES } from '@/lib/jobs/scheduling';
import { parseCron } from '@/lib/jobs/cron';
import { recordAudit } from '@/lib/auth/audit';

/**
 * Расписания обмена — хранение и правка из интерфейса (`У-125`).
 *
 * **Почему не в `SETTING_SPECS`.** Тот реестр описывает настройки, у которых
 * есть переменная окружения: он и нужен, чтобы задать приоритет «база → env».
 * У cron-расписаний переменной никогда не было — они были литералами в коде.
 * Заводить им выдуманное имя переменной значило бы соврать реестру и сбить
 * стражи `У-122`/`У-134`. Поэтому паттерны живут в той же таблице
 * `IntegrationSetting`, но своими ключами и со своим маленьким модулем.
 *
 * **Умолчание остаётся в коде.** Пустая строка в базе — это «не задано», и
 * действует `SYNC_SCHEDULES`. Так новое расписание, добавленное кодом,
 * начинает работать без правки базы.
 *
 * **Выключение — это пауза, а не пустой cron.** Механизм паузы уже есть
 * (`SyncSchedulePause`), он пишет в аудит и умеет включаться обратно.
 * Дублировать его пустой строкой в расписании нельзя: получилось бы два
 * способа выключить одно и то же, которые рано или поздно разойдутся.
 */

const KEY_PREFIX = 'sync.cron.';

export function syncCronKey(schedulerId: string): string {
  return `${KEY_PREFIX}${schedulerId}`;
}

export type SchedulePatterns = Map<string, string>;

/**
 * Действующие паттерны: умолчание из кода, поверх — заданное в интерфейсе.
 *
 * Невалидное значение из базы **игнорируется** и заменяется умолчанием: обмен
 * не должен останавливаться из-за испорченной строки. Форма такое значение не
 * пропустит, но база переживает и ручные правки.
 */
export async function getSchedulePatterns(prisma: PrismaClient): Promise<SchedulePatterns> {
  // Умолчания — по ВСЕМ редактируемым расписаниям (`У-125` обмен с 1С,
  // `У-130` задача SLA): реестр один, чтобы не заводить второй список.
  const out: SchedulePatterns = new Map(
    ALL_SCHEDULES.filter((s) => s.editable).map((s) => [s.schedulerId, s.pattern])
  );

  const rows = await prisma.integrationSetting.findMany({
    where: { key: { startsWith: KEY_PREFIX } },
    select: { key: true, value: true },
  });
  for (const row of rows) {
    const schedulerId = row.key.slice(KEY_PREFIX.length);
    if (!out.has(schedulerId)) continue;
    const value = row.value?.trim();
    if (!value) continue;
    if (!parseCron(value).ok) continue;
    out.set(schedulerId, value);
  }
  return out;
}

export type SaveScheduleResult =
  | { ok: true }
  | { ok: false; error: 'unknown_schedule' | 'invalid_cron'; message?: string };

/**
 * Сохранить расписание задачи. Пустая строка — «вернуть умолчание из кода»
 * (строка удаляется), а не «выключить»: выключение — это пауза.
 */
export async function saveSchedulePattern(
  prisma: PrismaClient,
  actorUserId: string,
  schedulerId: string,
  pattern: string
): Promise<SaveScheduleResult> {
  if (!ALL_SCHEDULES.some((s) => s.editable && s.schedulerId === schedulerId)) {
    return { ok: false, error: 'unknown_schedule' };
  }

  const trimmed = pattern.trim();
  const key = syncCronKey(schedulerId);

  if (trimmed === '') {
    await prisma.integrationSetting.deleteMany({ where: { key } });
    await recordAudit(prisma, {
      action: 'sync_schedule_pattern_changed',
      entity: 'sync_schedule',
      entityId: schedulerId,
      userId: actorUserId,
      after: { pattern: null },
    });
    return { ok: true };
  }

  const parsed = parseCron(trimmed);
  if (!parsed.ok) return { ok: false, error: 'invalid_cron', message: parsed.error };

  await prisma.integrationSetting.upsert({
    where: { key },
    create: { key, value: trimmed, isSecret: false, updatedBy: actorUserId },
    update: { value: trimmed, isSecret: false, updatedBy: actorUserId },
  });
  await recordAudit(prisma, {
    action: 'sync_schedule_pattern_changed',
    entity: 'sync_schedule',
    entityId: schedulerId,
    userId: actorUserId,
    after: { pattern: trimmed },
  });
  return { ok: true };
}
