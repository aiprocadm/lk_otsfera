/**
 * Действия раздела «Миграция из Битрикс24» (этап 2 ТЗ 12.09.2026, `У-188`,
 * `У-202`, `У-193`): сохранение подключения, проба и пакеты миграции —
 * создание, состояние для полосы прогресса и таблицы сопоставления. Гард
 * раздела и поведенческий флаг `bitrix_migration` — на каждом действии (§4).
 * Разбор адресов (`portalHost`, `normalizeWebhookUrl`) и разбор полей формы —
 * настоящие, без мока: проверяем связку. Сервис пакета замокан.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const {
  requireSettingsSection,
  notFoundIfDisabled,
  findFirst,
  saveSettings,
  resetIntegrationSettingsCache,
  testIntegration,
  revalidatePath,
} = vi.hoisted(() => ({
  requireSettingsSection: vi.fn(),
  notFoundIfDisabled: vi.fn(),
  findFirst: vi.fn(),
  saveSettings: vi.fn(),
  resetIntegrationSettingsCache: vi.fn(),
  testIntegration: vi.fn(),
  revalidatePath: vi.fn(),
}));

vi.mock('@/lib/auth/requireSettings', () => ({ requireSettingsSection }));
vi.mock('@/lib/featureFlags', () => ({ notFoundIfDisabled }));
vi.mock('@/lib/db/prisma', () => ({ prisma: { user: { findFirst } } }));
vi.mock('@/lib/config/integrationSettings', () => ({ saveSettings, getSettingValues: vi.fn() }));
vi.mock('@/lib/config/integrationSettingsCache', () => ({ resetIntegrationSettingsCache }));
vi.mock('@/lib/services/admin/testIntegration', () => ({ testIntegration }));
vi.mock('next/cache', () => ({ revalidatePath }));

const { createBitrixBatch, getBitrixBatchState, saveBatchMapping, applyBitrixBatch } = vi.hoisted(
  () => ({
    createBitrixBatch: vi.fn(),
    getBitrixBatchState: vi.fn(),
    saveBatchMapping: vi.fn(),
    applyBitrixBatch: vi.fn(),
  })
);
vi.mock('@/lib/services/bitrix/preview', () => ({
  createBitrixBatch,
  getBitrixBatchState,
  saveBatchMapping,
  applyBitrixBatch,
}));

const { requestRollback } = vi.hoisted(() => ({ requestRollback: vi.fn() }));
vi.mock('@/lib/services/bitrix/rollback', () => ({ requestRollback }));

// Пауза расписания повтора живёт в общем сервисе расписаний обмена: действие
// только выбирает нужное расписание и обновляет СВОЙ экран.
const { setSchedulePaused } = vi.hoisted(() => ({ setSchedulePaused: vi.fn() }));
vi.mock('@/lib/services/admin/syncControl', () => ({ setSchedulePaused }));

import {
  saveBitrixConnectionAction,
  testBitrixConnectionAction,
  createBitrixBatchAction,
  getBitrixBatchStateAction,
  saveBatchMappingAction,
  applyBitrixBatchAction,
  rollbackBitrixBatchAction,
  setBitrixResyncPausedAction,
} from '@/server-actions/admin/bitrix';
import { BITRIX_RESYNC_SCHEDULER_ID } from '@/lib/jobs/scheduling';

const SESSION = { sub: 'admin-1', role: 'admin' as const, companyId: 'c1' };
const PATH = '/admin/settings/integrations/bitrix';
const BATCHES_PATH = '/admin/settings/integrations/bitrix/history';
const FLAG_OFF = new Response('Not Found', { status: 404 });

function fd(data: Record<string, string | Blob>): FormData {
  const f = new FormData();
  for (const [k, v] of Object.entries(data)) f.append(k, v);
  return f;
}

beforeEach(() => {
  vi.clearAllMocks();
  requireSettingsSection.mockResolvedValue(SESSION);
  notFoundIfDisabled.mockReturnValue(null); // флаг включён
  findFirst.mockResolvedValue({ id: 'm1' });
  saveSettings.mockResolvedValue({ ok: true });
  createBitrixBatch.mockResolvedValue({ ok: true, batchId: 'b-1' });
  getBitrixBatchState.mockResolvedValue({
    ok: true,
    status: 'preview_pending',
    progress: { step: 'deal', done: 12, total: 100, updatedAt: '2026-09-13T09:00:00.000Z' },
  });
  saveBatchMapping.mockResolvedValue({ ok: true });
  applyBitrixBatch.mockResolvedValue({ ok: true });
  requestRollback.mockResolvedValue({ ok: true });
  setSchedulePaused.mockResolvedValue({ ok: true, paused: true });
});

/** Аргументы, с которыми действие позвало сервис пакета. */
function createArgs() {
  return createBitrixBatch.mock.calls[0][2];
}

describe('saveBitrixConnectionAction', () => {
  it('счастливый путь: домен из полного адреса, вебхук нормализован, менеджер проверен в компании; сброс кэша и revalidate', async () => {
    const res = await saveBitrixConnectionAction(
      fd({
        bitrix_portalUrl: ' https://company.bitrix24.ru/crm/ ',
        bitrix_webhookUrl: 'https://company.bitrix24.ru/rest/1/abcDEF123/crm.lead.list',
        bitrix_defaultManagerId: ' m1 ',
      })
    );

    expect(res).toEqual({ ok: true });
    expect(requireSettingsSection).toHaveBeenCalledWith('integrations.bitrix', 'admin');
    expect(notFoundIfDisabled).toHaveBeenCalledWith('bitrix_migration');
    // Менеджер ищется только среди активных manager/leader своей компании.
    expect(findFirst).toHaveBeenCalledWith({
      where: {
        id: 'm1',
        role: { in: ['manager', 'leader'] },
        isActive: true,
        companyId: 'c1',
      },
      select: { id: true },
    });
    expect(saveSettings).toHaveBeenCalledWith(expect.anything(), 'admin-1', [
      { key: 'bitrix.portalUrl', value: 'company.bitrix24.ru' },
      { key: 'bitrix.webhookUrl', value: 'https://company.bitrix24.ru/rest/1/abcDEF123/' },
      { key: 'bitrix.defaultManagerId', value: 'm1' },
    ]);
    expect(resetIntegrationSettingsCache).toHaveBeenCalledTimes(1);
    expect(revalidatePath).toHaveBeenCalledWith(PATH);
  });

  it('флаг выключен → forbidden, до разбора полей и записи дело не доходит', async () => {
    notFoundIfDisabled.mockReturnValue(new Response('Not Found', { status: 404 }));
    const res = await saveBitrixConnectionAction(
      fd({ bitrix_portalUrl: 'company.bitrix24.ru', bitrix_defaultManagerId: 'm1' })
    );
    expect(res).toEqual({ ok: false, error: 'forbidden' });
    // Гард раздела всё равно отработал первым (страж матрицы настроек).
    expect(requireSettingsSection).toHaveBeenCalledWith('integrations.bitrix', 'admin');
    expect(findFirst).not.toHaveBeenCalled();
    expect(saveSettings).not.toHaveBeenCalled();
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it('пустые поля: портал и менеджер пустые, вебхук «не менять» — запись трёх пустых значений без похода за менеджером', async () => {
    const res = await saveBitrixConnectionAction(
      fd({ bitrix_portalUrl: '   ', bitrix_webhookUrl: '  ', bitrix_defaultManagerId: '' })
    );
    expect(res).toEqual({ ok: true });
    expect(findFirst).not.toHaveBeenCalled();
    expect(saveSettings).toHaveBeenCalledWith(expect.anything(), 'admin-1', [
      { key: 'bitrix.portalUrl', value: '' },
      { key: 'bitrix.webhookUrl', value: '' }, // пустой секрет = не менять
      { key: 'bitrix.defaultManagerId', value: '' },
    ]);
  });

  it('полей нет в форме вовсе (или это файлы, а не строки) — считается пустым', async () => {
    const res = await saveBitrixConnectionAction(
      fd({ bitrix_webhookUrl: new Blob(['not-a-string']) })
    );
    expect(res).toEqual({ ok: true });
    expect(saveSettings).toHaveBeenCalledWith(expect.anything(), 'admin-1', [
      { key: 'bitrix.portalUrl', value: '' },
      { key: 'bitrix.webhookUrl', value: '' },
      { key: 'bitrix.defaultManagerId', value: '' },
    ]);
  });

  it('адрес портала без имени хоста → validation с понятным текстом, записи нет', async () => {
    const res = await saveBitrixConnectionAction(
      fd({ bitrix_portalUrl: 'https://', bitrix_defaultManagerId: 'm1' })
    );
    expect(res).toEqual({
      ok: false,
      error: 'validation',
      message: 'Адрес портала указан неверно.',
    });
    expect(findFirst).not.toHaveBeenCalled();
    expect(saveSettings).not.toHaveBeenCalled();
    expect(resetIntegrationSettingsCache).not.toHaveBeenCalled();
  });

  it('портал без схемы принимается как домен', async () => {
    await saveBitrixConnectionAction(fd({ bitrix_portalUrl: 'company.bitrix24.ru' }));
    const entries = saveSettings.mock.calls[0][2];
    expect(entries[0]).toEqual({ key: 'bitrix.portalUrl', value: 'company.bitrix24.ru' });
  });

  it.each([
    ['не https', 'http://company.bitrix24.ru/rest/1/abc/'],
    ['не адрес', 'просто текст'],
    ['без /rest/<id>/<ключ>/', 'https://company.bitrix24.ru/crm/'],
  ])('вебхук %s → validation с подсказкой формы, записи нет', async (_name, webhook) => {
    const res = await saveBitrixConnectionAction(
      fd({ bitrix_portalUrl: 'company.bitrix24.ru', bitrix_webhookUrl: webhook })
    );
    expect(res).toEqual({
      ok: false,
      error: 'validation',
      message: 'Вебхук должен иметь вид https://<портал>/rest/<id>/<ключ>/.',
    });
    expect(saveSettings).not.toHaveBeenCalled();
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it('менеджер не из компании (не найден) → validation, записи нет', async () => {
    findFirst.mockResolvedValue(null);
    const res = await saveBitrixConnectionAction(
      fd({ bitrix_portalUrl: 'company.bitrix24.ru', bitrix_defaultManagerId: 'stranger' })
    );
    expect(res).toEqual({
      ok: false,
      error: 'validation',
      message: 'Менеджер по умолчанию не найден в вашей компании.',
    });
    expect(findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ id: 'stranger' }) })
    );
    expect(saveSettings).not.toHaveBeenCalled();
    expect(resetIntegrationSettingsCache).not.toHaveBeenCalled();
  });

  it('у сессии нет компании — менеджера ищем по заведомо пустой компании, чтобы чужого не подхватить', async () => {
    requireSettingsSection.mockResolvedValue({ sub: 'admin-2', role: 'admin' });
    findFirst.mockResolvedValue(null);
    const res = await saveBitrixConnectionAction(fd({ bitrix_defaultManagerId: 'm1' }));
    expect(findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ companyId: '__none__' }) })
    );
    expect(res).toMatchObject({ ok: false, error: 'validation' });
  });

  it('отказ хранилища (нет ключа шифрования) пробрасывается как есть, без сброса кэша и revalidate', async () => {
    saveSettings.mockResolvedValue({ ok: false, error: 'secrets_key_missing' });
    const res = await saveBitrixConnectionAction(
      fd({ bitrix_webhookUrl: 'https://company.bitrix24.ru/rest/1/abc/' })
    );
    expect(res).toEqual({ ok: false, error: 'secrets_key_missing' });
    expect(resetIntegrationSettingsCache).not.toHaveBeenCalled();
    expect(revalidatePath).not.toHaveBeenCalled();
  });
});

describe('testBitrixConnectionAction', () => {
  it('гард → флаг → универсальная проба по ключу bitrix; успех → revalidate и результат как есть', async () => {
    testIntegration.mockResolvedValue({ ok: true, success: true, message: 'Портал отвечает' });
    const res = await testBitrixConnectionAction(new FormData());
    expect(res).toEqual({ ok: true, success: true, message: 'Портал отвечает' });
    expect(requireSettingsSection).toHaveBeenCalledWith('integrations.bitrix', 'admin');
    expect(notFoundIfDisabled).toHaveBeenCalledWith('bitrix_migration');
    expect(testIntegration).toHaveBeenCalledWith(expect.anything(), SESSION, 'bitrix');
    expect(revalidatePath).toHaveBeenCalledWith(PATH);
  });

  it('неуспешная проба (ok, success=false) тоже revalidate-ится — lastError уже записан', async () => {
    testIntegration.mockResolvedValue({ ok: true, success: false, message: 'HTTP 401' });
    const res = await testBitrixConnectionAction(new FormData());
    expect(res).toEqual({ ok: true, success: false, message: 'HTTP 401' });
    expect(revalidatePath).toHaveBeenCalledWith(PATH);
  });

  it('ошибка сервиса (ok=false) возвращается без revalidate', async () => {
    testIntegration.mockResolvedValue({ ok: false, error: 'not_configured' });
    const res = await testBitrixConnectionAction(new FormData());
    expect(res).toEqual({ ok: false, error: 'not_configured' });
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it('флаг выключен → forbidden, проба не запускается', async () => {
    notFoundIfDisabled.mockReturnValue(new Response('Not Found', { status: 404 }));
    const res = await testBitrixConnectionAction(new FormData());
    expect(res).toEqual({ ok: false, error: 'forbidden' });
    expect(requireSettingsSection).toHaveBeenCalledWith('integrations.bitrix', 'admin');
    expect(testIntegration).not.toHaveBeenCalled();
    expect(revalidatePath).not.toHaveBeenCalled();
  });
});

describe('createBitrixBatchAction', () => {
  it('счастливый путь: источник, период, флажки и ключи выгрузок уходят в сервис; список перечитывается', async () => {
    const res = await createBitrixBatchAction(
      fd({
        source: 'file',
        from: '2026-01-01',
        to: '2026-06-30',
        openOnly: 'on',
        withFiles: 'on',
        defaultManagerId: 'm1',
        fileKeys: JSON.stringify([
          { key: 'uploads/c1/1-companies.csv', name: 'companies.csv', entity: 'company' },
        ]),
      })
    );

    expect(res).toEqual({ ok: true, batchId: 'b-1' });
    expect(requireSettingsSection).toHaveBeenCalledWith('integrations.bitrix', 'admin');
    expect(notFoundIfDisabled).toHaveBeenCalledWith('bitrix_migration');
    expect(createBitrixBatch).toHaveBeenCalledWith(expect.anything(), SESSION, {
      source: 'file',
      from: '2026-01-01',
      to: '2026-06-30',
      openOnly: true,
      withFiles: true,
      defaultManagerId: 'm1',
      fileKeys: [{ key: 'uploads/c1/1-companies.csv', name: 'companies.csv', entity: 'company' }],
    });
    expect(revalidatePath).toHaveBeenCalledWith(BATCHES_PATH);
  });

  it('пустая форма: источник по умолчанию «портал», флажки сняты, период и менеджер пустые', async () => {
    await createBitrixBatchAction(new FormData());
    expect(createArgs()).toEqual({
      source: 'rest',
      from: '',
      to: '',
      openOnly: false,
      withFiles: false,
      defaultManagerId: '',
      fileKeys: [],
    });
  });

  it('любой источник, кроме «file», считается порталом — подделка поля ничего не даёт', async () => {
    await createBitrixBatchAction(fd({ source: 'ftp' }));
    expect(createArgs().source).toBe('rest');
  });

  it.each([
    ['поля нет вовсе', undefined],
    ['пустая строка', ''],
    ['одни пробелы', '   '],
    ['не JSON', 'companies.csv'],
    ['JSON, но не список', JSON.stringify({ key: 'a', entity: 'company' })],
  ])('ключи выгрузок (%s) — пустой список, а не падение', async (_name, raw) => {
    await createBitrixBatchAction(raw === undefined ? new FormData() : fd({ fileKeys: raw }));
    expect(createArgs().fileKeys).toEqual([]);
  });

  it('поле ключей — файл, а не строка: тоже пустой список', async () => {
    await createBitrixBatchAction(fd({ fileKeys: new Blob(['[]']) }));
    expect(createArgs().fileKeys).toEqual([]);
  });

  it('мусорные элементы списка отбрасываются поштучно, имя по умолчанию — сам ключ', async () => {
    await createBitrixBatchAction(
      fd({
        fileKeys: JSON.stringify([
          null, // не объект
          'строка', // не объект
          { name: 'без ключа.csv', entity: 'company' }, // нет key
          { key: 42, entity: 'company' }, // key не строка
          { key: '', entity: 'company' }, // пустой key
          { key: 'uploads/x.csv' }, // нет entity
          { key: 'uploads/y.csv', entity: 7 }, // entity не строка
          { key: 'uploads/z.csv', entity: 'deal' }, // имени нет — возьмём ключ
          { key: 'uploads/w.csv', name: 5, entity: 'lead' }, // имя не строка
          { key: 'uploads/v.csv', name: 'сделки.csv', entity: 'deal' },
        ]),
      })
    );
    expect(createArgs().fileKeys).toEqual([
      { key: 'uploads/z.csv', name: 'uploads/z.csv', entity: 'deal' },
      { key: 'uploads/w.csv', name: 'uploads/w.csv', entity: 'lead' },
      { key: 'uploads/v.csv', name: 'сделки.csv', entity: 'deal' },
    ]);
  });

  it('флаг выключен → forbidden, пакет не создаётся', async () => {
    notFoundIfDisabled.mockReturnValue(FLAG_OFF);
    const res = await createBitrixBatchAction(fd({ source: 'file' }));
    expect(res).toEqual({ ok: false, error: 'forbidden' });
    expect(requireSettingsSection).toHaveBeenCalledWith('integrations.bitrix', 'admin');
    expect(createBitrixBatch).not.toHaveBeenCalled();
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it('отказ сервиса возвращается как есть, без перечитывания списка', async () => {
    createBitrixBatch.mockResolvedValue({ ok: false, error: 'invalid' });
    const res = await createBitrixBatchAction(fd({ source: 'file' }));
    expect(res).toEqual({ ok: false, error: 'invalid' });
    expect(revalidatePath).not.toHaveBeenCalled();
  });
});

describe('getBitrixBatchStateAction', () => {
  it('состояние с прогрессом: шаг и сделано — без служебной отметки времени', async () => {
    const res = await getBitrixBatchStateAction('b-1');
    expect(res).toEqual({
      ok: true,
      status: 'preview_pending',
      progress: { step: 'deal', done: 12 },
    });
    expect(requireSettingsSection).toHaveBeenCalledWith('integrations.bitrix', 'admin');
    expect(notFoundIfDisabled).toHaveBeenCalledWith('bitrix_migration');
    expect(getBitrixBatchState).toHaveBeenCalledWith(expect.anything(), SESSION, 'b-1');
    // Опрос ничего не меняет — перечитывать страницу незачем.
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it('работа ещё не началась — прогресса нет', async () => {
    getBitrixBatchState.mockResolvedValue({ ok: true, status: 'preview_pending', progress: null });
    const res = await getBitrixBatchStateAction('b-1');
    expect(res).toEqual({ ok: true, status: 'preview_pending', progress: null });
  });

  it.each([
    ['forbidden', 'forbidden'],
    ['not_found', 'not_found'],
  ])('отказ сервиса %s → %s', async (error, expected) => {
    getBitrixBatchState.mockResolvedValue({ ok: false, error });
    expect(await getBitrixBatchStateAction('b-1')).toEqual({ ok: false, error: expected });
  });

  it('флаг выключен → forbidden, состояние не спрашиваем', async () => {
    notFoundIfDisabled.mockReturnValue(FLAG_OFF);
    expect(await getBitrixBatchStateAction('b-1')).toEqual({ ok: false, error: 'forbidden' });
    expect(getBitrixBatchState).not.toHaveBeenCalled();
  });
});

describe('saveBatchMappingAction', () => {
  it('счастливый путь: поля формы раскладываются по четырём таблицам, карточка перечитывается', async () => {
    const res = await saveBatchMappingAction(
      fd({
        batchId: 'b-1',
        'stage:0:NEW': 'ds1',
        // Ключ стадии сам содержит двоеточия — склеиваем всё после первого.
        'stage:7:C7:WON': 'ds2',
        'stage:7:C7:LOSE': '', // «— выберите —» → не сопоставлено
        'leadStage:JUNK': 'fs1',
        'leadStage:NEW': '', // лид тоже можно оставить несопоставленным
        'taskColumn:2': 'tc1',
        'taskColumn:5': '',
        'user:11': 'm1',
        'user:12': '', // пусто у сотрудника = менеджер по умолчанию, в таблицу не пишем
      })
    );

    expect(res).toEqual({ ok: true });
    expect(requireSettingsSection).toHaveBeenCalledWith('integrations.bitrix', 'admin');
    expect(notFoundIfDisabled).toHaveBeenCalledWith('bitrix_migration');
    expect(saveBatchMapping).toHaveBeenCalledWith(expect.anything(), SESSION, {
      batchId: 'b-1',
      tables: {
        stageMap: { '0:NEW': 'ds1', '7:C7:WON': 'ds2', '7:C7:LOSE': null },
        leadStageMap: { JUNK: 'fs1', NEW: null },
        taskColumnMap: { '2': 'tc1', '5': null },
        userMap: { '11': 'm1' },
      },
    });
    expect(revalidatePath).toHaveBeenCalledWith(`${BATCHES_PATH}/b-1`);
  });

  it('без пакета — invalid, до сервиса дело не доходит', async () => {
    const res = await saveBatchMappingAction(fd({ 'stage:0:NEW': 'ds1' }));
    expect(res).toEqual({ ok: false, error: 'invalid' });
    expect(saveBatchMapping).not.toHaveBeenCalled();
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it('посторонние и обрезанные поля игнорируются — пустые таблицы вместо мусора', async () => {
    await saveBatchMappingAction(
      fd({
        batchId: 'b-2',
        'stage:': 'ds1', // ключа после двоеточия нет
        stageMap: 'ds1', // двоеточия нет вовсе
        'колонка:5': 'tc1', // незнакомый префикс
        'user:9': new Blob(['m1']), // не строка
      })
    );
    expect(saveBatchMapping).toHaveBeenCalledWith(expect.anything(), SESSION, {
      batchId: 'b-2',
      tables: { stageMap: {}, leadStageMap: {}, taskColumnMap: {}, userMap: {} },
    });
  });

  it.each([
    ['forbidden', 'forbidden'],
    ['not_found', 'not_found'],
    ['invalid', 'invalid'],
    ['mapping_incomplete', 'invalid'],
  ])('отказ сервиса %s → %s, без перечитывания карточки', async (error, expected) => {
    saveBatchMapping.mockResolvedValue({ ok: false, error });
    const res = await saveBatchMappingAction(fd({ batchId: 'b-1' }));
    expect(res).toEqual({ ok: false, error: expected });
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it('флаг выключен → forbidden, сопоставление не сохраняется', async () => {
    notFoundIfDisabled.mockReturnValue(FLAG_OFF);
    const res = await saveBatchMappingAction(fd({ batchId: 'b-1', 'stage:0:NEW': 'ds1' }));
    expect(res).toEqual({ ok: false, error: 'forbidden' });
    expect(saveBatchMapping).not.toHaveBeenCalled();
    expect(revalidatePath).not.toHaveBeenCalled();
  });
});

/**
 * «Применить» (`У-194`): действие ставит пакет в очередь на запись в рабочую
 * базу. Само оно ничего не пишет — вся работа за сервисом; здесь проверяется
 * то, за что отвечает именно действие: раздел, флаг, пустой идентификатор,
 * дословный проброс отказа и перечитывание карточки только при успехе.
 */
describe('applyBitrixBatchAction', () => {
  it('счастливый путь: сервис зовётся с сессией и пакетом, карточка перечитывается', async () => {
    const res = await applyBitrixBatchAction('b-1');

    expect(res).toEqual({ ok: true });
    expect(requireSettingsSection).toHaveBeenCalledWith('integrations.bitrix', 'admin');
    expect(notFoundIfDisabled).toHaveBeenCalledWith('bitrix_migration');
    expect(applyBitrixBatch).toHaveBeenCalledWith(expect.anything(), SESSION, 'b-1');
    expect(revalidatePath).toHaveBeenCalledWith(`${BATCHES_PATH}/b-1`);
  });

  it('раздел закрыт гардом настроек — до флага и сервиса дело не доходит', async () => {
    requireSettingsSection.mockRejectedValue(new Error('NEXT_REDIRECT'));

    await expect(applyBitrixBatchAction('b-1')).rejects.toThrow('NEXT_REDIRECT');
    expect(notFoundIfDisabled).not.toHaveBeenCalled();
    expect(applyBitrixBatch).not.toHaveBeenCalled();
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it('флаг выключен → forbidden, перенос не запускается', async () => {
    notFoundIfDisabled.mockReturnValue(FLAG_OFF);

    expect(await applyBitrixBatchAction('b-1')).toEqual({ ok: false, error: 'forbidden' });
    expect(applyBitrixBatch).not.toHaveBeenCalled();
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it('пустой идентификатор пакета → invalid, до сервиса дело не доходит', async () => {
    expect(await applyBitrixBatchAction('')).toEqual({ ok: false, error: 'invalid' });
    expect(applyBitrixBatch).not.toHaveBeenCalled();
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it.each([['forbidden'], ['not_found'], ['invalid'], ['mapping_incomplete']])(
    'отказ сервиса %s пробрасывается как есть, карточка не перечитывается',
    async (error) => {
      applyBitrixBatch.mockResolvedValue({ ok: false, error });

      expect(await applyBitrixBatchAction('b-1')).toEqual({ ok: false, error });
      expect(revalidatePath).not.toHaveBeenCalled();
    }
  );
});

/**
 * «Откатить» (`У-196`): действие ставит пакет в очередь на возврат. Уместность
 * отката — окно 30 дней, статус пакета, наличие неоткаченных строк — считает
 * сервис, поэтому здесь проверяется только то, за что отвечает действие:
 * раздел, флаг, пустой идентификатор, ДОСЛОВНЫЙ проброс причины отказа и
 * перечитывание обоих экранов при успехе.
 *
 * Почему «дословный» важно: причин отказа шесть, и у каждой свой русский текст
 * на кнопке. Схлопни их в один общий код — и человек увидит «нельзя» без
 * объяснения, а это дефект приёмки (§15).
 */
describe('rollbackBitrixBatchAction', () => {
  it('счастливый путь: сервис зовётся с сессией и пакетом, обновляются карточка и список', async () => {
    const res = await rollbackBitrixBatchAction('b-1');

    expect(res).toEqual({ ok: true });
    expect(requireSettingsSection).toHaveBeenCalledWith('integrations.bitrix', 'admin');
    expect(notFoundIfDisabled).toHaveBeenCalledWith('bitrix_migration');
    expect(requestRollback).toHaveBeenCalledWith(expect.anything(), SESSION, 'b-1');
    // Карточка — потому что на ней статус пакета; список — потому что в нём
    // та же строка со своей кнопкой «Откатить».
    expect(revalidatePath).toHaveBeenCalledWith(`${BATCHES_PATH}/b-1`);
    expect(revalidatePath).toHaveBeenCalledWith(BATCHES_PATH);
    expect(revalidatePath).toHaveBeenCalledTimes(2);
  });

  it('раздел закрыт гардом настроек — до флага и сервиса дело не доходит', async () => {
    requireSettingsSection.mockRejectedValue(new Error('NEXT_REDIRECT'));

    await expect(rollbackBitrixBatchAction('b-1')).rejects.toThrow('NEXT_REDIRECT');
    expect(notFoundIfDisabled).not.toHaveBeenCalled();
    expect(requestRollback).not.toHaveBeenCalled();
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it('флаг выключен → forbidden, откат не запускается', async () => {
    notFoundIfDisabled.mockReturnValue(FLAG_OFF);

    expect(await rollbackBitrixBatchAction('b-1')).toEqual({ ok: false, error: 'forbidden' });
    // Гард раздела всё равно отработал первым (страж матрицы настроек).
    expect(requireSettingsSection).toHaveBeenCalledWith('integrations.bitrix', 'admin');
    expect(requestRollback).not.toHaveBeenCalled();
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it('пустой идентификатор пакета → not_found, до сервиса дело не доходит', async () => {
    expect(await rollbackBitrixBatchAction('')).toEqual({ ok: false, error: 'not_found' });
    expect(requestRollback).not.toHaveBeenCalled();
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it.each([
    ['expired'],
    ['not_applied'],
    ['rolled_back'],
    ['nothing_to_revert'],
    ['not_found'],
    ['forbidden'],
  ])('отказ сервиса %s пробрасывается как есть, экраны не перечитываются', async (error) => {
    requestRollback.mockResolvedValue({ ok: false, error });

    expect(await rollbackBitrixBatchAction('b-1')).toEqual({ ok: false, error });
    expect(revalidatePath).not.toHaveBeenCalled();
  });
});

/**
 * «Повторять еженедельно» (`У-203`): действие снимает или ставит паузу
 * расписания повтора переноса. Своё расписание оно не заводит и паузу само не
 * пишет — это делает общий сервис расписаний обмена; здесь проверяется ровно
 * то, за что отвечает действие: раздел, флаг, ПРАВИЛЬНОЕ расписание, дословный
 * проброс отказа и перечитывание своего экрана только при успехе.
 *
 * Почему «правильное расписание» важно: `setSchedulePaused` принимает любую
 * строку и на чужой молча ответит `unknown_schedule`. Перепутай идентификатор —
 * и кнопка станет мёртвой, не сказав ни слова о причине.
 */
describe('setBitrixResyncPausedAction', () => {
  it('включение повтора: сервис зовётся с расписанием повтора и снятием паузы, экран перечитывается', async () => {
    setSchedulePaused.mockResolvedValue({ ok: true, paused: false });

    const res = await setBitrixResyncPausedAction(false);

    expect(res).toEqual({ ok: true, paused: false });
    expect(requireSettingsSection).toHaveBeenCalledWith('integrations.bitrix', 'admin');
    expect(notFoundIfDisabled).toHaveBeenCalledWith('bitrix_migration');
    // Автор паузы — тот, кто нажал: в журнале расписаний остаётся его id.
    expect(setSchedulePaused).toHaveBeenCalledWith(
      expect.anything(),
      SESSION.sub,
      BITRIX_RESYNC_SCHEDULER_ID,
      false
    );
    // Перечитывается экран миграции, а не страница автообмена: подпись кнопки
    // и состояние повтора человек видит здесь.
    expect(revalidatePath).toHaveBeenCalledWith(PATH);
    expect(revalidatePath).toHaveBeenCalledTimes(1);
  });

  it('выключение повтора: сервису уходит именно `true`, экран перечитывается', async () => {
    setSchedulePaused.mockResolvedValue({ ok: true, paused: true });

    expect(await setBitrixResyncPausedAction(true)).toEqual({ ok: true, paused: true });
    expect(setSchedulePaused).toHaveBeenCalledWith(
      expect.anything(),
      SESSION.sub,
      BITRIX_RESYNC_SCHEDULER_ID,
      true
    );
    expect(revalidatePath).toHaveBeenCalledWith(PATH);
  });

  it('раздел закрыт гардом настроек — до флага и сервиса дело не доходит', async () => {
    requireSettingsSection.mockRejectedValue(new Error('NEXT_REDIRECT'));

    await expect(setBitrixResyncPausedAction(false)).rejects.toThrow('NEXT_REDIRECT');
    expect(notFoundIfDisabled).not.toHaveBeenCalled();
    expect(setSchedulePaused).not.toHaveBeenCalled();
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it('флаг выключен → forbidden, расписание не трогаем', async () => {
    notFoundIfDisabled.mockReturnValue(FLAG_OFF);

    expect(await setBitrixResyncPausedAction(false)).toEqual({ ok: false, error: 'forbidden' });
    // Гард раздела всё равно отработал первым (страж матрицы настроек).
    expect(requireSettingsSection).toHaveBeenCalledWith('integrations.bitrix', 'admin');
    expect(setSchedulePaused).not.toHaveBeenCalled();
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it.each([['queue_unavailable'], ['unknown_schedule']])(
    'отказ сервиса %s пробрасывается как есть, экран не перечитывается',
    async (error) => {
      setSchedulePaused.mockResolvedValue({ ok: false, error });

      expect(await setBitrixResyncPausedAction(true)).toEqual({ ok: false, error });
      // Схлопни причину в общий код — и человек увидит «нельзя» без объяснения.
      expect(revalidatePath).not.toHaveBeenCalled();
    }
  );
});
