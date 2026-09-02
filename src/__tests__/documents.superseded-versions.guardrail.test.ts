import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import {
  ACTIVE_VERSION_WHERE,
  organizationChannelWhere,
  partnerChannelWhere,
  partnerPortfolioDocumentsWhere,
  managerOrderLessWhere,
} from '@/lib/auth/documentChannelPolicy';

/**
 * Страж `У-151` (CLAUDE.md §16): заменённая перевыпуском версия не попадает в списки.
 *
 * ЗАЧЕМ. Перевыпуск не создаёт новую бумагу — он растит версию у той же самой:
 * номер остаётся прежним, у старой версии проставляется `supersededAt`. Если
 * список показывает обе, человек видит две строки с ОДНИМ номером и не может
 * понять, какая настоящая: он скачает и отправит клиенту отменённый счёт.
 * Именно поэтому ТЗ (`У-151`) говорит «прежняя версия помечена „заменён“ и
 * скрыта из списков по умолчанию».
 *
 * ПОЧЕМУ СТРАЖ, А НЕ ОБЫЧНЫЙ ТЕСТ. Фильтр `supersededAt: null` — это одна
 * строчка в общем where-строителе. Она теряется не «поломкой», а незаметно:
 * кто-то заводит НОВЫЙ список документов и пишет свой `where` мимо строителей.
 * Обычный тест проверил бы уже написанные списки, а регресс приходит с
 * ненаписанным. Поэтому здесь инвентарь: файлы находятся обходом каталога, а
 * не перечислены руками, и каждая новая выборка документов обязана быть
 * осознанно записана в реестр ниже.
 *
 * ПРОВЕРЕН МУТАЦИЕЙ (§16): при удалении `...ACTIVE_VERSION_WHERE` из
 * `organizationChannelWhere` файл краснеет — см. описание в ответе агента.
 */

const ROOT = process.cwd();
const POLICY = 'src/lib/auth/documentChannelPolicy.ts';
const SERVICES_DIR = 'src/lib/services';

/** Имена канальных строителей — «правильный» способ выбрать документы. */
const CHANNEL_BUILDERS = [
  'organizationChannelWhere',
  'partnerChannelWhere',
  'partnerPortfolioDocumentsWhere',
  'managerOrderLessWhere',
] as const;

/**
 * Признаки того, что выборка отфильтрована по действующей версии: либо она
 * зовёт канальный строитель, либо ставит фильтр сама (так делает панель
 * выпуска — у неё выборка не «список кабинета», а перечень оснований).
 */
const GUARD_MARKERS = [
  ...CHANNEL_BUILDERS,
  'ACTIVE_VERSION_WHERE',
  'supersededAt',
  // Скоупы менеджера несут фильтр внутри себя (`managerPolicy.ts`), поэтому
  // выборка, которая их зовёт, тоже защищена. Что фильтр там ЕСТЬ, проверяет
  // отдельный блок ниже: иначе его молча убрали бы, а инвентарь продолжал бы
  // считать такие списки защищёнными.
  'managerDocumentScope',
  // Глобальный поиск берёт скоуп документов из `search/scopes.ts`; что фильтр
  // есть в обеих его ветках (админ и сотрудник), проверяет блок ниже.
  'searchScopes',
];

function read(rel: string): string {
  return readFileSync(path.join(ROOT, rel), 'utf8');
}

/**
 * Комментарии убираем ДО поиска: в `documents/list.ts` имена строителей
 * упомянуты в шапке файла («канальные скоупы живут в …»), и без вырезания
 * комментариев страж посчитал бы админский список защищённым. Это не выдумка —
 * ровно так первая версия инвентаря и соврала.
 */
function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1');
}

function walkTs(relDir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(path.join(ROOT, relDir))) {
    const rel = `${relDir}/${entry}`;
    if (statSync(path.join(ROOT, rel)).isDirectory()) out.push(...walkTs(rel));
    else if (entry.endsWith('.ts')) out.push(rel);
  }
  return out;
}

/** Начала объявлений верхнего уровня — по ним режем файл на функции. */
const TOP_LEVEL_DECL = /^(?:export\s+)?(?:async\s+)?(?:function\s+(\w+)|const\s+(\w+))/gm;

type QuerySite = { key: string; guarded: boolean };

/**
 * Все места, где сервис читает документы пачкой (`document.findMany`), с
 * привязкой к функции. Гранулярность именно функция, а не файл: в
 * `manager/documents.ts` соседствуют защищённый список общих документов и
 * незащищённый список документов заказов — на уровне файла один прикрыл бы
 * другой, и дыра стала бы невидимой.
 */
function collectDocumentQuerySites(): QuerySite[] {
  const sites: QuerySite[] = [];
  for (const rel of walkTs(SERVICES_DIR)) {
    const raw = read(rel);
    if (!raw.includes('.document.findMany(')) continue;
    const src = stripComments(raw);
    const tops = [...src.matchAll(TOP_LEVEL_DECL)].map((m) => ({
      at: m.index ?? 0,
      name: m[1] ?? m[2] ?? '<модуль>',
    }));
    const calls = [...src.matchAll(/\.document\.findMany\(/g)];
    for (const call of calls) {
      const at = call.index ?? 0;
      const owner = tops.filter((t) => t.at <= at).at(-1) ?? { at: 0, name: '<модуль>' };
      const nextAt = tops.find((t) => t.at > owner.at)?.at ?? src.length;
      const body = src.slice(owner.at, nextAt);
      const key = `${rel}::${owner.name}`;
      if (!sites.some((s) => s.key === key)) {
        sites.push({ key, guarded: GUARD_MARKERS.some((marker) => body.includes(marker)) });
      }
    }
  }
  return sites;
}

/**
 * Реестр выборок документов. Каждая строка — осознанное решение, а не список
 * «что нашлось». Новая выборка обязана попасть сюда: иначе страж краснеет и
 * заставляет ответить на вопрос «а этот список версию фильтрует?».
 */
const GUARDED_SITES: Record<string, string> = {
  'src/lib/services/documents/proposalBlocks.ts::listDealProposals':
    'Блок «Коммерческие предложения» карточки сделки (`У-166`): у перевыпущенного КП тот же номер, и две строки читались бы как два предложения.',
  'src/lib/services/documents/proposalBlocks.ts::listOrganizationProposals':
    'Тот же блок на карточке организации.',
  'src/lib/services/organization/documents.ts::listOrgDocuments':
    'Раздел «Документы» кабинета заказчика — главный список, который читает клиент.',
  'src/lib/services/organization/dashboard.ts::attention':
    'Плитка «Требует внимания» заказчика: заменённый счёт не должен просить оплаты.',
  'src/lib/services/organization/dashboard.ts::recentEvents':
    'Лента событий заказчика — та же бумага не должна появляться дважды.',
  'src/lib/services/partner/documentsList.ts::listPartnerDocuments':
    'Раздел «Документы» кабинета партнёра.',
  'src/lib/services/partner/orgDocuments.ts::getOrgDocuments':
    'Вкладка «Документы» карточки организации портфеля партнёра (`У-155`).',
  'src/lib/services/manager/documents.ts::listManagerOrderLessDocuments':
    'Общие документы менеджера (без заказа) — идут через managerOrderLessWhere.',
  'src/lib/services/manager/documents.ts::listDocuments':
    'Список документов заказов у менеджера — через managerDocumentScope.',
  'src/lib/services/manager/organizationCard.ts::getOrganizationCard':
    'Блок «Документы» карточки организации у менеджера.',
  'src/lib/services/manager/dashboard/attention.ts::attention':
    'Лента «Требует внимания»: заменённый акт подписывать уже не нужно.',
  'src/lib/services/documents/generalList.ts::listGeneralDocuments':
    'Админское зеркало «Общие документы».',
  'src/lib/services/documents/list.ts::listAllDocuments': 'Админская панель документов.',
  'src/lib/services/documents/generationPanel.ts::getOrgDocumentIssuePanel':
    'Основания ДС без заказа — так же, как у панели заказа.',
  'src/lib/services/search/globalSearch.ts::globalSearch':
    'Глобальный поиск сотрудника — через managerDocumentScope и admin-ветку.',
  'src/lib/services/documents/generationPanel.ts::getDocumentGenerationPanel':
    'Перечень оснований для акта/ДС: заменённая бумага основанием быть не может.',
};

/**
 * Выборки, которым фильтр версии не нужен: это не списки кабинета, а точечные
 * дочитывания по id или служебные обходы. Скрывать там нечего — заменённая
 * версия либо вовсе не запрашивается, либо запрошена намеренно по своему id.
 */
const NOT_A_LIST_SITES: Record<string, string> = {
  'src/lib/services/documents/invoicePaidNotice.ts::notifyInvoicesPaid':
    'Уведомление «счёт оплачен» по приходу денег — не список, а сверка сумм.',
  'src/lib/services/enrollments/detail.ts::getEnrollmentRequest':
    'Дочитывание удостоверений по конкретным id (проверка права на файл).',
  'src/lib/services/manager/orderDelivery.ts::loadScanStatuses':
    'Статусы антивируса по конкретным id сканов — не витрина.',
  'src/lib/services/scan/backfill.ts::runBackfill':
    'Фоновый обход воркера: на скан обязаны попасть ВСЕ файлы, включая заменённые.',
};

/**
 * Известные дыры на 31.08.2026 — списки сотрудников, которые фильтр версии НЕ
 * ставят. Страж не красит их в зелёный и не чинит: он фиксирует факт, чтобы
 * дыра не разрослась незаметно. Список закрыт — новая строка сюда попадает
 * только вместе с решением заказчика (`AUDIT.md`, §16 «вне объёма»).
 */
const KNOWN_UNGUARDED_SITES: Record<string, string> = {
  'src/lib/services/manager/dashboard/events.ts::recentEvents':
    'Лента событий менеджера — история по смыслу: документ БЫЛ выпущен, и убирать его из ленты значило бы переписывать прошлое. Осознанное исключение, а не забытый фильтр.',
};

const REGISTERED_UNGUARDED = { ...NOT_A_LIST_SITES, ...KNOWN_UNGUARDED_SITES };

describe('У-151: фильтр действующей версии стоит во ВСЕХ канальных строителях', () => {
  const builders = [
    ['organizationChannelWhere', organizationChannelWhere('org-1')],
    ['partnerChannelWhere', partnerChannelWhere('p-1')],
    [
      'partnerPortfolioDocumentsWhere',
      partnerPortfolioDocumentsWhere({ partnerId: 'p-1', orgId: 'org-1' }),
    ],
    ['managerOrderLessWhere', managerOrderLessWhere('co-1')],
  ] as const;

  it.each(builders)('%s прячет заменённую версию', (name, where) => {
    expect(
      (where as { supersededAt?: unknown }).supersededAt,
      `${name} перестал класть supersededAt: null — кабинет снова покажет две бумаги с одним номером (У-151)`
    ).toBeNull();
  });

  it('константа ACTIVE_VERSION_WHERE — это ровно «действующая версия»', () => {
    // Значение константы важнее её имени: подменив null на что угодно другое,
    // фильтр перестанет отсекать заменённые версии, а имя останется прежним.
    expect(ACTIVE_VERSION_WHERE).toEqual({ supersededAt: null });
  });
});

describe('У-151: фильтр объявлен ОДИН раз — в общем строителе, а не скопирован', () => {
  const policySrc = stripComments(read(POLICY));

  it('в политике каналов слово supersededAt встречается ровно один раз', () => {
    // Копия фильтра в каждом строителе — это четыре места, которые разъедутся:
    // следующий строитель просто забудут. Одна константа забыться не может —
    // её не подмешал, значит и остальных полей канала нет.
    const occurrences = policySrc.match(/supersededAt/g) ?? [];
    expect(
      occurrences.length,
      'supersededAt должен быть только в объявлении ACTIVE_VERSION_WHERE'
    ).toBe(1);
  });

  it.each(CHANNEL_BUILDERS)('%s подмешивает общую константу, а не свой литерал', (builder) => {
    const start = policySrc.indexOf(`export function ${builder}`);
    expect(start, `строитель ${builder} исчез из политики каналов`).toBeGreaterThanOrEqual(0);
    const rest = policySrc.slice(start + 1);
    const nextDecl = rest.search(/^export /m);
    const body = nextDecl === -1 ? rest : rest.slice(0, nextDecl);
    expect(
      body,
      `${builder} обязан раскрывать ...ACTIVE_VERSION_WHERE — иначе правило снова живёт в четырёх местах`
    ).toContain('...ACTIVE_VERSION_WHERE');
  });

  it('клиентские сервисы не пишут фильтр версии руками', () => {
    // Инлайн `supersededAt` в кабинете заказчика/партнёра = обход строителя.
    // Такой список переживёт правку политики каналов и однажды разойдётся с ней.
    const offenders = walkTs(SERVICES_DIR)
      .filter((rel) => /^src\/lib\/services\/(organization|partner)\//.test(rel))
      .filter((rel) => stripComments(read(rel)).includes('supersededAt'));
    expect(
      offenders,
      `Клиентские сервисы обязаны звать канальный строитель, а не копировать фильтр:\n  ${offenders.join('\n  ')}`
    ).toEqual([]);
  });
});

describe('У-151: инвентарь выборок документов в сервисах', () => {
  const sites = collectDocumentQuerySites();

  it('инвентарь вообще что-то нашёл (иначе страж молча пустой)', () => {
    // Сломанный обход каталога или переименование `document.findMany` сделали бы
    // все проверки ниже бессмысленно зелёными: пустой список проходит всё.
    expect(sites.length).toBeGreaterThanOrEqual(15);
  });

  it('каждая выборка, записанная как защищённая, действительно фильтрует версию', () => {
    const broken = Object.keys(GUARDED_SITES).filter(
      (key) => !sites.some((s) => s.key === key && s.guarded)
    );
    expect(
      broken,
      `Из этих списков пропал фильтр версии (или функцию переименовали) — заменённая бумага снова видна:\n  ${broken.join('\n  ')}`
    ).toEqual([]);
  });

  it('новых незащищённых списков не появилось', () => {
    const unregistered = sites
      .filter((s) => !s.guarded)
      .map((s) => s.key)
      .filter((key) => !(key in REGISTERED_UNGUARDED));
    expect(
      unregistered,
      `Новая выборка документов без фильтра версии. Либо позовите канальный строитель, ` +
        `либо запишите её в реестр стража с объяснением, почему заменённая версия там уместна:\n  ${unregistered.join('\n  ')}`
    ).toEqual([]);
  });

  it('в кабинетах заказчика и партнёра незащищённых выборок НЕТ ни одной', () => {
    // Самое острое место `У-151`: клиент не сотрудник, он не отличит заменённый
    // счёт от действующего и оплатит тот, что попался первым.
    const clientHoles = sites
      .filter((s) => !s.guarded)
      .map((s) => s.key)
      .filter((key) => /^src\/lib\/services\/(organization|partner)\//.test(key));
    expect(
      clientHoles,
      `Клиент увидит заменённую версию документа:\n  ${clientHoles.join('\n  ')}`
    ).toEqual([]);
  });

  it('реестр стража не содержит выдуманных строк', () => {
    // Устаревшая запись (функцию переименовали, файл удалили) молча ослабляет
    // проверку «новых дыр нет»: ключ есть в реестре, а кода за ним уже нет.
    const known = [...Object.keys(GUARDED_SITES), ...Object.keys(REGISTERED_UNGUARDED)];
    const stale = known.filter((key) => !sites.some((s) => s.key === key));
    expect(stale, `Реестр разошёлся с кодом, обновите его:\n  ${stale.join('\n  ')}`).toEqual([]);
  });
});

describe('У-151: документы внутри карточки заказа тоже фильтруются', () => {
  // Тут документы приезжают не отдельной выборкой, а вложенным include внутри
  // заказа — инвентарь по `document.findMany` их не видит, а клиент видит.
  const NESTED = [
    ['src/lib/services/organization/orders.ts', 'organizationChannelWhere'],
    ['src/lib/services/partner/orderDetail.ts', 'partnerChannelWhere'],
  ] as const;

  it.each(NESTED)('%s подставляет %s во вложенный include документов', (rel, builder) => {
    const src = stripComments(read(rel));
    expect(
      src,
      `Карточка заказа тянет документы вложенным include — он обязан идти через ${builder}, иначе заменённая версия покажется клиенту`
    ).toMatch(new RegExp(`documents:\\s*\\{\\s*where:\\s*${builder}\\(`));
  });
});

/**
 * Отдельная проверка скоупов менеджера (`У-151`).
 *
 * Инвентарь выше смотрит на ТЕКСТ функции-выборки, а список документов
 * менеджера строится не в ней, а в `managerDocumentScope` — фильтр туда и
 * положен. Без этой проверки мутация «убрать supersededAt из скоупа
 * менеджера» проходила незамеченной: инвентарь видел вызов скоупа и считал
 * выборку защищённой, не заглядывая внутрь.
 */
describe('У-151: скоупы документов менеджера несут фильтр версии', () => {
  const source = readFileSync(path.join(process.cwd(), 'src/lib/auth/managerPolicy.ts'), 'utf8');

  it.each(['managerDocumentScopeFilter', 'managerDocumentScope'])(
    '%s фильтрует заменённые версии',
    (fnName) => {
      const start = source.indexOf(`export function ${fnName}(`);
      expect(start).toBeGreaterThan(-1);
      // Тело функции — до следующего экспорта: точнее парсить незачем, а
      // «где-то в файле» не годится: фильтр обязан стоять именно здесь.
      const rest = source.slice(start + 1);
      const end = rest.indexOf('\nexport ');
      const body = end === -1 ? rest : rest.slice(0, end);
      expect(body).toContain('supersededAt: null');
    }
  );
});

/**
 * Скоуп документов глобального поиска (`У-151`).
 *
 * У поиска ДВЕ ветки — админская и сотрудника, — и админская собирается
 * литералом, а не общим строителем. Без этой проверки убранный фильтр
 * заметил бы только тот, кто ищет документ по номеру и видит две одинаковые
 * строки.
 */
describe('У-151: скоуп документов поиска фильтрует версию в обеих ветках', () => {
  it('обе ветки documents в search/scopes.ts несут фильтр', () => {
    const source = readFileSync(path.join(ROOT, 'src/lib/services/search/scopes.ts'), 'utf8');
    const start = source.indexOf('documents: isAdmin');
    expect(start).toBeGreaterThan(-1);
    const branch = source.slice(start, start + 260);
    // Админская ветка — свой литерал: фильтр обязан стоять прямо в ней.
    expect(branch).toContain('supersededAt: null');
    // Ветка сотрудника — через скоуп менеджера, у которого фильтр свой.
    expect(branch).toContain('managerDocumentScope');
  });
});
