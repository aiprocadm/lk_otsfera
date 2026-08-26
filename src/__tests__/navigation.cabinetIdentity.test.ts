import { describe, it, expect } from 'vitest';
import { CABINET_NAMES, cabinetHeaderTitle } from '@/lib/navigation/cabinetIdentity';
import { navByRole } from '@/lib/navigation/cabinet';

/**
 * `У-115`: название кабинета — одно на всю систему, и живёт оно в одном месте.
 */
describe('названия кабинетов (У-115)', () => {
  it('название есть у каждой роли, у которой есть меню', () => {
    for (const role of Object.keys(navByRole)) {
      expect(
        CABINET_NAMES[role as keyof typeof CABINET_NAMES],
        `нет названия у роли ${role}`
      ).toBeTruthy();
    }
  });

  it('все названия начинаются со слова «Кабинет» и не повторяются', () => {
    const names = Object.values(CABINET_NAMES);
    for (const n of names) expect(n.startsWith('Кабинет ')).toBe(true);
    expect(new Set(names).size).toBe(names.length);
  });

  it('подпись собирается как «<Кабинет> · <кто>»', () => {
    expect(cabinetHeaderTitle('partner', 'Иван')).toEqual({
      cabinet: 'Кабинет партнёра',
      subject: 'Иван',
    });
  });

  it('без имени точка-разделитель не висит в пустоте', () => {
    // Человек всё равно должен видеть, в каком он кабинете.
    for (const empty of [null, '', '   ']) {
      expect(cabinetHeaderTitle('organization', empty)).toEqual({
        cabinet: 'Кабинет заказчика',
        subject: null,
      });
    }
  });

  it('лишние пробелы вокруг имени срезаются', () => {
    expect(cabinetHeaderTitle('admin', '  Пётр  ').subject).toBe('Пётр');
  });
});
