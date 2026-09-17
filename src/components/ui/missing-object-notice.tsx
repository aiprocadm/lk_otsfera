import React from 'react';

/**
 * Плашка «объект недоступен» над списком раздела (этап 5 PR-3, `У-232`).
 * Показывается, когда человек пришёл по ссылке из уведомления на удалённый
 * или закрытый для него объект (`?missing=1`, см. `lib/navigation/missingObject`).
 * Презентационный примитив: без данных и без прав — только текст.
 */
export function MissingObjectNotice({
  what = 'Объект',
  feminine = false,
}: {
  what?: string;
  /** Женский род существительного («Задача недоступна», а не «недоступен»). */
  feminine?: boolean;
}) {
  const unavailable = feminine ? 'недоступна' : 'недоступен';
  const pronoun = feminine ? 'Её' : 'Его';
  const dative = feminine ? 'ней' : 'нему';
  return (
    <div
      role="status"
      data-testid="missing-object-notice"
      className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900"
    >
      <span className="font-semibold">
        {what} {unavailable}.
      </span>{' '}
      {pronoun} удалили или у вас больше нет к {dative} доступа. Ниже — весь список раздела.
    </div>
  );
}
