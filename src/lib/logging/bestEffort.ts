import { log } from './logger';

/**
 * Обработчик для best-effort операций — аудит, отметка «последний вход»,
 * журнал синхронизации. Их отказ не должен ронять основное действие
 * (человек уже вошёл, код уже отправлен), но и молчать нельзя: пропавшие
 * записи аудита иначе никто не заметит (сопровождение, `В-1` → `Р-25`).
 *
 *   recordAudit(prisma, { ... }).catch(bestEffort('[2fa/verify] audit failed'));
 *
 * Пишет `log.warn(label, err)` и ничего не возвращает — промис разрешается
 * `undefined`, как и раньше с пустым обработчиком. Хелпер НЕ для аварийного
 * выхода процесса (`Sentry.flush` в воркере: логгер уже написал error,
 * процесс завершается) и не для ожидаемых отказов (`delete` истёкшего
 * 2FA-челленджа) — эти места в allow-list стража
 * `errors.no-silent-catch.guardrail`.
 */
export function bestEffort(label: string): (err: unknown) => void {
  return (err) => {
    log.warn(label, err);
  };
}
