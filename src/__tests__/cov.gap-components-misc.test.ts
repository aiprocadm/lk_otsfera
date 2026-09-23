// @vitest-environment jsdom
/**
 * Добивка покрытия по группе «components-misc»: ветки, до которых не
 * дотягивались соседние тест-файлы.
 *
 *  - AuditDiffDialog — пустая строка в значении поля показывается прочерком.
 *
 * Пункт про страницу-шлюз «Личная безопасность» руководителя снят вместе с
 * самой страницей: шлюзы старых адресов удалены (`У-263`, прогон
 * сопровождения №37).
 *
 * Пункт про `LeaderAppShell` (фильтр «Настройки» по `hasAnySettingsAccess`)
 * уехал в `pages.cabinet-layouts.test.tsx`: этап 2 схлопнул пять шеллов в один,
 * и фильтр теперь живёт в `app/leader/layout.tsx`.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { render } from '@testing-library/react';

import { AuditDiffDialog } from '@/components/admin/audit-diff-dialog';

describe('AuditDiffDialog — пустая строка в значении поля', () => {
  beforeEach(() => {
    HTMLDialogElement.prototype.showModal = vi.fn(function (this: HTMLDialogElement) {
      this.setAttribute('open', '');
    });
    HTMLDialogElement.prototype.close = vi.fn(function (this: HTMLDialogElement) {
      this.removeAttribute('open');
    });
  });

  it('показывает прочерк вместо пустого места, когда поле стёрли', () => {
    const row = {
      id: 'a1',
      createdAt: new Date(),
      actor: null,
      action: 'user_updated',
      entity: 'user' as const,
      entityId: 'u1',
      meta: { before: { name: 'Пётр' }, after: { name: '' } },
    } as any;

    const { container } = render(React.createElement(AuditDiffDialog, { row, onClose: () => {} }));

    const values = Array.from(container.querySelectorAll('dd')).map((dd) => dd.textContent);
    // Слева — прежнее значение, справа — прочерк (а не пустая ячейка).
    expect(values).toEqual(['Пётр', '—']);
  });
});
