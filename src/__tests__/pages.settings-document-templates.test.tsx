// @vitest-environment jsdom
/**
 * Страницы «Шаблоны документов» (`У-160`, этап 6, PR-7): админ правит тексты
 * выбранной компании, руководитель — только своей.
 *
 * Экран здесь намеренно замокан заглушкой, печатающей пропсы: проверяем не
 * вёрстку, а решения самой страницы — какой раздел она защищает, чью компанию
 * считает активной и что отдаёт экрану, когда данных нет. Скрытый на экране
 * селект компаний защитой не считается: границу держит серверный гард и
 * сервис, поэтому обращение к ним и пиннится.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { renderServerComponent } from './helpers/renderServerComponent';

const { requireSettingsSection } = vi.hoisted(() => ({ requireSettingsSection: vi.fn() }));
vi.mock('@/lib/auth/requireSettings', () => ({ requireSettingsSection }));

// Реального клиента базы не поднимаем: страница лишь передаёт его в сервис.
vi.mock('@/lib/db/prisma', () => ({ prisma: {} }));

const { listCompanyOptions } = vi.hoisted(() => ({ listCompanyOptions: vi.fn() }));
vi.mock('@/lib/services/admin/orders', () => ({ listCompanyOptions }));

const { listCompanyTemplates } = vi.hoisted(() => ({ listCompanyTemplates: vi.fn() }));
vi.mock('@/lib/services/documents/templates', () => ({ listCompanyTemplates }));

// Экран заменён заглушкой: страница проверяется по пропсам, а не по разметке.
vi.mock('@/components/settings/document-templates-screen', () => ({
  DocumentTemplatesScreen: (props: Record<string, unknown>) =>
    React.createElement(
      'div',
      { 'data-testid': 'document-templates-screen' },
      JSON.stringify(props)
    ),
}));

import AdminDocumentTemplatesPage from '@/app/admin/settings/catalogs/document-templates/page';
import LeaderDocumentTemplatesPage from '@/app/leader/settings/catalogs/document-templates/page';

const ADMIN = { sub: 'a1', role: 'admin' as const };
const LEADER = { sub: 'l1', role: 'leader' as const };

const COMPANIES = [
  { id: 'c1', name: 'Аврора' },
  { id: 'c2', name: 'Промтехносфера' },
];

// updatedAt держим null: заглушка сериализует пропсы в JSON, а живая дата
// превратилась бы в строку и сравнение стало бы про формат, а не про смысл.
const ROW = {
  slot: 'subject.contract',
  body: 'Исполнитель обязуется провести обучение.',
  isCustom: true,
  revision: 3,
  updatedAt: null,
};

beforeEach(() => {
  requireSettingsSection
    .mockReset()
    .mockImplementation((_id: string, cabinet: string) =>
      Promise.resolve(cabinet === 'admin' ? ADMIN : LEADER)
    );
  listCompanyOptions.mockReset().mockResolvedValue(COMPANIES);
  listCompanyTemplates.mockReset().mockResolvedValue({ ok: true, rows: [ROW] });
});

/** Рендерит страницу и возвращает пропсы, дошедшие до экрана. */
async function renderPage(
  page: (a: { searchParams: Promise<Record<string, string>> }) => Promise<React.ReactNode>,
  params: Record<string, string> = {}
) {
  const { container } = await renderServerComponent(
    page({ searchParams: Promise.resolve(params) })
  );
  const el = container.querySelector('[data-testid="document-templates-screen"]');
  return JSON.parse(el!.textContent!) as Record<string, unknown>;
}

describe('админ: /admin/settings/catalogs/document-templates', () => {
  it('гард зовётся с id раздела и своим кабинетом; без ?company активна первая компания', async () => {
    const props = await renderPage(AdminDocumentTemplatesPage);

    // Именно этот id раздела: ошибись в нём — страница пустит тех, кому
    // раздел не выдан, ведь пункт меню скрывается отдельно от проверки.
    expect(requireSettingsSection).toHaveBeenCalledWith('catalogs.documentTemplates', 'admin');
    expect(props.cabinet).toBe('admin');
    expect(props.hasCompany).toBe(true);
    expect(props.companies).toEqual(COMPANIES);
    // Список компаний уже отсортирован сервисом — берём первую как есть.
    expect(props.activeCompanyId).toBe('c1');
    expect(props.rows).toEqual([ROW]);
    expect(listCompanyTemplates).toHaveBeenCalledWith({}, ADMIN, 'c1');
  });

  it('?company выбирает компанию: тексты читаются ровно для неё', async () => {
    const props = await renderPage(AdminDocumentTemplatesPage, { company: 'c2' });

    expect(props.activeCompanyId).toBe('c2');
    expect(listCompanyTemplates).toHaveBeenCalledWith({}, ADMIN, 'c2');
  });

  it('пустой ?company= не считается выбором: подставляется первая компания', async () => {
    // Так выглядит отправка селекта без выбранного значения — страница не
    // должна уйти в ветку «компании нет» и показать пустой экран.
    const props = await renderPage(AdminDocumentTemplatesPage, { company: '' });

    expect(props.activeCompanyId).toBe('c1');
    expect(listCompanyTemplates).toHaveBeenCalledWith({}, ADMIN, 'c1');
  });

  it('компаний нет вовсе: сервис не зовём и честно говорим экрану hasCompany=false', async () => {
    listCompanyOptions.mockResolvedValue([]);
    const props = await renderPage(AdminDocumentTemplatesPage);

    expect(listCompanyTemplates).not.toHaveBeenCalled();
    expect(props.hasCompany).toBe(false);
    expect(props.activeCompanyId).toBeNull();
    expect(props.rows).toEqual([]);
  });

  it('отказ сервиса не роняет страницу: экран получает пустой список', async () => {
    listCompanyTemplates.mockResolvedValue({ ok: false, error: 'forbidden' });
    const props = await renderPage(AdminDocumentTemplatesPage, { company: 'c2' });

    // Падение здесь стоило бы всей страницы настроек, поэтому отказ —
    // это просто «нечего показать», а не исключение.
    expect(props.rows).toEqual([]);
    expect(props.activeCompanyId).toBe('c2');
  });
});

describe('руководитель: /leader/settings/catalogs/document-templates', () => {
  it('гард своего кабинета; компания берётся из сессии', async () => {
    const leaderWithCompany = { ...LEADER, companyId: 'c9' };
    requireSettingsSection.mockResolvedValueOnce(leaderWithCompany);
    const props = await renderPage(LeaderDocumentTemplatesPage);

    expect(requireSettingsSection).toHaveBeenCalledWith('catalogs.documentTemplates', 'leader');
    expect(props.cabinet).toBe('leader');
    expect(props.hasCompany).toBe(true);
    expect(props.activeCompanyId).toBe('c9');
    // Селекта компаний у руководителя нет — выбирать не из чего.
    expect(props.companies).toEqual([]);
    expect(props.rows).toEqual([ROW]);
    expect(listCompanyTemplates).toHaveBeenCalledWith({}, leaderWithCompany, 'c9');
  });

  it('?company= из адреса игнорируется: правится только своя компания', async () => {
    requireSettingsSection.mockResolvedValueOnce({ ...LEADER, companyId: 'c9' });
    const props = await renderPage(LeaderDocumentTemplatesPage, { company: 'c1' });

    // Подмена компании в адресной строке — самый дешёвый способ залезть в
    // чужие тексты, поэтому параметр не читается вовсе.
    expect(props.activeCompanyId).toBe('c9');
    expect(listCompanyTemplates).toHaveBeenCalledWith({}, expect.anything(), 'c9');
    expect(listCompanyOptions).not.toHaveBeenCalled();
  });

  it('руководитель без компании: сервис не зовём, hasCompany=false', async () => {
    const props = await renderPage(LeaderDocumentTemplatesPage);

    expect(listCompanyTemplates).not.toHaveBeenCalled();
    expect(props.hasCompany).toBe(false);
    expect(props.activeCompanyId).toBeNull();
    expect(props.rows).toEqual([]);
  });

  it('отказ сервиса (например, компания из сессии уже удалена) не роняет страницу', async () => {
    requireSettingsSection.mockResolvedValueOnce({ ...LEADER, companyId: 'c9' });
    listCompanyTemplates.mockResolvedValue({ ok: false, error: 'forbidden' });
    const props = await renderPage(LeaderDocumentTemplatesPage);

    expect(props.rows).toEqual([]);
    expect(props.hasCompany).toBe(true);
  });
});
