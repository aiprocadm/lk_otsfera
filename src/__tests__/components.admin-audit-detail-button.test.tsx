// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';

import { AuditDetailButton } from '@/components/admin/audit-detail-button';
import type { AuditRow } from '@/lib/services/admin/auditLog';

function makeRow(overrides: Partial<AuditRow> = {}): AuditRow {
  return {
    id: 'a1',
    createdAt: new Date(),
    actor: null,
    action: 'user_updated',
    entity: 'user',
    entityId: 'u1',
    meta: null,
    ...overrides,
  };
}

describe('AuditDetailButton', () => {
  beforeEach(() => {
    // jsdom has no native <dialog> behaviour — see the Dialog exemplar.
    HTMLDialogElement.prototype.showModal = vi.fn(function (this: HTMLDialogElement) {
      this.setAttribute('open', '');
    });
    HTMLDialogElement.prototype.close = vi.fn(function (this: HTMLDialogElement) {
      this.removeAttribute('open');
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('renders the "Подробно" trigger and no dialog initially', () => {
    render(React.createElement(AuditDetailButton, { row: makeRow() }));
    expect(screen.getByRole('button', { name: 'Подробно' })).toBeTruthy();
    expect(HTMLDialogElement.prototype.showModal).not.toHaveBeenCalled();
  });

  it('opens the AuditDiffDialog on click', () => {
    render(
      React.createElement(AuditDetailButton, {
        row: makeRow({ action: 'partner_created', entity: 'partner' }),
      })
    );
    fireEvent.click(screen.getByRole('button', { name: 'Подробно' }));
    expect(HTMLDialogElement.prototype.showModal).toHaveBeenCalled();
    expect(screen.getByText('partner_created · partner')).toBeTruthy();
  });

  it("closes the dialog when the dialog's X (aria-label Закрыть) button is clicked", () => {
    render(React.createElement(AuditDetailButton, { row: makeRow() }));
    fireEvent.click(screen.getByRole('button', { name: 'Подробно' }));
    expect(screen.getByText('user_updated · user')).toBeTruthy();

    // Dialog renders two "Закрыть"-accessible-name buttons: the primitive's
    // X (aria-label) and AuditDiffDialog's own footer button. Disambiguate
    // by picking the one that carries the aria-label attribute.
    const closeButtons = screen.getAllByRole('button', { name: 'Закрыть' });
    const xButton = closeButtons.find((b) => b.hasAttribute('aria-label'));
    expect(xButton).toBeTruthy();
    fireEvent.click(xButton!);
    expect(HTMLDialogElement.prototype.close).toHaveBeenCalled();
    expect(screen.queryByText('user_updated · user')).toBeNull();
  });

  it("closes the dialog when the panel's footer close button is clicked", () => {
    render(React.createElement(AuditDetailButton, { row: makeRow() }));
    fireEvent.click(screen.getByRole('button', { name: 'Подробно' }));

    const closeButtons = screen.getAllByRole('button', { name: 'Закрыть' });
    const footerButton = closeButtons.find((b) => !b.hasAttribute('aria-label'));
    expect(footerButton).toBeTruthy();
    fireEvent.click(footerButton!);
    expect(HTMLDialogElement.prototype.close).toHaveBeenCalled();
    expect(screen.queryByText('user_updated · user')).toBeNull();
  });
});
