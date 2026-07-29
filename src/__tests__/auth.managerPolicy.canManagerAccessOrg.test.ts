import { describe, it, expect, vi } from 'vitest';
import { canManagerAccessOrg } from '@/lib/auth/managerPolicy';
import type { SessionPayload } from '@/lib/auth/jwt';

/**
 * Этап 9 PR-3: mode-aware предикат доступа менеджера к организации (C8) —
 * общий для страничного гарда `requireManagerForOrg` и API-роутов выгрузок.
 * При teamMode=OFF граница — персональный скоуп, при ON — компания.
 */

const session = (over: Partial<SessionPayload> = {}): SessionPayload =>
  ({ sub: 'm1', role: 'manager', companyId: 'co-1', managedOrgIds: ['org-1'], ...over }) as SessionPayload;

function fakePrisma(args: { teamMode: boolean; orgCompanyId?: string | null }) {
  return {
    company: { findUnique: vi.fn().mockResolvedValue({ managerTeamVisibility: args.teamMode }) },
    organization: {
      findUnique: vi
        .fn()
        .mockResolvedValue(
          args.orgCompanyId === undefined ? null : { companyId: args.orgCompanyId }
        )
    }
  } as never;
}

describe('canManagerAccessOrg', () => {
  it('teamMode=OFF: пускает только в свои организации', async () => {
    const p = fakePrisma({ teamMode: false });
    expect(await canManagerAccessOrg(p, session(), 'org-1')).toBe(true);
    expect(await canManagerAccessOrg(p, session(), 'org-2')).toBe(false);
  });

  it('teamMode=ON: пускает в любую организацию своей компании', async () => {
    const p = fakePrisma({ teamMode: true, orgCompanyId: 'co-1' });
    expect(await canManagerAccessOrg(p, session({ managedOrgIds: [] }), 'org-9')).toBe(true);
  });

  it('teamMode=ON: чужая компания — отказ', async () => {
    const p = fakePrisma({ teamMode: true, orgCompanyId: 'co-2' });
    expect(await canManagerAccessOrg(p, session(), 'org-9')).toBe(false);
  });

  it('teamMode=ON: несуществующая организация — отказ', async () => {
    const p = fakePrisma({ teamMode: true });
    expect(await canManagerAccessOrg(p, session(), 'ghost')).toBe(false);
  });

  it('teamMode=ON без companyId у сессии — отказ (fail-safe)', async () => {
    // company.findUnique не вызывается для null-компании → teamMode=false,
    // поэтому режим форсируем через организацию своей компании и пустой скоуп.
    const p = {
      company: { findUnique: vi.fn().mockResolvedValue({ managerTeamVisibility: true }) },
      organization: { findUnique: vi.fn() }
    } as never;
    const s = session({ companyId: 'co-1', managedOrgIds: [] });
    // подменяем companyId уже после расчёта teamMode невозможно — проверяем
    // прямой контракт: сессия без компании никогда не проходит company-ветку.
    expect(await canManagerAccessOrg(p, { ...s, companyId: null } as SessionPayload, 'org-9')).toBe(
      false
    );
  });
});

/**
 * Решение заказчика 29.07.2026: лидер-инвариант C8 распространён с заказов на
 * организации. Руководитель открывает карточку любой организации СВОЕЙ компании
 * без закрепления — иначе он не мог заполнить настраиваемые поля §11, хотя §4
 * ТЗ даёт ему настройку полей. Граница компании остаётся жёсткой.
 */
describe('canManagerAccessOrg — руководитель (лидер-инвариант C8)', () => {
  const leader = (over: Partial<SessionPayload> = {}): SessionPayload =>
    session({ managerRole: 'leader', managedOrgIds: [], ...over });

  it('teamMode=OFF: руководитель всё равно проходит в организацию своей компании', async () => {
    const p = fakePrisma({ teamMode: false, orgCompanyId: 'co-1' });
    expect(await canManagerAccessOrg(p, leader(), 'org-9')).toBe(true);
  });

  it('teamMode=OFF: обычный менеджер по-прежнему не проходит', async () => {
    const p = fakePrisma({ teamMode: false, orgCompanyId: 'co-1' });
    expect(await canManagerAccessOrg(p, session({ managedOrgIds: [] }), 'org-9')).toBe(false);
  });

  it('чужая компания руководителю закрыта', async () => {
    const p = fakePrisma({ teamMode: false, orgCompanyId: 'co-2' });
    expect(await canManagerAccessOrg(p, leader(), 'org-9')).toBe(false);
  });

  it('несуществующая организация — отказ', async () => {
    const p = fakePrisma({ teamMode: false });
    expect(await canManagerAccessOrg(p, leader(), 'ghost')).toBe(false);
  });

  it('руководитель без компании в сессии — отказ (fail-safe)', async () => {
    const p = fakePrisma({ teamMode: false, orgCompanyId: 'co-1' });
    expect(await canManagerAccessOrg(p, leader({ companyId: null }), 'org-9')).toBe(false);
  });
});
