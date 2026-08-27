import { describe, it, expect, vi, beforeEach } from 'vitest';
import ExcelJS from 'exceljs';
import type { NextRequest } from 'next/server';

/**
 * GET-роуты каталога услуг (`У-137`): шаблон импорта и экспорт в Excel.
 *
 * Шаблон — только staff-контуру каталога (admin|leader), и он обязан
 * открываться настоящим парсером импорта: разъедься заголовок с разбором —
 * человек заполнит файл, который система не примет. Экспорт — тонкий роут:
 * RBAC-скоуп в `listCatalogItems`, роут лишь мапит отказ в 403.
 */
const { getSession, listCatalogItems, renderCatalogXlsx, canAccessSettingsSection } = vi.hoisted(() => ({
  canAccessSettingsSection: vi.fn(),
  getSession: vi.fn(),
  listCatalogItems: vi.fn(),
  renderCatalogXlsx: vi.fn(),
}));

vi.mock('@/lib/auth/session', () => ({ getSession }));
vi.mock('@/lib/db/prisma', () => ({ prisma: {} }));
vi.mock('@/lib/services/admin/catalogItems', async (orig) => {
  const actual = await orig<typeof import('@/lib/services/admin/catalogItems')>();
  return { ...actual, listCatalogItems };
});
vi.mock('@/lib/services/admin/catalogXlsx', () => ({ renderCatalogXlsx }));
vi.mock('@/lib/auth/settingsAccess', () => ({ canAccessSettingsSection }));

import { GET as getTemplate } from '@/app/api/catalog/import-template/route';
import { GET as getExport } from '@/app/api/catalog/export/route';
import { parseCatalogWorkbook } from '@/lib/services/admin/catalogExcel';

const admin = { sub: 'a1', role: 'admin', companyId: null } as never;
const leader = { sub: 'l1', role: 'leader', companyId: 'co-1' } as never;
const manager = { sub: 'm1', role: 'manager', companyId: 'co-1' } as never;

function req(company?: string): NextRequest {
  const url = new URL('https://app.test/api/catalog/export');
  if (company !== undefined) url.searchParams.set('company', company);
  return { nextUrl: url } as unknown as NextRequest;
}

const ITEMS = [{ id: 'ci-1' }] as unknown as never[];

beforeEach(() => {
  vi.clearAllMocks();
  listCatalogItems.mockResolvedValue({ ok: true, items: ITEMS, total: ITEMS.length });
  canAccessSettingsSection.mockReturnValue(true);
  renderCatalogXlsx.mockResolvedValue(new ArrayBuffer(8));
});

describe('GET /api/catalog/import-template', () => {
  it('без сессии шаблон не отдаётся', async () => {
    getSession.mockResolvedValue(null);
    const res = await getTemplate();
    expect(res.status).toBe(401);
    await expect(res.json()).resolves.toEqual({ error: 'Unauthorized' });
  });

  it('менеджеру каталог не принадлежит — 403 (право раздела, не роль)', async () => {
    getSession.mockResolvedValue(manager);
    // У менеджера нет кабинета настроек — canAccessSettingsSection отдаёт false.
    canAccessSettingsSection.mockReturnValue(false);
    const res = await getTemplate();
    expect(res.status).toBe(403);
    await expect(res.json()).resolves.toEqual({ error: 'forbidden' });
  });

  it('default-deny профиль руководителя режет и шаблон (ревью PR-2)', async () => {
    getSession.mockResolvedValue(leader);
    canAccessSettingsSection.mockReturnValue(false);
    const res = await getTemplate();
    expect(res.status).toBe(403);
  });

  it('руководителю отдаётся файл, который браузер сохранит, а не покажет', async () => {
    getSession.mockResolvedValue(leader);
    const res = await getTemplate();
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe(
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    );
    expect(res.headers.get('content-disposition')).toBe(
      'attachment; filename="catalog-import-template.xlsx"'
    );
  });

  it('это настоящая книга: лист «Каталог», звёздочки на трёх обязательных, шапка выделена', async () => {
    getSession.mockResolvedValue(admin);
    const res = await getTemplate();
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(await res.arrayBuffer());
    const ws = wb.getWorksheet('Каталог');
    expect(ws).toBeTruthy();

    const headers = (ws!.getRow(1).values as unknown[]).slice(1).map(String);
    expect(headers).toEqual([
      'Название*',
      'Артикул*',
      'Единица',
      'Цена*',
      'Ставка НДС',
      'Цена включает НДС',
      'Направление',
      'Описание',
      'Порядок',
    ]);
    const cell = ws!.getRow(1).getCell(1);
    expect(cell.fill).toMatchObject({ type: 'pattern', fgColor: { argb: 'FFF97316' } });
    expect(cell.font).toMatchObject({ bold: true });
  });

  it('шаблон вместе со строкой-примером понимает НАСТОЯЩИЙ парсер импорта', async () => {
    // Round-trip: колонки — одна константа, но проверяем поведением, а не
    // перечислением (страж на случай, если шаблон и разбор разъедутся).
    getSession.mockResolvedValue(admin);
    const res = await getTemplate();
    const parsed = await parseCatalogWorkbook(await res.arrayBuffer(), []);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.errors).toEqual([]);
    expect(parsed.rows).toHaveLength(1);
    expect(parsed.rows[0].input).toMatchObject({
      code: 'OT-101',
      unit: 'person',
      price: '4500',
      vatRate: null,
      vatIncluded: true,
      directionId: null,
    });
  });
});

describe('GET /api/catalog/export', () => {
  it('без сессии — 401, сервис не тронут', async () => {
    getSession.mockResolvedValue(null);
    const res = await getExport(req('co-1'));
    expect(res.status).toBe(401);
    expect(listCatalogItems).not.toHaveBeenCalled();
  });

  it('?company= прокидывается в сервис вместе с неактивными позициями', async () => {
    getSession.mockResolvedValue(admin);
    const res = await getExport(req('co-2'));
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe(
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    );
    expect(res.headers.get('content-disposition')).toBe('attachment; filename="catalog.xlsx"');
    expect(listCatalogItems).toHaveBeenCalledWith({}, admin, {
      companyId: 'co-2',
      includeInactive: true,
      limit: 10_000,
    });
    expect(renderCatalogXlsx).toHaveBeenCalledWith(ITEMS, ITEMS.length);
  });

  it('отказ сервиса (чужая компания) — 403, файл не собирается', async () => {
    getSession.mockResolvedValue(leader);
    listCatalogItems.mockResolvedValue({ ok: false, error: 'forbidden' });
    const res = await getExport(req('co-2'));
    expect(res.status).toBe(403);
    await expect(res.json()).resolves.toEqual({ error: 'forbidden' });
    expect(renderCatalogXlsx).not.toHaveBeenCalled();
  });

  it('leader без ?company выгружает свою компанию из сессии', async () => {
    getSession.mockResolvedValue(leader);
    const res = await getExport(req());
    expect(res.status).toBe(200);
    expect(listCatalogItems).toHaveBeenCalledWith({}, leader, {
      companyId: 'co-1',
      includeInactive: true,
      limit: 10_000,
    });
  });

  it('default-deny профиль руководителя не выгружает каталог даже своей компании', async () => {
    // Находка ревью PR-2: роут был единственным входом в данные раздела мимо
    // capability-модели — скрытая карточка это внешний вид, а не защита (§2b).
    getSession.mockResolvedValue(leader);
    canAccessSettingsSection.mockReturnValue(false);
    const res = await getExport(req('co-1'));
    expect(res.status).toBe(403);
    expect(listCatalogItems).not.toHaveBeenCalled();
  });

  it('совсем без компании (admin без ?company) — 400, сервис не тронут', async () => {
    getSession.mockResolvedValue(admin);
    const res = await getExport(req());
    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toEqual({ error: 'company_required' });
    expect(listCatalogItems).not.toHaveBeenCalled();
  });
});
