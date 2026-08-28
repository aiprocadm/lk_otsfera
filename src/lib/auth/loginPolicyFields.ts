import type { SettingKey } from '@/lib/config/integrationSettings';

/**
 * Поля политик входа (`У-129`) — описание формы, а не действие.
 *
 * Живут в `lib`, а не рядом с серверным действием: из файла с
 * `'use server'` можно экспортировать ТОЛЬКО async-функции, и экспорт
 * массива оттуда роняет production-сборку («A "use server" file can only
 * export async functions, found object»), оставаясь невидимым для
 * typecheck, lint и unit-тестов.
 */
/**
 * Границы. Смысл не в «красивых числах», а в том, что за ними вход ломается:
 * ноль попыток — никто не войдёт, сутки на ввод кода из письма — код перестаёт
 * быть одноразовым по смыслу.
 */
export const LOGIN_POLICY_FIELDS: Array<{
  field: string;
  key: SettingKey;
  label: string;
  hint: string;
  min: number;
  max: number;
}> = [
  {
    field: 'login_twoFactorCodeTtlMinutes',
    key: 'login.twoFactorCodeTtlMinutes',
    label: 'Код из письма живёт, минут',
    hint: 'по умолчанию 10',
    min: 1,
    max: 60,
  },
  {
    field: 'login_twoFactorMaxAttempts',
    key: 'login.twoFactorMaxAttempts',
    label: 'Попыток ввести код',
    hint: 'по умолчанию 5',
    min: 1,
    max: 20,
  },
  {
    field: 'login_backupCodesCount',
    key: 'login.backupCodesCount',
    label: 'Резервных кодов выдаётся',
    hint: 'по умолчанию 10',
    min: 4,
    max: 30,
  },
  {
    field: 'login_rateLimitMax',
    key: 'login.rateLimitMax',
    label: 'Попыток входа за окно',
    hint: 'по умолчанию 10',
    min: 3,
    max: 100,
  },
  {
    field: 'login_rateLimitWindowMs',
    key: 'login.rateLimitWindowMs',
    label: 'Окно подсчёта попыток, мс',
    hint: 'по умолчанию 60000',
    min: 10_000,
    max: 3_600_000,
  },
  {
    field: 'login_inviteTtlDays',
    key: 'login.inviteTtlDays',
    label: 'Приглашение действует, дней',
    hint: 'по умолчанию 7',
    min: 1,
    max: 90,
  },
  {
    field: 'login_resetTtlHours',
    key: 'login.resetTtlHours',
    label: 'Ссылка сброса пароля живёт, часов',
    hint: 'по умолчанию 2',
    min: 1,
    max: 72,
  },
];
