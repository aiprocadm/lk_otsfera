import { describe, it, expect } from 'vitest';
import { CABINET_SWITCH, cabinetOfPath, switchCabinetHref } from '@/lib/navigation/cabinetSwitch';
import { navByRole } from '@/lib/navigation/cabinet';

/**
 * Переключение кабинетов руководителя (`У-111`).
 *
 * Раньше это были два пункта меню с разными названиями: «Кабинет руководителя»
 * внизу у менеджера и «Мои заказы» у руководителя. Одно действие — два имени, и
 * оба выглядят как разделы работы. Теперь правило одно и живёт здесь.
 */
describe('переключение кабинетов руководителя (У-111)', () => {
  it('кабинетов ровно два и названы они кабинетами, а не разделами', () => {
    expect(CABINET_SWITCH.map((c) => c.cabinet)).toEqual(['leader', 'manager']);
    expect(CABINET_SWITCH.map((c) => c.label)).toEqual(['Руководитель', 'Менеджер']);
  });

  it('кабинет определяется по адресу, а чужой адрес не считается своим', () => {
    expect(cabinetOfPath('/leader/orders')).toBe('leader');
    expect(cabinetOfPath('/manager/dashboard')).toBe('manager');
    expect(cabinetOfPath('/admin/orders')).toBeNull();
    // Ловушка вида «/leadership»: префикс совпал, кабинет — нет.
    expect(cabinetOfPath('/leadership')).toBeNull();
  });

  it('раздел сохраняется, если он есть в обоих кабинетах', () => {
    expect(switchCabinetHref('/leader/orders', 'manager')).toBe('/manager/orders');
    expect(switchCabinetHref('/manager/orders', 'leader')).toBe('/leader/orders');
    expect(switchCabinetHref('/leader/documents', 'manager')).toBe('/manager/documents');
  });

  it('карточка сущности ведёт на список раздела, а не на тот же адрес', () => {
    // Заказ, видный руководителю по всей компании, может быть не виден ему же
    // как рядовому менеджеру — переключение упёрлось бы в «не найдено».
    expect(switchCabinetHref('/leader/orders/ord-1', 'manager')).toBe('/manager/orders');
  });

  it('раздела нет у соседа — ведём на главную, а не в 404', () => {
    // «Роли» есть только у руководителя, «Лиды» — только у менеджера.
    expect(switchCabinetHref('/leader/roles', 'manager')).toBe('/manager/dashboard');
    expect(switchCabinetHref('/manager/leads', 'leader')).toBe('/leader/dashboard');
  });

  it('переключение «в себя» и незнакомый адрес ведут на главную', () => {
    expect(switchCabinetHref('/leader/orders', 'leader')).toBe('/leader/dashboard');
    expect(switchCabinetHref('/admin/orders', 'manager')).toBe('/manager/dashboard');
    expect(switchCabinetHref('/leader', 'manager')).toBe('/manager/dashboard');
  });

  it('пунктов-мостов в чужой кабинет в меню больше нет', () => {
    // Именно они и были тем «спрятанным переключателем», который заменён.
    const leaderHrefs = navByRole.leader.map((i) => i.href);
    const managerHrefs = navByRole.manager.map((i) => i.href);
    expect(leaderHrefs.filter((h) => h.startsWith('/manager/'))).toEqual([]);
    expect(managerHrefs.filter((h) => h.startsWith('/leader/'))).toEqual([]);
  });
});
