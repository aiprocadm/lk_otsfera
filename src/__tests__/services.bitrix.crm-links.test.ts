import { describe, expect, it } from 'vitest';

import { parseCrmLinks } from '@/lib/services/bitrix/crm-links';

/**
 * Этап 2 ТЗ 12.09.2026 (`У-189`): привязки задачи к CRM. Битрикс отдаёт их
 * токенами `CO_12` (компания), `D_7` (сделка), `L_3` (лид), `C_9` (контакт) —
 * и в REST-поле `UF_CRM_TASK`, и в колонке «CRM» файловой выгрузки.
 */

describe('parseCrmLinks — токены UF_CRM_TASK → привязки', () => {
  it('разбирает все четыре вида и пропускает всё остальное', () => {
    expect(parseCrmLinks(['CO_101', 'D_401', 'L_303', 'C_208', 'SCO_5', 'мусор', ' d_7 '])).toEqual(
      [
        { kind: 'company', id: '101' },
        { kind: 'deal', id: '401' },
        { kind: 'lead', id: '303' },
        { kind: 'contact', id: '208' },
        // SCO_5 — смарт-процесс, переносить его некуда; « d_7 » — та же сделка,
        // просто с пробелами и в нижнем регистре.
        { kind: 'deal', id: '7' },
      ]
    );
  });

  it('регистр префикса не важен', () => {
    expect(parseCrmLinks(['co_1', 'Co_2', 'cO_3', 'CO_4'])).toEqual([
      { kind: 'company', id: '1' },
      { kind: 'company', id: '2' },
      { kind: 'company', id: '3' },
      { kind: 'company', id: '4' },
    ]);
  });

  it('пробелы по краям токена обрезаются', () => {
    expect(parseCrmLinks(['\tL_55 ', '  C_9'])).toEqual([
      { kind: 'lead', id: '55' },
      { kind: 'contact', id: '9' },
    ]);
  });

  it('CO_ и C_ не путаются: «CO» — компания, «C» — контакт', () => {
    expect(parseCrmLinks(['CO_5', 'C_5'])).toEqual([
      { kind: 'company', id: '5' },
      { kind: 'contact', id: '5' },
    ]);
  });

  it('чужие и битые токены пропускаются молча', () => {
    expect(
      parseCrmLinks([
        'SCO_5', // смарт-процесс
        'T_9', // неизвестная сущность
        'D_', // нет номера
        '_7', // нет префикса
        'D_7x', // мусор после номера
        'D 7', // не тот разделитель
        'ООО «Бета»', // название вместо токена
        '',
      ])
    ).toEqual([]);
  });

  it('пустой список → пустой список', () => {
    expect(parseCrmLinks([])).toEqual([]);
  });
});
