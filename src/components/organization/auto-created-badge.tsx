import React from 'react';
import { fmtDate } from '@/lib/format';

/**
 * Плашка «Создана автоматически из выгрузки 1С от <дата>» (`У-54`).
 *
 * Нужна, чтобы человек не гадал, откуда в системе взялась организация, у
 * которой нет ни договора, ни менеджера: её завёл импорт выписки по ИНН
 * плательщика. Данные берутся из журнала аудита — своего поля у организации нет.
 */
export function AutoCreatedBadge({
  mark,
}: {
  mark: { at: string; fileName: string | null } | null;
}): React.JSX.Element | null {
  if (!mark) return null;
  return (
    <p
      className="mt-2 inline-block rounded-lg bg-amber-50 border border-amber-100 px-3 py-1 text-xs text-amber-900"
      data-testid="org-auto-created"
    >
      Создана автоматически из выгрузки 1С от {fmtDate(mark.at)}
      {mark.fileName ? ` (файл «${mark.fileName}»)` : ''}. Проверьте реквизиты и назначьте
      ответственного.
    </p>
  );
}
