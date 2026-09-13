import { afterEach, describe, expect, it, vi } from 'vitest';
import { FakeBitrixSource } from '@/lib/services/bitrix/adapter-fake';
import {
  FAKE_COMMENTS,
  FAKE_COMPANIES,
  FAKE_CONTACTS,
  FAKE_DEALS,
  FAKE_FILES,
  FAKE_LEADS,
  FAKE_PORTAL,
  FAKE_STAGES,
  FAKE_TASKS,
  FAKE_USERS,
} from '@/lib/services/bitrix/fixtures/portal';
import { BitrixSourceError, type BitrixSource } from '@/lib/services/bitrix/source';

/**
 * Этап 2 ТЗ 12.09.2026 (`У-203`): контракт `fake`-источника и связность его
 * фикстуры. Числа закреплены критериями приёмки пакета 16 §10 — тесты
 * конвейера сравнивают сводки с ними, поэтому фикстура не может «поплыть».
 */

async function collect<T>(it: AsyncIterable<T>): Promise<T[]> {
  const out: T[] = [];
  for await (const item of it) out.push(item);
  return out;
}

const ids = (rows: { id: string }[]) => new Set(rows.map((r) => r.id));

const source: BitrixSource = new FakeBitrixSource();
const ALL = {};

afterEach(() => {
  vi.doUnmock('@/lib/services/bitrix/fixtures/portal');
  vi.resetModules();
});

describe('FakeBitrixSource — состав фикстуры (пакет 16 §10)', () => {
  it('check → ok с доменом портала и именем «пользователя»', async () => {
    expect(await source.check()).toEqual({
      ok: true,
      portal: FAKE_PORTAL,
      user: 'Фикстура Битрикс24',
    });
    expect(FAKE_PORTAL).toBe('demo.bitrix24.ru');
  });

  it('3 пользователя, один уволен и без почты', async () => {
    const users = await collect(source.users());
    expect(users).toEqual(FAKE_USERS);
    expect(users).toHaveLength(3);
    expect(users.filter((u) => !u.active)).toHaveLength(1);
    expect(users.filter((u) => u.email === null)).toHaveLength(1);
  });

  it('стадии: 5 у сделок (общее направление) и 4 статуса лидов, без дублей id внутри сущности', async () => {
    const stages = await source.stages();
    expect(stages).toBe(FAKE_STAGES);
    const deal = stages.filter((s) => s.entity === 'deal');
    const lead = stages.filter((s) => s.entity === 'lead');
    expect(deal).toHaveLength(5);
    expect(lead).toHaveLength(4);
    expect(stages.every((s) => s.categoryId === null)).toBe(true);
    expect(new Set(deal.map((s) => s.id)).size).toBe(deal.length);
    expect(new Set(lead.map((s) => s.id)).size).toBe(lead.length);
    expect(deal.map((s) => s.semantics).sort()).toEqual(
      ['failure', 'process', 'process', 'process', 'success'].sort()
    );
  });

  it('5 / 8 / 6 / 6 / 4 записей без фильтра — всё, что в фикстуре', async () => {
    expect(await collect(source.companies(ALL))).toEqual(FAKE_COMPANIES);
    expect(await collect(source.contacts(ALL))).toEqual(FAKE_CONTACTS);
    expect(await collect(source.leads(ALL))).toEqual(FAKE_LEADS);
    expect(await collect(source.deals(ALL))).toEqual(FAKE_DEALS);
    expect(await collect(source.tasks(ALL))).toEqual(FAKE_TASKS);
    expect(FAKE_COMPANIES).toHaveLength(5);
    expect(FAKE_CONTACTS).toHaveLength(8);
    expect(FAKE_LEADS).toHaveLength(6);
    expect(FAKE_DEALS).toHaveLength(6);
    expect(FAKE_TASKS).toHaveLength(4);
    expect(FAKE_FILES).toHaveLength(3);
    expect(FAKE_COMMENTS).toHaveLength(10);
  });

  it('компании: две с ИНН для существующих организаций, одна по названию, две новые', () => {
    const withInn = FAKE_COMPANIES.filter((c) => c.inn !== null);
    expect(withInn).toHaveLength(3);
    // Первые две — ИНН организаций сида, третья — новая (ИП, 12 знаков).
    expect(FAKE_COMPANIES[0].inn).toMatch(/^\d{10}$/);
    expect(FAKE_COMPANIES[1].inn).toMatch(/^\d{10}$/);
    expect(FAKE_COMPANIES[3].inn).toMatch(/^\d{12}$/);
    expect(FAKE_COMPANIES[2].title).toContain('Вектор Плюс');
    expect(FAKE_COMPANIES[2].inn).toBeNull();
    expect(new Set(FAKE_COMPANIES.map((c) => c.id)).size).toBe(5);
  });

  it('контакты: один с общим телефоном и один без имени и компании', () => {
    const phones = FAKE_CONTACTS.flatMap((c) => c.phones);
    const shared = phones.filter((p, i) => phones.indexOf(p) !== i);
    expect(shared).toEqual(['+7 812 777 88 99']);
    const orphan = FAKE_CONTACTS.filter((c) => c.companyId === null);
    expect(orphan).toHaveLength(1);
    expect(orphan[0]).toMatchObject({ name: '', lastName: '' });
  });

  it('сделки: ровно 2 WON и 1 LOSE, закрытость согласована со стадией', () => {
    expect(FAKE_DEALS.filter((d) => d.stageId === 'WON')).toHaveLength(2);
    expect(FAKE_DEALS.filter((d) => d.stageId === 'LOSE')).toHaveLength(1);
    for (const deal of FAKE_DEALS) {
      const terminal = deal.stageId === 'WON' || deal.stageId === 'LOSE';
      expect(deal.closed, `сделка ${deal.id}`).toBe(terminal);
      expect(deal.closeDate !== null, `дата закрытия сделки ${deal.id}`).toBe(terminal);
      expect(deal.categoryId).toBe('0');
    }
  });

  it('задачи: статусы из словаря, завершённая — одна, у неё есть closedAt', () => {
    expect(FAKE_TASKS.map((t) => t.status).sort()).toEqual([2, 3, 5, 6]);
    const done = FAKE_TASKS.filter((t) => t.status === 5);
    expect(done).toHaveLength(1);
    expect(done[0].closedAt).toBeInstanceOf(Date);
    expect(FAKE_TASKS.filter((t) => t.status !== 5).every((t) => t.closedAt === null)).toBe(true);
  });
});

describe('FakeBitrixSource — связность фикстуры', () => {
  const companyIds = ids(FAKE_COMPANIES);
  const contactIds = ids(FAKE_CONTACTS);
  const leadIds = ids(FAKE_LEADS);
  const dealIds = ids(FAKE_DEALS);
  const userIds = ids(FAKE_USERS);
  const dealStageIds = new Set(FAKE_STAGES.filter((s) => s.entity === 'deal').map((s) => s.id));
  const leadStatusIds = new Set(FAKE_STAGES.filter((s) => s.entity === 'lead').map((s) => s.id));

  it('companyId контактов и сделок — среди компаний (или null)', () => {
    for (const c of FAKE_CONTACTS) {
      if (c.companyId !== null) expect(companyIds.has(c.companyId), `контакт ${c.id}`).toBe(true);
    }
    for (const d of FAKE_DEALS) {
      if (d.companyId !== null) expect(companyIds.has(d.companyId), `сделка ${d.id}`).toBe(true);
    }
  });

  it('contactId и leadId сделок — среди контактов и лидов (или null)', () => {
    for (const d of FAKE_DEALS) {
      if (d.contactId !== null) expect(contactIds.has(d.contactId), `сделка ${d.id}`).toBe(true);
      if (d.leadId !== null) expect(leadIds.has(d.leadId), `сделка ${d.id}`).toBe(true);
    }
    expect(FAKE_DEALS.filter((d) => d.leadId !== null).length).toBeGreaterThan(0);
  });

  it('стадии сделок и статусы лидов — из списка stages()', () => {
    for (const d of FAKE_DEALS) expect(dealStageIds.has(d.stageId), `сделка ${d.id}`).toBe(true);
    for (const l of FAKE_LEADS) expect(leadStatusIds.has(l.statusId), `лид ${l.id}`).toBe(true);
  });

  it('ответственные, авторы и создатели — среди пользователей (или null)', () => {
    const assigned = [
      ...FAKE_COMPANIES.map((c) => c.assignedById),
      ...FAKE_CONTACTS.map((c) => c.assignedById),
      ...FAKE_LEADS.map((l) => l.assignedById),
      ...FAKE_DEALS.map((d) => d.assignedById),
      ...FAKE_TASKS.map((t) => t.responsibleId),
      ...FAKE_TASKS.map((t) => t.createdById),
      ...FAKE_COMMENTS.map((c) => c.authorId),
    ];
    for (const id of assigned)
      if (id !== null) expect(userIds.has(id), `пользователь ${id}`).toBe(true);
    // Хотя бы одна запись без ответственного — конвейер должен уметь брать менеджера по умолчанию.
    expect(assigned.some((id) => id === null)).toBe(true);
  });

  it('связи задач ведут на существующие компании, сделки, лиды и контакты', () => {
    const byKind = { company: companyIds, deal: dealIds, lead: leadIds, contact: contactIds };
    const kinds = new Set<string>();
    for (const t of FAKE_TASKS) {
      expect(t.crmLinks.length, `задача ${t.id}`).toBeGreaterThan(0);
      for (const link of t.crmLinks) {
        kinds.add(link.kind);
        expect(byKind[link.kind].has(link.id), `задача ${t.id} → ${link.kind} ${link.id}`).toBe(
          true
        );
      }
    }
    expect([...kinds].sort()).toEqual(['company', 'contact', 'deal', 'lead']);
  });

  it('комментарии и файлы привязаны к существующим сущностям своего вида', () => {
    const byEntity = { deal: dealIds, company: companyIds, contact: contactIds };
    for (const c of FAKE_COMMENTS) {
      expect(byEntity[c.entity].has(c.entityId), `комментарий ${c.id}`).toBe(true);
    }
    for (const f of FAKE_FILES) {
      expect(byEntity[f.entity].has(f.entityId), `файл ${f.id}`).toBe(true);
      expect(f.downloadUrl).toMatch(/^https:\/\//);
    }
    expect(new Set(FAKE_COMMENTS.map((c) => c.id)).size).toBe(10);
    expect(new Set(FAKE_FILES.map((f) => f.id)).size).toBe(3);
  });
});

describe('FakeBitrixSource — фильтры периода и «только открытые»', () => {
  it('from отсекает записи, созданные раньше', async () => {
    const from = new Date('2026-01-01T00:00:00Z');
    expect((await collect(source.companies({ from }))).map((c) => c.id)).toEqual([
      '103',
      '104',
      '105',
    ]);
    expect((await collect(source.contacts({ from }))).map((c) => c.id)).toEqual([
      '205',
      '206',
      '207',
      '208',
    ]);
    expect((await collect(source.leads({ from }))).map((l) => l.id)).toEqual([
      '302',
      '303',
      '304',
      '305',
      '306',
    ]);
    expect((await collect(source.deals({ from }))).map((d) => d.id)).toEqual([
      '402',
      '403',
      '404',
      '405',
      '406',
    ]);
    expect((await collect(source.tasks({ from }))).map((t) => t.id)).toEqual(['502', '503', '504']);
  });

  it('to отсекает записи, созданные позже; граница включительно', async () => {
    const to = new Date('2025-12-31T23:59:59Z');
    expect((await collect(source.companies({ to }))).map((c) => c.id)).toEqual(['101', '102']);
    // Ровно на границе — остаётся.
    const exact = FAKE_COMPANIES[0].createdAt!;
    expect((await collect(source.companies({ from: exact, to: exact }))).map((c) => c.id)).toEqual([
      '101',
    ]);
  });

  it('from и to вместе — окно', async () => {
    const window = { from: new Date('2025-12-01T00:00:00Z'), to: new Date('2026-02-01T00:00:00Z') };
    expect((await collect(source.companies(window))).map((c) => c.id)).toEqual(['102', '103']);
    expect((await collect(source.deals(window))).map((d) => d.id)).toEqual(['403']);
  });

  it('окно вне фикстуры → пусто', async () => {
    const future = { from: new Date('2099-01-01T00:00:00Z') };
    expect(await collect(source.companies(future))).toEqual([]);
    expect(await collect(source.tasks(future))).toEqual([]);
  });

  it('openOnly: только незакрытые сделки и незавершённые задачи', async () => {
    const deals = await collect(source.deals({ openOnly: true }));
    expect(deals.map((d) => d.id)).toEqual(['402', '405', '406']);
    expect(deals.every((d) => !d.closed)).toBe(true);
    const tasks = await collect(source.tasks({ openOnly: true }));
    expect(tasks.map((t) => t.id)).toEqual(['502', '503', '504']);
    expect(tasks.every((t) => t.status !== 5)).toBe(true);
  });

  it('openOnly: false и undefined — ничего не отсекают', async () => {
    expect(await collect(source.deals({ openOnly: false }))).toHaveLength(6);
    expect(await collect(source.tasks({ openOnly: undefined }))).toHaveLength(4);
  });

  it('openOnly сочетается с периодом', async () => {
    const f = { from: new Date('2026-03-10T00:00:00Z'), openOnly: true };
    expect((await collect(source.deals(f))).map((d) => d.id)).toEqual(['405', '406']);
    expect((await collect(source.tasks(f))).map((t) => t.id)).toEqual(['504']);
  });

  it('запись без даты создания проходит любой фильтр периода', async () => {
    // В фикстуре все даты заполнены; подменяем её, чтобы проверить правило
    // «нет даты — не отсекаем» на свежем экземпляре модуля.
    vi.doMock('@/lib/services/bitrix/fixtures/portal', async (importOriginal) => {
      const original =
        await importOriginal<typeof import('@/lib/services/bitrix/fixtures/portal')>();
      return {
        ...original,
        FAKE_COMPANIES: [{ ...original.FAKE_COMPANIES[0], id: 'no-date', createdAt: null }],
      };
    });
    const { FakeBitrixSource: Patched } = await import('@/lib/services/bitrix/adapter-fake');
    const patched = new Patched();
    const strict = { from: new Date('2099-01-01T00:00:00Z'), to: new Date('2099-01-02T00:00:00Z') };
    expect((await collect(patched.companies(strict))).map((c) => c.id)).toEqual(['no-date']);
  });
});

describe('FakeBitrixSource — комментарии, файлы, скачивание', () => {
  it('comments: по виду сущности и списку id, порядок фикстуры', async () => {
    const deal = await collect(source.comments('deal', ['401', '402']));
    expect(deal.map((c) => c.id)).toEqual(['601', '602', '603']);
    expect(deal.every((c) => c.entity === 'deal')).toBe(true);
    expect((await collect(source.comments('company', ['101']))).map((c) => c.id)).toEqual(['606']);
    expect((await collect(source.comments('contact', ['201', '207']))).map((c) => c.id)).toEqual([
      '608',
      '609',
    ]);
  });

  it('comments: чужой вид сущности или пустой список → пусто', async () => {
    // 401 — сделка; как компания она комментариев не имеет.
    expect(await collect(source.comments('company', ['401']))).toEqual([]);
    expect(await collect(source.comments('deal', []))).toEqual([]);
    expect(await collect(source.comments('deal', ['999']))).toEqual([]);
  });

  it('comments: пустой комментарий фикстуры (610 у компании 105) наружу не выходит — как у REST', async () => {
    const all = await collect(source.comments('company', ['101', '102', '105']));
    expect(all.map((c) => c.id)).toEqual(['606', '607']);
    expect(all.some((c) => c.text.trim() === '')).toBe(false);
  });

  it('files: по виду сущности и id', async () => {
    expect((await collect(source.files('deal', ['401', '402']))).map((f) => f.id)).toEqual([
      '701',
      '702',
    ]);
    expect((await collect(source.files('company', ['101']))).map((f) => f.id)).toEqual(['703']);
    expect(await collect(source.files('deal', ['101']))).toEqual([]);
    expect(await collect(source.files('company', []))).toEqual([]);
  });

  it('download: отдаёт PDF (magic bytes %PDF-) для файла фикстуры', async () => {
    const buf = await source.download(FAKE_FILES[0]);
    expect(Buffer.isBuffer(buf)).toBe(true);
    expect(buf.subarray(0, 5).toString('utf8')).toBe('%PDF-');
    expect(buf.toString('utf8')).toContain('%%EOF');
  });

  it('download: чужой id → BitrixSourceError(api) с именем файла, без URL', async () => {
    const alien = { ...FAKE_FILES[0], id: '999', name: 'чужой.pdf' };
    await expect(source.download(alien)).rejects.toMatchObject({
      name: 'BitrixSourceError',
      code: 'api',
      message: 'Файл «чужой.pdf» не найден в фикстуре',
    });
    await expect(source.download(alien)).rejects.toBeInstanceOf(BitrixSourceError);
  });
});
