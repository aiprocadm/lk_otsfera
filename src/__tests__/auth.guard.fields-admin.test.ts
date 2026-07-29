/**
 * Этап 1 ТЗ v0.5 (§4) — гейт настройки полей и статусов: администратор ИЛИ
 * руководитель. Руководитель — суб-роль менеджера (`managerRole='leader'`),
 * поэтому обычной проверки роли недостаточно, а обычный менеджер обязан
 * получать 403.
 */
import { describe, it, expect, vi } from 'vitest';
import type { SessionPayload } from '@/lib/auth/jwt';

vi.mock('@/lib/auth/session', () => ({ getSession: vi.fn() }));

import { requireFieldsAdmin } from '@/lib/auth/guard';

function sess(role: string, extra: Partial<SessionPayload> = {}): SessionPayload {
  return { sub: 'u1', role: role as SessionPayload['role'], ...extra } as SessionPayload;
}

describe('requireFieldsAdmin', () => {
  it('администратор проходит', () => {
    const res = requireFieldsAdmin(sess('admin'));
    expect(res.ok).toBe(true);
  });

  it('руководитель проходит', () => {
    const res = requireFieldsAdmin(sess('manager', { managerRole: 'leader' }));
    expect(res.ok).toBe(true);
  });

  it('обычный менеджер — 403', async () => {
    const res = requireFieldsAdmin(sess('manager'));
    expect(res.ok).toBe(false);
    if (res.ok) throw new Error('unexpected');
    expect(res.response.status).toBe(403);
  });

  it('клиентские роли — 403', async () => {
    for (const role of ['partner', 'organization', 'student']) {
      const res = requireFieldsAdmin(sess(role));
      expect(res.ok).toBe(false);
      if (res.ok) throw new Error('unexpected');
      expect(res.response.status).toBe(403);
    }
  });
});
