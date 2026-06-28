import type { RowKind } from './types';

export type Classification = { kind: RowKind; excludeReason?: string };

const INTERNAL_TRANSFER = /(перевод собственных средств|внутреннее перемещение|перевод между своими счет)/i;

/**
 * Классификация строки-операции по типу документа (col[1]) и корр-счёту (col[7]).
 *  - Поступление + 62* → payment
 *  - Списание   + 62* → refund
 *  - corr 60          → excluded:supplier
 *  - corr 91*         → excluded:bank_fee
 *  - внутр. перевод   → excluded:internal_transfer (по тексту, имеет приоритет)
 *  - прочее           → excluded:corr_other
 */
export function classifyRow(documentLine: string, corrAccount: string): Classification {
  const doc = (documentLine ?? '').trim();
  const corr = (corrAccount ?? '').trim();

  if (INTERNAL_TRANSFER.test(doc)) return { kind: 'excluded', excludeReason: 'internal_transfer' };

  const is62 = corr.startsWith('62');
  const isIncoming = /^Поступление/i.test(doc);
  const isOutgoing = /^Списание/i.test(doc);

  if (is62 && isIncoming) return { kind: 'payment' };
  if (is62 && isOutgoing) return { kind: 'refund' };

  if (corr.startsWith('60')) return { kind: 'excluded', excludeReason: 'supplier' };
  if (corr.startsWith('91')) return { kind: 'excluded', excludeReason: 'bank_fee' };

  return { kind: 'excluded', excludeReason: 'corr_other' };
}
