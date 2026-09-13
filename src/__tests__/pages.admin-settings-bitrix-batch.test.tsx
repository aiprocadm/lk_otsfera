// @vitest-environment jsdom
/**
 * Карточка пакета миграции из Битрикс24 (этап 2 PR-3, `У-193`):
 * `/admin/settings/integrations/bitrix/history/[batchId]`.
 *
 * Экран отвечает на три вопроса сразу: состояние пакета и откуда данные —
 * сверху, сводка и сопоставление — в середине, «что не перенесётся» — внизу.
 * Клиентские части (полоса прогресса и таблицы сопоставления) заглушены: у них
 * свои тесты, странице важно, что и с какими данными она их зовёт.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { renderServerComponent } from './helpers/renderServerComponent';

const { requireSettingsSection } = vi.hoisted(() => ({ requireSettingsSection: vi.fn() }));
vi.mock('@/lib/auth/requireSettings', () => ({ requireSettingsSection }));

vi.mock('@/lib/db/prisma', () => ({ prisma: {} }));

// Карточка берёт пакет вместе с состоянием отката: одна выборка вместо двух,
// и подпись кнопки не может разъехаться с тем, что сделает сам откат.
const { getBitrixBatchWithRollback } = vi.hoisted(() => ({
  getBitrixBatchWithRollback: vi.fn(),
}));
vi.mock('@/lib/services/bitrix/history', () => ({ getBitrixBatchWithRollback }));

const { resolveDealStages, resolveFunnelStages, resolveTaskColumns, loadCompanyUsers } = vi.hoisted(
  () => ({
    resolveDealStages: vi.fn(),
    resolveFunnelStages: vi.fn(),
    resolveTaskColumns: vi.fn(),
    loadCompanyUsers: vi.fn(),
  })
);
vi.mock('@/lib/services/deals/stages', () => ({ resolveDealStages }));
vi.mock('@/lib/funnel/stages', () => ({ resolveFunnelStages }));
vi.mock('@/lib/tasks/columns', () => ({ resolveTaskColumns }));
vi.mock('@/lib/services/bitrix/mapping/lookup', () => ({ loadCompanyUsers }));

const nav = vi.hoisted(() => ({
  notFound: vi.fn(() => {
    throw new Error('NOT_FOUND');
  }),
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));
vi.mock('next/navigation', () => nav);

// Полоса прогресса — клиентская, со своим таймером и тестом
// (components.bitrix-batch-progress): странице важны пакет и статус.
const { progressProps } = vi.hoisted(() => ({ progressProps: [] as unknown[] }));
vi.mock('@/components/bitrix/batch-progress', () => ({
  BatchProgress: (props: { batchId: string; status: string }) => {
    progressProps.push(props);
    return React.createElement('div', { 'data-testid': 'batch-progress' }, props.status);
  },
}));

// «Применить» (`У-194`) — клиентская кнопка с подтверждением и своим тестом
// (components.bitrix-apply-batch-button): странице важно, ЧТО она ей передала
// и при каком состоянии пакета вообще монтирует.
const { applyProps } = vi.hoisted(() => ({ applyProps: [] as Record<string, unknown>[] }));
vi.mock('@/components/bitrix/apply-batch-button', () => ({
  ApplyBatchButton: (props: { batchId: string; total: number; disabled?: boolean }) => {
    applyProps.push(props);
    return React.createElement(
      'button',
      { 'data-testid': 'apply-batch', disabled: props.disabled },
      'Применить'
    );
  },
}));

// «Откатить» (`У-196`) — тоже клиентская кнопка с подтверждением и своим
// тестом (components.bitrix-rollback-batch-button): странице важно, при каком
// состоянии пакета она её монтирует и что передаёт.
type RollbackStub = { batchId: string; state: string; hint: string };
const { rollbackProps } = vi.hoisted(() => ({ rollbackProps: [] as RollbackStub[] }));
vi.mock('@/components/bitrix/rollback-batch-button', () => ({
  RollbackBatchButton: (props: RollbackStub) => {
    rollbackProps.push(props);
    return React.createElement(
      'button',
      {
        'data-testid': 'rollback-batch',
        disabled: props.state !== 'available',
        ...(props.hint ? { title: props.hint } : {}),
      },
      'Откатить'
    );
  },
}));

const { mappingProps } = vi.hoisted(() => ({ mappingProps: [] as Record<string, unknown>[] }));
vi.mock('@/components/bitrix/mapping-tables', () => ({
  MappingTables: (props: Record<string, unknown>) => {
    mappingProps.push(props);
    return React.createElement('div', { 'data-testid': 'mapping-tables' });
  },
}));

import AdminBitrixBatchPage, {
  metadata,
} from '@/app/admin/settings/integrations/bitrix/history/[batchId]/page';
import type { BitrixHistoryItem } from '@/lib/services/bitrix/history';
import type { PipelineCounts } from '@/lib/services/bitrix/pipeline';
import {
  BITRIX_ENTITIES,
  emptyCounts,
  type BitrixEntity,
  type PlanRow,
} from '@/lib/services/bitrix/mapping/types';
import type { BitrixStage } from '@/lib/services/bitrix/source';

const ADMIN = { sub: 'admin1', role: 'admin' as const, companyId: 'c1' };
const ADMIN_NO_COMPANY = { sub: 'admin2', role: 'admin' as const };

const STAGES: BitrixStage[] = [
  { entity: 'deal', categoryId: null, id: 'NEW', name: 'Новая', semantics: 'process' },
  { entity: 'lead', categoryId: null, id: 'JUNK', name: 'Мусор', semantics: 'failure' },
];

function counts(over: Partial<Record<BitrixEntity, Partial<PipelineCounts[BitrixEntity]>>> = {}) {
  const base = Object.fromEntries(
    BITRIX_ENTITIES.map((e) => [e, { ...emptyCounts(), ...(over[e] ?? {}) }])
  ) as Record<BitrixEntity, PipelineCounts[BitrixEntity]>;
  return { ...base, progress: null, total: 0, warnings: [] } satisfies PipelineCounts;
}

function batch(over: Partial<BitrixHistoryItem> = {}): BitrixHistoryItem {
  return {
    id: 'b-1',
    status: 'preview',
    source: 'rest',
    mode: 'initial',
    createdAt: new Date('2026-09-13T09:05:00Z'),
    startedAt: null,
    appliedAt: null,
    rolledBackAt: null,
    hasReport: false,
    importedByName: 'Анна Админова',
    settings: {
      from: null,
      to: null,
      openOnly: false,
      withFiles: true,
      defaultManagerId: null,
      fileKeys: [],
      tables: {},
    },
    counts: null,
    errors: [],
    ready: false,
    // Состояние отката считает сервис по статусу, дате применения и журналу;
    // страница его только передаёт кнопке.
    rollback: 'not_applied',
    rollbackHint: 'Пакет ещё не применён — возвращать нечего.',
    ...over,
  };
}

function render(batchId = 'b-1') {
  return renderServerComponent(AdminBitrixBatchPage({ params: Promise.resolve({ batchId }) }));
}

beforeEach(() => {
  vi.clearAllMocks();
  progressProps.length = 0;
  mappingProps.length = 0;
  applyProps.length = 0;
  rollbackProps.length = 0;
  requireSettingsSection.mockResolvedValue(ADMIN);
  getBitrixBatchWithRollback.mockResolvedValue({ ok: true, batch: batch() });
  resolveDealStages.mockResolvedValue([{ id: 'ds1', name: 'В работе' }]);
  resolveFunnelStages.mockResolvedValue([{ id: 'fs1', name: 'Новый' }]);
  resolveTaskColumns.mockResolvedValue([{ id: 'tc1', name: 'К выполнению' }]);
  // Тот же список, среди которого конвейер искал совпадения по почте:
  // администратор тоже должен попасть в варианты сопоставления.
  loadCompanyUsers.mockResolvedValue([
    { id: 'm1', name: 'Анна', email: 'm1@demo.local' },
    { id: 'm2', name: 'Борис', email: 'm2@demo.local' },
    { id: 'm3', name: 'Сотрудник без почты', email: null },
  ]);
});

describe('AdminBitrixBatchPage — гард и отсутствующий пакет', () => {
  it('раздел закрыт гардом настроек на каждый запрос', async () => {
    await render();
    expect(requireSettingsSection).toHaveBeenCalledWith('integrations.bitrix', 'admin');
    expect(getBitrixBatchWithRollback).toHaveBeenCalledWith({}, ADMIN, 'b-1');
  });

  it.each([['not_found'], ['forbidden']])(
    'чужой или отсутствующий пакет (%s) → notFound, данные ЛК не читаются',
    async (error) => {
      getBitrixBatchWithRollback.mockResolvedValue({ ok: false, error });
      await expect(render('чужой')).rejects.toThrow('NOT_FOUND');
      expect(nav.notFound).toHaveBeenCalled();
      expect(resolveDealStages).not.toHaveBeenCalled();
      expect(loadCompanyUsers).not.toHaveBeenCalled();
    }
  );

  it('заголовок вкладки браузера называет раздел', () => {
    expect(metadata.title).toBe('Пакет миграции из Битрикс24 · Настройки');
  });
});

describe('AdminBitrixBatchPage — шапка и состояние', () => {
  it('шапка: дата пакета по Москве, состояние, кто запустил, откуда данные; ссылка назад', async () => {
    const { container } = await render();

    expect(container.querySelector('h1')?.textContent).toBe('Пакет от 13.09.2026, 12:05');
    const text = container.textContent ?? '';
    expect(text).toContain('Предпросмотр готов · запустил Анна Админова · с портала по вебхуку');
    const back = container.querySelector('a[href="/admin/settings/integrations/bitrix/history"]');
    expect(back?.textContent).toBe('← К пакетам');
    // Полоса прогресса всегда смонтирована — молчит она сама, по статусу.
    expect(progressProps).toEqual([{ batchId: 'b-1', status: 'preview' }]);
  });

  it('пакет из выгрузок и незнакомое состояние показываются как есть', async () => {
    getBitrixBatchWithRollback.mockResolvedValue({
      ok: true,
      batch: batch({ source: 'file', status: 'unknown' as BitrixHistoryItem['status'] }),
    });
    const { container } = await render();
    expect(container.textContent).toContain(
      'unknown · запустил Анна Админова · из загруженных выгрузок'
    );
  });

  it('пакет не посчитался: причины списком и совет, что делать; сопоставления нет', async () => {
    getBitrixBatchWithRollback.mockResolvedValue({
      ok: true,
      batch: batch({
        status: 'failed',
        errors: [
          { bitrixId: '0', entity: 'deal', message: 'Портал ответил 401' },
          { bitrixId: '7', entity: 'deal', message: 'Не хватает прав на CRM' },
        ],
      }),
    });
    const { container } = await render();

    const alert = container.querySelector('[role="alert"]');
    expect(alert?.textContent).toContain('Пакет не посчитался');
    expect([...(alert?.querySelectorAll('li') ?? [])].map((li) => li.textContent)).toEqual([
      'Портал ответил 401',
      'Не хватает прав на CRM',
    ]);
    expect(alert?.textContent).toContain('Поправьте настройки на вкладке «Подключение»');
    expect(container.querySelector('[data-testid="mapping-tables"]')).toBeNull();
    expect(container.textContent).not.toContain('Применение');
  });

  it('у не-провалившегося пакета области тревоги нет вовсе', async () => {
    const { container } = await render();
    expect(container.querySelector('[role="alert"]')).toBeNull();
  });
});

describe('AdminBitrixBatchPage — сводка и предупреждения', () => {
  it('сводка считанного пакета и предупреждение о большом объёме', async () => {
    getBitrixBatchWithRollback.mockResolvedValue({
      ok: true,
      batch: batch({
        counts: {
          ...counts({ deal: { create: 5, update: 1, skip: 0, conflict: 2 } }),
          total: 8,
          warnings: [
            'Пакет очень большой: 60 000 записей. Перенос может занять часы.',
            'У 3 сделок не нашлось ответственного.',
          ],
        },
      }),
    });
    const { container } = await render();

    const text = container.textContent ?? '';
    expect(text).toContain('Пакет очень большой: 60 000 записей');
    expect(text).toContain('У 3 сделок не нашлось ответственного.');
    expect(container.querySelector('[data-testid="count-deal-create"]')?.textContent).toBe('5');
    expect(container.querySelector('[data-testid="count-deal-conflict"]')?.textContent).toBe('2');
  });

  it('предупреждений нет — жёлтой плашки тоже нет, а сводка есть', async () => {
    getBitrixBatchWithRollback.mockResolvedValue({
      ok: true,
      batch: batch({ counts: { ...counts({ contact: { create: 3 } }), total: 3 } }),
    });
    const { container } = await render();
    expect(container.querySelector('.border-amber-200')).toBeNull();
    expect(container.querySelector('[data-testid="count-contact-create"]')?.textContent).toBe('3');
  });

  it('пакет ещё считается — сводки нет вовсе', async () => {
    getBitrixBatchWithRollback.mockResolvedValue({
      ok: true,
      batch: batch({ status: 'preview_pending', counts: null }),
    });
    const { container } = await render();
    expect(container.textContent).not.toContain('В выбранном периоде переносить нечего');
    expect(container.querySelector('[data-testid="count-deal-create"]')).toBeNull();
    expect(progressProps).toEqual([{ batchId: 'b-1', status: 'preview_pending' }]);
  });
});

describe('AdminBitrixBatchPage — сопоставление', () => {
  it('таблицы сопоставления получают стадии портала и справочники ЛК; у сотрудников видна почта', async () => {
    getBitrixBatchWithRollback.mockResolvedValue({
      ok: true,
      batch: batch({
        settings: {
          ...batch().settings,
          stagesFound: STAGES,
          usersFound: [
            { bitrixId: '1', name: 'Пётр', email: null, userId: null, matchedBy: 'none' },
          ],
          tables: { stageMap: { '0:NEW': 'ds1' }, leadStageMap: { JUNK: 'fs1' } },
        },
      }),
    });
    const { container } = await render();

    expect(container.textContent).toContain('Битрикс и кабинет называют стадии по-разному');
    expect(container.querySelector('[data-testid="mapping-tables"]')).not.toBeNull();
    expect(resolveDealStages).toHaveBeenCalledWith({}, 'c1');
    expect(resolveFunnelStages).toHaveBeenCalledWith({}, 'c1');
    expect(resolveTaskColumns).toHaveBeenCalledWith({}, 'c1');
    expect(loadCompanyUsers).toHaveBeenCalledWith({}, 'c1');

    expect(mappingProps).toHaveLength(1);
    expect(mappingProps[0]).toMatchObject({
      batchId: 'b-1',
      stages: STAGES,
      users: [{ bitrixId: '1', name: 'Пётр', email: null, userId: null, matchedBy: 'none' }],
      dealStages: [{ id: 'ds1', name: 'В работе' }],
      funnelStages: [{ id: 'fs1', name: 'Новый' }],
      taskColumns: [{ id: 'tc1', name: 'К выполнению' }],
      // Почта в скобках — чтобы двух тёзок можно было различить; у сотрудника
      // без почты остаётся одно имя, а не «Имя ()».
      companyUsers: [
        { id: 'm1', name: 'Анна (m1@demo.local)' },
        { id: 'm2', name: 'Борис (m2@demo.local)' },
        { id: 'm3', name: 'Сотрудник без почты' },
      ],
      values: {
        stageMap: { '0:NEW': 'ds1' },
        leadStageMap: { JUNK: 'fs1' },
        taskColumnMap: {},
        userMap: {},
      },
    });
  });

  it('сухой прогон ещё не нашёл стадий — таблиц нет, но блок «Применение» остаётся', async () => {
    const { container } = await render();
    expect(container.querySelector('[data-testid="mapping-tables"]')).toBeNull();
    expect(container.textContent).not.toContain('Битрикс и кабинет называют стадии по-разному');
    expect(container.textContent).toContain('Применение');
  });

  it('пакет уже применён — ни таблиц, ни блока «Применение», ни кнопки', async () => {
    getBitrixBatchWithRollback.mockResolvedValue({
      ok: true,
      batch: batch({
        status: 'applied',
        settings: { ...batch().settings, stagesFound: STAGES },
      }),
    });
    const { container } = await render();
    expect(container.querySelector('[data-testid="mapping-tables"]')).toBeNull();
    expect(container.textContent).not.toContain('Применение');
    expect(container.querySelector('[data-testid="apply-batch"]')).toBeNull();
    expect(applyProps).toEqual([]);
  });
});

describe('AdminBitrixBatchPage — блок «Применение»', () => {
  it('перечисляет именно те стадии, которые ещё не сопоставлены; кнопка заблокирована', async () => {
    getBitrixBatchWithRollback.mockResolvedValue({
      ok: true,
      batch: batch({
        settings: {
          ...batch().settings,
          stagesFound: STAGES,
          tables: { stageMap: { '0:NEW': 'ds1' } }, // лид не сопоставлен
        },
      }),
    });
    const { container } = await render();
    const text = container.textContent ?? '';
    expect(text).toContain('Сначала сопоставьте стадии: Лиды: Мусор.');
    expect(text).toContain('записи ушли бы не туда');
    expect(text).not.toContain('Сопоставление готово');
    // `У-194`: пока сопоставление неполное, кнопка есть, но не нажимается —
    // иначе записи ушли бы не туда, а человек не понял бы, почему ничего нет.
    expect(applyProps).toEqual([{ batchId: 'b-1', total: 0, disabled: true }]);
    expect(container.querySelector('[data-testid="apply-batch"]')).toHaveProperty('disabled', true);
  });

  it('сопоставление полное — кнопка «Применить» доступна и знает число записей', async () => {
    getBitrixBatchWithRollback.mockResolvedValue({
      ok: true,
      batch: batch({
        counts: { ...counts({ deal: { create: 5 } }), total: 1234 },
        settings: {
          ...batch().settings,
          stagesFound: STAGES,
          tables: { stageMap: { '0:NEW': 'ds1' }, leadStageMap: { JUNK: 'fs1' } },
        },
      }),
    });
    const { container } = await render();
    const text = container.textContent ?? '';
    expect(text).toContain('Сопоставление готово.');
    expect(text).not.toContain('Сначала сопоставьте стадии');
    // Число записей — из предпросмотра: подтверждение обязано назвать его до нажатия.
    expect(applyProps).toEqual([{ batchId: 'b-1', total: 1234, disabled: false }]);
    expect(container.querySelector('[data-testid="apply-batch"]')).toHaveProperty(
      'disabled',
      false
    );
  });

  it('сухой прогон ещё не посчитан — кнопке передаётся 0 записей, а не undefined', async () => {
    // Стадий не нашлось, сводки нет: сопоставлять нечего, поэтому кнопка
    // доступна, а число записей честно равно нулю.
    getBitrixBatchWithRollback.mockResolvedValue({ ok: true, batch: batch({ counts: null }) });
    await render();
    expect(applyProps).toEqual([{ batchId: 'b-1', total: 0, disabled: false }]);
  });
});

// `У-194`, `У-196`, `У-198`: после переноса экран обязан сказать, что он
// состоялся, дать отчёт сверки и кнопку «вернуть как было». Иначе человек не
// отличит «применили» от «кнопку не нажали» и не найдёт, где откатить.
describe('AdminBitrixBatchPage — блок «Перенос выполнен», отчёт и откат', () => {
  /** Пакет, который уже что-то записал: у него есть и отчёт, и откат. */
  function done(over: Partial<BitrixHistoryItem> = {}) {
    return batch({
      status: 'applied',
      appliedAt: new Date('2026-09-13T10:00:00Z'),
      hasReport: true,
      rollback: 'available',
      rollbackHint: '',
      ...over,
    });
  }

  it.each([
    ['applied', 'Перенос выполнен', 'откачен'],
    ['rolled_back', 'Перенос откачен', 'частично'],
    ['rollback_partial', 'Перенос откачен частично', 'Перенос выполнен'],
  ])('статус %s: блок называет, что именно произошло', async (status, title, absent) => {
    getBitrixBatchWithRollback.mockResolvedValue({
      ok: true,
      batch: done({ status: status as BitrixHistoryItem['status'] }),
    });
    const { container } = await render();
    const text = container.textContent ?? '';

    expect(text).toContain(title);
    // Три состояния — три разные новости; перепутать их нельзя.
    expect(text).not.toContain(absent);
    expect(text).toContain('Что именно изменилось — в отчёте сверки');
    // Применять уже нечего: кнопки «Применить» в этих состояниях нет.
    expect(container.querySelector('[data-testid="apply-batch"]')).toBeNull();
    expect(applyProps).toEqual([]);
  });

  it('отчёт собран — ссылка ведёт на роут отчёта этого пакета', async () => {
    getBitrixBatchWithRollback.mockResolvedValue({ ok: true, batch: done({ hasReport: true }) });
    const { container } = await render();

    const link = container.querySelector('[data-testid="bitrix-report-link"]');
    expect(link?.getAttribute('href')).toBe('/api/admin/bitrix/b-1/report');
    expect(link?.textContent).toBe('Скачать отчёт сверки');
    expect(container.textContent).not.toContain('Отчёт сверки собирается');
  });

  it('отчёт ещё собирается — вместо ссылки объяснение, что сделать', async () => {
    getBitrixBatchWithRollback.mockResolvedValue({ ok: true, batch: done({ hasReport: false }) });
    const { container } = await render();

    // §15: пустое место молчит, а человек должен понять, почему скачать нечего.
    expect(container.querySelector('[data-testid="bitrix-report-link"]')).toBeNull();
    expect(container.textContent).toContain(
      'Отчёт сверки собирается — обновите страницу через минуту.'
    );
    // Откат от отчёта не зависит: кнопка на месте.
    expect(container.querySelector('[data-testid="rollback-batch"]')).not.toBeNull();
  });

  it('кнопка отката получает состояние и подсказку, посчитанные сервисом', async () => {
    getBitrixBatchWithRollback.mockResolvedValue({
      ok: true,
      batch: done({
        rollback: 'expired',
        rollbackHint: 'Откат возможен 30 дней после применения — срок вышел.',
      }),
    });
    const { container } = await render();

    // Страница ничего не пересчитывает: разъехаться подпись и поведение не могут.
    expect(rollbackProps).toEqual([
      {
        batchId: 'b-1',
        state: 'expired',
        hint: 'Откат возможен 30 дней после применения — срок вышел.',
      },
    ]);
    const button = container.querySelector('[data-testid="rollback-batch"]');
    expect(button).toHaveProperty('disabled', true);
    expect(button?.getAttribute('title')).toBe(
      'Откат возможен 30 дней после применения — срок вышел.'
    );
  });

  it('откат возможен — кнопка живая и без подсказки-причины', async () => {
    getBitrixBatchWithRollback.mockResolvedValue({ ok: true, batch: done() });
    const { container } = await render();

    expect(rollbackProps).toEqual([{ batchId: 'b-1', state: 'available', hint: '' }]);
    const button = container.querySelector('[data-testid="rollback-batch"]');
    expect(button).toHaveProperty('disabled', false);
    expect(button?.getAttribute('title')).toBeNull();
  });

  it.each([['preview'], ['preview_pending'], ['applying'], ['rolling_back'], ['failed']])(
    'статус %s — ни блока, ни отчёта, ни кнопки отката',
    async (status) => {
      getBitrixBatchWithRollback.mockResolvedValue({
        ok: true,
        batch: batch({ status: status as BitrixHistoryItem['status'], hasReport: true }),
      });
      const { container } = await render();

      expect(container.textContent).not.toContain('Перенос выполнен');
      expect(container.querySelector('[data-testid="bitrix-report-link"]')).toBeNull();
      expect(container.querySelector('[data-testid="rollback-batch"]')).toBeNull();
      expect(rollbackProps).toEqual([]);
    }
  );
});

describe('AdminBitrixBatchPage — строки конфликтов и краевые случаи', () => {
  it('строки «нужно решение» и «пропустим» показываются внизу', async () => {
    const rows: PlanRow[] = [
      {
        entity: 'organization',
        bitrixId: '11',
        title: 'ООО «Ромашка»',
        action: 'conflict',
        reason: 'ИНН у организации другой компании',
      },
      {
        entity: 'file',
        bitrixId: '99',
        title: 'смета.pdf',
        action: 'skip',
        reason: 'источник не даёт файлов',
      },
    ];
    getBitrixBatchWithRollback.mockResolvedValue({
      ok: true,
      batch: batch({ settings: { ...batch().settings, rows } }),
    });
    const { container } = await render();

    expect(container.querySelector('[data-testid="bitrix-conflicts"]')?.textContent).toContain(
      'ООО «Ромашка»'
    );
    expect(container.querySelector('[data-testid="bitrix-skips"]')?.textContent).toContain(
      'смета.pdf'
    );
  });

  it('строк нет — таблиц внизу нет вовсе', async () => {
    const { container } = await render();
    expect(container.querySelector('[data-testid="bitrix-conflicts"]')).toBeNull();
    expect(container.querySelector('[data-testid="bitrix-skips"]')).toBeNull();
    expect(container.textContent).not.toContain('Ни конфликтов, ни пропусков');
  });

  it('у сессии нет компании: сотрудников не спрашиваем, справочники берём по пустой компании', async () => {
    requireSettingsSection.mockResolvedValue(ADMIN_NO_COMPANY);
    getBitrixBatchWithRollback.mockResolvedValue({
      ok: true,
      batch: batch({ settings: { ...batch().settings, stagesFound: STAGES } }),
    });
    const { container } = await render();

    expect(loadCompanyUsers).not.toHaveBeenCalled();
    expect(resolveDealStages).toHaveBeenCalledWith({}, '');
    expect(resolveFunnelStages).toHaveBeenCalledWith({}, '');
    expect(resolveTaskColumns).toHaveBeenCalledWith({}, '');
    expect(container.querySelector('[data-testid="mapping-tables"]')).not.toBeNull();
    expect(mappingProps[0]).toMatchObject({ companyUsers: [] });
  });
});
