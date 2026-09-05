import { beforeEach, describe, expect, it, vi } from 'vitest';

const { requireAdmin, requireSettingsSection, saveSettings } = vi.hoisted(() => ({
  requireAdmin: vi.fn(),
  requireSettingsSection: vi.fn(),
  saveSettings: vi.fn(),
}));

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('@/lib/db/prisma', () => ({ prisma: {} }));
vi.mock('@/lib/auth/requireRole', async (orig) => {
  const actual = await orig<typeof import('@/lib/auth/requireRole')>();
  return { ...actual, requireAdmin };
});
vi.mock('@/lib/auth/requireSettings', () => ({ requireSettingsSection }));
vi.mock('@/lib/config/integrationSettings', async (orig) => {
  const actual = await orig<typeof import('@/lib/config/integrationSettings')>();
  return { ...actual, saveSettings };
});
vi.mock('@/lib/config/integrationSettingsCache', () => ({
  resetIntegrationSettingsCache: vi.fn(),
  cachedIntegrationSetting: vi.fn().mockReturnValue(null),
  primeIntegrationSettingsCache: vi.fn(),
}));
vi.mock('@/lib/auth/audit', () => ({ recordAudit: vi.fn() }));

// Для поведенческой пробы ЧТЕНИЯ через API: сессию отдаёт мок, гард — настоящий.
const { requireSessionGuard, getSyncSummary } = vi.hoisted(() => ({
  requireSessionGuard: vi.fn(),
  getSyncSummary: vi.fn(),
}));
vi.mock('@/lib/auth/guard', async (orig) => {
  const actual = await orig<typeof import('@/lib/auth/guard')>();
  return { ...actual, requireSession: requireSessionGuard };
});
vi.mock('@/lib/services/syncSummary', () => ({ getSyncSummary }));

import { resetSettingToServerValueAction } from '@/server-actions/admin/integrationSettings';
import { saveOneCParamsAction } from '@/server-actions/admin/syncControl';
import { saveLoginPoliciesAction } from '@/server-actions/admin/loginPolicies';
import { getIntegrationsHealth } from '@/lib/services/admin/integrationsHealth';
import { requireAdmin as apiRequireAdmin } from '@/lib/auth/guard';
import { GET as syncSummaryGet } from '@/app/api/admin/sync/summary/route';
import {
  listCompaniesRequisites,
  setCompanyRequisites,
} from '@/lib/services/admin/companyRequisites';
import type { SessionPayload } from '@/lib/auth/jwt';

/**
 * `У-135`: руководитель не видит и не может прочитать секреты платформы и
 * параметры подключения 1С **даже через API** — а то, что ему обещано
 * (`Р-22`), работает и скоупится его компанией.
 *
 * Это проба доступа, а не проверка скрытой кнопки: скрытая карточка — внешний
 * вид, запрет живёт в гарде и сервисе (§4, defense-in-depth).
 */
const LEADER: SessionPayload = {
  sub: 'l1',
  role: 'leader',
  email: 'l@x.ru',
  name: 'Л',
  companyId: 'c1',
};

beforeEach(() => {
  vi.clearAllMocks();
  // `requireAdmin` под чужой ролью редиректит — вход в действие невозможен.
  requireAdmin.mockRejectedValue(new Error('REDIRECT:/forbidden'));
  requireSettingsSection.mockRejectedValue(new Error('REDIRECT:/forbidden'));
  saveSettings.mockResolvedValue({ ok: true });
});

describe('секреты платформы и параметры 1С — отказ до входа в действие', () => {
  it('сброс настройки интеграций: руководитель не проходит гард', async () => {
    await expect(resetSettingToServerValueAction('telegram.botToken')).rejects.toThrow(
      'REDIRECT:/forbidden'
    );
    expect(saveSettings).not.toHaveBeenCalled();
  });

  it('параметры подключения 1С: руководитель не проходит гард', async () => {
    await expect(saveOneCParamsAction(new FormData())).rejects.toThrow('REDIRECT:/forbidden');
    expect(saveSettings).not.toHaveBeenCalled();
  });

  it('политики входа: руководитель не проходит гард', async () => {
    await expect(saveLoginPoliciesAction(new FormData())).rejects.toThrow('REDIRECT:/forbidden');
    expect(saveSettings).not.toHaveBeenCalled();
  });

  // `У-135` дословно: «не может ПРОЧИТАТЬ … даже через API (403)». Пробы выше —
  // про запись; эти две — про чтение.
  it('ЧТЕНИЕ через API: GET сводки 1С под сессией руководителя → 403, сервис не вызван', async () => {
    requireSessionGuard.mockResolvedValue({ ok: true, value: LEADER });
    const res = await syncSummaryGet(new Request('http://test/api/admin/sync/summary'), {
      params: Promise.resolve({}),
    } as never);
    expect(res.status).toBe(403);
    expect(getSyncSummary).not.toHaveBeenCalled();
  });

  it('API-гард requireAdmin отвечает руководителю именно 403, а не пускает', () => {
    const res = apiRequireAdmin(LEADER);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.response.status).toBe(403);
  });
});

describe('обещанное Р-22 работает — и скоупится компанией', () => {
  it('светофор интеграций открыт руководителю (в строках нет секретов)', async () => {
    const prisma = {
      syncState: { findMany: vi.fn().mockResolvedValue([]) },
      // `У-174`: светофор считает невыгруженные документы компании.
      document: { count: vi.fn().mockResolvedValue(0) },
    } as never;
    const res = await getIntegrationsHealth(prisma, LEADER);
    expect(res.ok).toBe(true);
  });

  it('светофор закрыт рядовому менеджеру', async () => {
    const prisma = {} as never;
    expect(await getIntegrationsHealth(prisma, { ...LEADER, role: 'manager' })).toEqual({
      ok: false,
      error: 'forbidden',
    });
  });

  it('реквизиты: руководитель видит ТОЛЬКО свою компанию', async () => {
    const findMany = vi.fn().mockResolvedValue([]);
    await listCompaniesRequisites({ company: { findMany } } as never, LEADER);
    expect(findMany.mock.calls[0]![0].where).toEqual({ id: 'c1' });
  });

  it('реквизиты: руководитель без компании не видит НИЧЕГО, а не всё', async () => {
    // `undefined` в where снял бы фильтр целиком — та же грабля, что в C8.
    const findMany = vi.fn().mockResolvedValue([]);
    const noCompany = { ...LEADER };
    delete (noCompany as { companyId?: string }).companyId;
    await listCompaniesRequisites({ company: { findMany } } as never, noCompany);
    expect(findMany.mock.calls[0]![0].where).toEqual({ id: '__none__' });
  });

  it('реквизиты: админ видит все компании без фильтра', async () => {
    const findMany = vi.fn().mockResolvedValue([]);
    await listCompaniesRequisites({ company: { findMany } } as never, {
      ...LEADER,
      role: 'admin',
    });
    expect(findMany.mock.calls[0]![0].where).toEqual({});
  });

  // Без этой пробы мутация «убрать leader из разрешающего списка» оставалась
  // зелёной: право `Р-22` могло молча пропасть. Проверено мутацией.
  it('запись реквизитов СВОЕЙ компании руководителю разрешена', async () => {
    const update = vi.fn();
    const findUnique = vi.fn().mockResolvedValue({ id: 'c1' });
    const res = await setCompanyRequisites({ company: { update, findUnique } } as never, LEADER, 'c1', {
      legalName: 'ООО Тест',
      inn: '7707083893',
      bankAccount: '40702810400000000001',
    });
    expect(res).toEqual({ ok: true });
    expect(update).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'c1' } }));
  });

  it('запись реквизитов ЧУЖОЙ компании — forbidden, база не тронута', async () => {
    const update = vi.fn();
    const res = await setCompanyRequisites(
      { company: { update, findUnique: vi.fn() } } as never,
      LEADER,
      'c2',
      { inn: '', kpp: '', ogrn: '', bankName: '', bankAccount: '', corrAccount: '', bic: '' }
    );
    expect(res).toEqual({ ok: false, error: 'forbidden' });
    expect(update).not.toHaveBeenCalled();
  });

  it('рядовой менеджер к реквизитам не допущен вовсе', async () => {
    expect(await listCompaniesRequisites({} as never, { ...LEADER, role: 'manager' })).toEqual({
      ok: false,
      error: 'forbidden',
    });
  });
});
