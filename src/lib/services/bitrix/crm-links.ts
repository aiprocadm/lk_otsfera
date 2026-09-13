import type { BitrixTask } from './source';

/**
 * Привязки задачи к CRM (`UF_CRM_TASK` REST и колонка «CRM» выгрузки):
 * `CO_12` компания, `D_7` сделка, `L_3` лид, `C_9` контакт. Прочие токены
 * (названия, `SCO_…` смарт-процессов) пропускаются — переносить их некуда.
 */
export function parseCrmLinks(tokens: readonly string[]): BitrixTask['crmLinks'] {
  const out: BitrixTask['crmLinks'] = [];
  for (const token of tokens) {
    const m = token.trim().match(/^(CO|D|L|C)_(\d+)$/i);
    if (!m) continue;
    const prefix = (m[1] ?? '').toUpperCase();
    const kind =
      prefix === 'CO' ? 'company' : prefix === 'D' ? 'deal' : prefix === 'L' ? 'lead' : 'contact';
    out.push({ kind, id: m[2] ?? '' });
  }
  return out;
}
