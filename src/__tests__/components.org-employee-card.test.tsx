import React from 'react';
import { describe, it, expect } from 'vitest';
import { renderToString } from 'react-dom/server';
import { OrgEmployeeCard } from '@/components/organization/org-employee-card';
import type { OrgCardEmployeeDetail } from '@/lib/services/organization/orgCardEmployees';

/**
 * `У-97`: карточка сотрудника одна на все кабинеты. Проверяем §15 («что здесь
 * делают») и то, что пустые поля не пропадают молча, а показываются
 * прочерком: исчезнувшая строка читается как «такого поля нет», а не «оно не
 * заполнено».
 */
function employee(over: Partial<OrgCardEmployeeDetail> = {}): OrgCardEmployeeDetail {
  return {
    id: 's1',
    name: 'Иванов Иван',
    email: 'ivan@example.com',
    position: 'Электрик',
    snils: '111-222-333 44',
    birthDate: new Date('1990-05-01'),
    phone: '+7 900 000-00-00',
    note: null,
    status: 'active',
    createdAt: new Date('2026-01-10'),
    ...over,
  };
}

describe('OrgEmployeeCard (У-97)', () => {
  it('показывает ФИО, подзаголовок и реквизиты справочника', () => {
    const html = renderToString(<OrgEmployeeCard employee={employee()} certificates={[]} />);
    expect(html).toContain('Иванов Иван');
    expect(html).toContain('Сотрудник организации');
    expect(html).toContain('Электрик');
    expect(html).toContain('111-222-333 44');
    expect(html).toContain('+7 900 000-00-00');
  });

  it('незаполненное поле — прочерк, а не исчезнувшая строка (§15)', () => {
    const html = renderToString(
      <OrgEmployeeCard
        employee={employee({ position: null, snils: null, birthDate: null, phone: null })}
        certificates={[]}
      />
    );
    expect(html).toContain('Должность');
    expect(html).toContain('—');
  });

  it('нет почты — так и написано, а не пусто', () => {
    const html = renderToString(
      <OrgEmployeeCard employee={employee({ email: null })} certificates={[]} />
    );
    expect(html).toContain('Почта не указана');
  });

  it('архивный сотрудник помечен — иначе непонятно, почему его нет в списке', () => {
    const active = renderToString(<OrgEmployeeCard employee={employee()} certificates={[]} />);
    expect(active).not.toContain('В архиве');

    const archived = renderToString(
      <OrgEmployeeCard employee={employee({ status: 'archived' })} certificates={[]} />
    );
    expect(archived).toContain('В архиве');
  });

  it('без удостоверений раздел объясняет себя (У-74)', () => {
    const html = renderToString(<OrgEmployeeCard employee={employee()} certificates={[]} />);
    expect(html).toContain('Нет удостоверений');
  });

  it('удостоверения и дополнительные блоки кабинета рисуются', () => {
    const html = renderToString(
      <OrgEmployeeCard
        employee={employee()}
        certificates={[
          {
            id: 'c1',
            number: 'У-42',
            direction: { name: 'Электробезопасность' },
            issuedAt: new Date('2026-02-01'),
            validUntil: null,
          },
        ]}
        customFields={<p>ПОЛЯ</p>}
        actions={<p>ДЕЙСТВИЕ</p>}
      />
    );
    expect(html).toContain('У-42');
    expect(html).toContain('Электробезопасность');
    expect(html).toContain('ПОЛЯ');
    expect(html).toContain('ДЕЙСТВИЕ');
  });
});
