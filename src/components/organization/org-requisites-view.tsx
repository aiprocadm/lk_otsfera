import React from 'react';
import { EmptyState } from '@/components/ui';

/**
 * Реквизиты организации «на чтение» — для тех, кто их видит, но не правит
 * (менеджер, руководитель). Строго презентационный компонент с
 * domain-agnostic типом, поэтому sibling-паттерн §4 CLAUDE.md здесь не
 * применяется: копии `manager-*`/`leader-*` разошлись бы без причины.
 *
 * Заблокированную форму здесь показывать нельзя: заблокированный контрол
 * читается как «сломалось», а не как «не ваше» (тот же принцип, что в
 * «Дополнительных полях»).
 */
export type OrgRequisitesViewModel = {
  inn: string | null;
  kpp: string | null;
  legalName: string | null;
  ogrn: string | null;
  legalAddress: string | null;
  bankName: string | null;
  bankAccount: string | null;
  corrAccount: string | null;
  bic: string | null;
  signerName: string | null;
  signerPosition: string | null;
};

const ROWS: ReadonlyArray<{ label: string; key: keyof OrgRequisitesViewModel }> = [
  { label: 'ИНН', key: 'inn' },
  { label: 'КПП', key: 'kpp' },
  { label: 'Юр. название', key: 'legalName' },
  { label: 'ОГРН', key: 'ogrn' },
  { label: 'Юр. адрес', key: 'legalAddress' },
  { label: 'Банк', key: 'bankName' },
  { label: 'Р/с', key: 'bankAccount' },
  { label: 'К/с', key: 'corrAccount' },
  { label: 'БИК', key: 'bic' },
];

export function OrgRequisitesView({ requisites }: { requisites: OrgRequisitesViewModel }) {
  const signer = requisites.signerName
    ? `${requisites.signerName}${requisites.signerPosition ? `, ${requisites.signerPosition}` : ''}`
    : null;
  const filled = ROWS.some((r) => requisites[r.key]) || signer !== null;

  if (!filled) {
    // `У-74`: пустой блок объясняет, почему он пуст и кто это исправит.
    return (
      <EmptyState message="Реквизиты не заполнены. Их вносит администратор учебного центра или сам заказчик в своём кабинете." />
    );
  }

  return (
    <dl className="grid grid-cols-1 sm:grid-cols-2 gap-3">
      {ROWS.map((r) => (
        <Detail key={r.key} label={r.label} value={requisites[r.key] ?? '—'} />
      ))}
      <Detail label="Подписант" value={signer ?? '—'} />
    </dl>
  );
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-gray-200 px-4 py-2">
      <dt className="text-xs text-gray-500">{label}</dt>
      <dd className="text-sm font-medium text-[#111111]">{value}</dd>
    </div>
  );
}
