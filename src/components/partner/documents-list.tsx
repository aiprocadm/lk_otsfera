'use client';
import React, { useState, useSyncExternalStore } from 'react';
import Link from 'next/link';
import { Badge, Button, EmptyState } from '@/components/ui';
import { ZipDownloadButton } from '@/components/documents/zip-download-button';
import { DOCUMENT_SOURCE_LABELS } from '@/lib/documents/source';
import type { OrgDocumentRow } from '@/lib/services/partner/orgDocuments';
import { ONE_C_PUSH_STATUS_LABEL, ONE_C_PUSH_STATUS_TONE } from '@/lib/documents/oneCPushStatus';
import { fmtDate } from '@/lib/format';
import { moscowYearMonth } from '@/lib/dates/calendar';

/**
 * Этап 8 (`У-169`): выбор строк для «Выгрузить выбранные в 1С». Список сам
 * ничего не выгружает — он лишь рисует флажки и сообщает наверх, что нажали;
 * кто выгружает и что можно выбрать, решает обёртка сотрудников.
 */
export type DocumentsListSelection = {
  selected: ReadonlySet<string>;
  onToggle: (id: string) => void;
  /**
   * Флажок строки активен, только если документ годится для действия.
   * Не задан — выбирать можно любую строку: так и есть у скачивания архивом
   * (`У-252`), где в выборку годится каждая бумага.
   */
  canSelect?: ((doc: OrgDocumentRow) => boolean) | undefined;
  /** Подсказка на неактивном флажке — почему строку выбрать нельзя. */
  disabledHint?: string | undefined;
};

const TYPE_LABELS: Record<string, string> = {
  contract: 'Договор',
  extra_agreement: 'Доп. соглашение',
  invoice: 'Счёт',
  act: 'Акт',
  waybill: 'Накладная',
  certificate: 'Сертификат',
  report: 'Отчёт',
  commission_statement: 'Расчёт комиссии',
  commercial_proposal: 'Коммерческое предложение',
  other: 'Прочее',
};

function fmtSize(bytes: number | null): string {
  if (bytes === null || bytes === 0) return '—';
  const kb = bytes / 1024;
  if (kb < 1024) return `${kb.toFixed(0)} КБ`;
  return `${(kb / 1024).toFixed(1)} МБ`;
}

export function DocumentsList({
  rows,
  downloadEndpointBase = '/api/documents',
  downloadEndpointQuery = '',
  newDocIds = [],
  groupByOrder = false,
  cardHrefBase,
  selection,
  zipDownload = false,
  grouping = false,
}: {
  rows: OrgDocumentRow[];
  downloadEndpointBase?: string;
  downloadEndpointQuery?: string;
  /**
   * §11 ТЗ v0.5 (этап 1 PR-4): база ссылки на карточку документа в текущем
   * кабинете, например `/manager/documents`. Не передан — имя остаётся
   * текстом (списки без карточки, например портфель партнёра).
   */
  cardHrefBase?: string;
  /** Этап 3 PR-2 (ФТ-6.6): id непросмотренных документов — бейдж «новый». */
  newDocIds?: string[];
  /** Этап 3 PR-2 (ФТ-6.6): секции «Заказ №…» / «Без заказа» вместо плоского списка. */
  groupByOrder?: boolean;
  /**
   * `У-169`: выбор строк, которым управляет обёртка (кнопка «Выгрузить
   * выбранные в 1С» живёт у неё). Нет — список ведёт выбор сам, если включено
   * скачивание архивом.
   */
  selection?: DocumentsListSelection | undefined;
  /**
   * `У-252`: флажки и кнопка «Скачать выбранные (ZIP)». Включается во всех
   * шести списках документов; у обёртки сотрудников кнопка стоит рядом с
   * выгрузкой в 1С и делит с ней ОДИН столбец флажков — два столбца рядом
   * человек читал бы как два разных выбора.
   */
  zipDownload?: boolean;
  /**
   * `У-253`: переключатель «по типу / по году / по заказу» над списком.
   *
   * Группировка считается на УЖЕ полученной странице, а не отдельными
   * запросами: иначе счётчики групп разъедутся с постраничностью и человек
   * увидит «Счета: 40» там, где на странице их шесть.
   *
   * Выбор запоминается в браузере (`В-8-5`) — это привычка конкретного
   * сотрудника, а не настройка компании. На сервер он не уходит вовсе:
   * группировка ничего не выбирает из базы.
   */
  grouping?: boolean;
}) {
  const [downloading, setDownloading] = useState<string | null>(null);
  const [ownSelected, setOwnSelected] = useState<ReadonlySet<string>>(new Set());
  /**
   * Выбранная группировка живёт в браузере, а не в состоянии компонента.
   *
   * Соблазн прочитать хранилище эффектом и позвать `setState` велик, но это
   * лишняя перерисовка сразу после монтирования (её ловит и eslint). А прочесть
   * хранилище прямо при первой отрисовке нельзя: на сервере его нет, и разметка
   * сервера разошлась бы с клиентской. `useSyncExternalStore` решает ровно эту
   * задачу — у него отдельный снимок для сервера.
   */
  const groupMode = useSyncExternalStore(
    groupStore.subscribe,
    groupStore.read,
    groupStore.serverRead
  );
  const [error, setError] = useState<string | null>(null);
  // Локально гасим бейдж сразу после скачивания (сервер ставит отметку в download-роуте).
  const [seen, setSeen] = useState<ReadonlySet<string>>(new Set());

  const isNew = (id: string) => newDocIds.includes(id) && !seen.has(id);

  function toggleOwn(id: string) {
    setOwnSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  // Выбор один на список: либо его ведёт обёртка, либо — при скачивании
  // архивом — сам список. Двух наборов флажков в одной таблице не бывает.
  const ownSelection: DocumentsListSelection | undefined = zipDownload
    ? { selected: ownSelected, onToggle: toggleOwn }
    : undefined;
  const rowSelection = selection ?? ownSelection;
  // Кнопку архива рисует список только тогда, когда сам ведёт выбор: у
  // обёртки сотрудников своя панель, и вторая кнопка в списке дублировала бы её.
  const showOwnToolbar = zipDownload && !selection;

  async function download(docId: string, name: string) {
    setError(null);
    setDownloading(docId);
    try {
      const res = await fetch(`${downloadEndpointBase}/${docId}/download${downloadEndpointQuery}`, {
        method: 'POST',
      });
      if (!res.ok) {
        // 410 Gone — карантин ClamAV (CLAUDE.md §10): повтор не поможет
        setError(
          res.status === 410
            ? 'Файл в карантине: не прошёл антивирусную проверку.'
            : 'Не удалось получить ссылку для скачивания'
        );
        return;
      }
      const body = (await res.json()) as { downloadUrl?: string; fileName?: string };
      if (!body.downloadUrl) {
        setError('Ссылка не вернулась — попробуйте ещё раз');
        return;
      }
      setSeen((prev) => new Set(prev).add(docId));
      const a = document.createElement('a');
      a.href = body.downloadUrl;
      // `У-154`: имя даёт сервер («Счёт С-2026-7 от 26.07.2026.pdf»);
      // имя строки — запасной вариант для старых ответов.
      a.download = body.fileName ?? name;
      a.rel = 'noopener noreferrer';
      a.target = '_blank';
      document.body.appendChild(a);
      a.click();
      a.remove();
    } finally {
      setDownloading(null);
    }
  }

  if (rows.length === 0) {
    return (
      // `У-74`: вторая ручная копия разметки `EmptyState` — заменена компонентом.
      <EmptyState
        icon="📄"
        title="Ничего не нашлось"
        message="По выбранному фильтру документов нет — снимите фильтр или выберите другой период."
      />
    );
  }

  const renderRow = (doc: OrgDocumentRow) => (
    <li key={doc.id} className="px-4 py-3 flex items-center gap-3 hover:bg-gray-50">
      {rowSelection && (
        <input
          type="checkbox"
          aria-label={`Выбрать ${doc.name}`}
          checked={rowSelection.selected.has(doc.id)}
          disabled={rowSelection.canSelect ? !rowSelection.canSelect(doc) : false}
          title={
            rowSelection.canSelect && !rowSelection.canSelect(doc)
              ? rowSelection.disabledHint
              : undefined
          }
          onChange={() => rowSelection.onToggle(doc.id)}
          className="h-4 w-4 flex-shrink-0 accent-[#F97316] disabled:opacity-40"
        />
      )}
      <div className="w-10 h-10 bg-[#FFF7ED] rounded-lg flex items-center justify-center flex-shrink-0">
        <span className="text-lg">{iconForType(doc.type)}</span>
      </div>

      <div className="flex-1 min-w-0">
        <div className="font-medium text-[#111111] text-sm truncate">
          {cardHrefBase ? (
            <Link href={`${cardHrefBase}/${doc.id}`} className="hover:underline">
              {doc.name}
            </Link>
          ) : (
            doc.name
          )}
          {isNew(doc.id) && (
            <span className="ml-2 inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase bg-[#FFF7ED] text-[#9A3412]">
              новый
            </span>
          )}
        </div>
        <div className="text-xs text-gray-500 mt-0.5 flex flex-wrap items-center gap-x-2">
          <span>{TYPE_LABELS[doc.type] ?? doc.type}</span>
          {doc.number && (
            <>
              <span aria-hidden>·</span>
              <span className="text-[#111111]">{`№ ${doc.number}`}</span>
            </>
          )}
          {doc.version > 1 && (
            <>
              <span aria-hidden>·</span>
              {/* Версия 1 есть у каждого документа — показывать её значило бы
                  сорить. Видна только у переизданного (`У-151`). */}
              <span>{`версия ${doc.version}`}</span>
            </>
          )}
          <span aria-hidden>·</span>
          <span>{fmtDate(doc.createdAt)}</span>
          <span aria-hidden>·</span>
          <span>{fmtSize(doc.size)}</span>
          <span aria-hidden>·</span>
          <span className={doc.direction === 'incoming' ? 'text-blue-700' : 'text-gray-500'}>
            {doc.direction === 'incoming' ? 'Входящий' : 'Исходящий'}
          </span>
          {doc.signedAt && (
            <>
              <span aria-hidden>·</span>
              <span className="text-green-700">подписан</span>
            </>
          )}
          {doc.source && (
            <>
              <span aria-hidden>·</span>
              {/* `У-258`: откуда документ взялся. Только у сотрудников — в
                  клиентских списках поля нет вовсе. */}
              <span>{DOCUMENT_SOURCE_LABELS[doc.source]}</span>
            </>
          )}
          {doc.oneCPushStatus && doc.oneCPushStatus !== 'none' && (
            <>
              <span aria-hidden>·</span>
              {/* `У-169`: состояние выгрузки в 1С. «Не выгружался» — у большинства
                  строк, показывать его значило бы сорить; видны только отличия. */}
              <Badge tone={ONE_C_PUSH_STATUS_TONE[doc.oneCPushStatus]}>
                {`1С: ${ONE_C_PUSH_STATUS_LABEL[doc.oneCPushStatus]}`}
              </Badge>
            </>
          )}
        </div>
        {!groupByOrder && (
          <div className="text-xs text-gray-400 mt-0.5 truncate">
            {doc.orderId ? `Заказ: ${doc.orderNumber ?? doc.orderTitle}` : 'Общий документ'}
          </div>
        )}
      </div>

      <button
        type="button"
        onClick={() => download(doc.id, doc.name)}
        disabled={downloading === doc.id}
        className="px-3 py-1.5 text-xs border border-gray-200 rounded hover:bg-gray-50 disabled:opacity-50 flex-shrink-0"
      >
        {downloading === doc.id ? 'Готовим…' : 'Скачать'}
      </button>
    </li>
  );

  return (
    <div className="space-y-2">
      {showOwnToolbar && (
        <div
          role="toolbar"
          aria-label="Скачивание выбранных документов"
          className="flex flex-wrap items-center gap-2 rounded-xl border border-gray-200 bg-white px-4 py-2 text-sm"
        >
          <span className="text-gray-700">{`Выбрано: ${ownSelected.size}`}</span>
          <ZipDownloadButton ids={[...ownSelected]} />
          <Button
            size="sm"
            variant="ghost"
            onClick={() => setOwnSelected(new Set(rows.map((d) => d.id)))}
          >
            Выбрать все
          </Button>
          {ownSelected.size > 0 && (
            <Button size="sm" variant="ghost" onClick={() => setOwnSelected(new Set())}>
              Снять выбор
            </Button>
          )}
        </div>
      )}

      {error && (
        <div className="text-sm text-red-700 bg-red-50 border border-red-100 rounded px-3 py-2">
          {error}
        </div>
      )}

      {grouping && (
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <span className="text-gray-500">Группировать:</span>
          {GROUP_MODES.map((mode) => (
            <button
              key={mode.value}
              type="button"
              onClick={() => groupStore.write(mode.value)}
              aria-pressed={groupMode === mode.value}
              className={
                groupMode === mode.value
                  ? 'rounded-full bg-[#F97316] px-3 py-1 text-xs font-medium text-white'
                  : 'rounded-full bg-gray-100 px-3 py-1 text-xs font-medium text-gray-600 hover:bg-gray-200'
              }
            >
              {mode.label}
            </button>
          ))}
        </div>
      )}

      {grouping ? (
        groupRowsBy(rows, groupMode).map((group) => (
          <section key={group.key} className="space-y-1">
            <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wide px-1 pt-2">
              {`${group.title} · ${group.rows.length}`}
            </h3>
            <ul className="bg-white border border-gray-200 rounded-xl divide-y divide-gray-100 overflow-hidden">
              {group.rows.map(renderRow)}
            </ul>
          </section>
        ))
      ) : groupByOrder ? (
        groupRows(rows).map((group) => (
          <section key={group.key} className="space-y-1">
            <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wide px-1 pt-2">
              {group.title}
            </h3>
            <ul className="bg-white border border-gray-200 rounded-xl divide-y divide-gray-100 overflow-hidden">
              {group.rows.map(renderRow)}
            </ul>
          </section>
        ))
      ) : (
        <ul className="bg-white border border-gray-200 rounded-xl divide-y divide-gray-100 overflow-hidden">
          {rows.map(renderRow)}
        </ul>
      )}

      {rows.length === 200 && (
        <div className="text-xs text-gray-500 text-center">
          Показаны первые 200 документов. Чтобы увидеть остальные, уточните фильтр.
        </div>
      )}
    </div>
  );
}

/** Секции по заказу в порядке первого появления (rows приходят createdAt desc); «Без заказа» — как есть. */
function groupRows(
  rows: OrgDocumentRow[]
): Array<{ key: string; title: string; rows: OrgDocumentRow[] }> {
  const groups = new Map<string, { key: string; title: string; rows: OrgDocumentRow[] }>();
  for (const doc of rows) {
    const key = doc.orderId ?? '__none__';
    let group = groups.get(key);
    if (!group) {
      group = {
        key,
        title: doc.orderId
          ? `Заказ ${doc.orderNumber ? `№ ${doc.orderNumber}` : (doc.orderTitle ?? doc.orderId)}`
          : 'Без заказа',
        rows: [],
      };
      groups.set(key, group);
    }
    group.rows.push(doc);
  }
  return Array.from(groups.values());
}

function iconForType(type: string): string {
  switch (type) {
    case 'contract':
    case 'extra_agreement':
      return '📜';
    case 'invoice':
    case 'act':
    case 'waybill':
      return '🧾';
    case 'certificate':
      return '🎖';
    case 'report':
      return '📊';
    case 'commission_statement':
      return '💼';
    default:
      return '📄';
  }
}

/** `У-253`: три способа разложить страницу документов по полкам. */
const GROUP_MODES = [
  { value: 'type' as const, label: 'по типу' },
  { value: 'year' as const, label: 'по году' },
  { value: 'order' as const, label: 'по заказу' },
];

type GroupMode = (typeof GROUP_MODES)[number]['value'];

const GROUP_STORAGE_KEY = 'documents.groupBy';

/** Умолчание — «по заказу»: так список выглядел до появления переключателя. */
const DEFAULT_GROUP_MODE: GroupMode = 'order';

function isGroupMode(value: string): value is GroupMode {
  return GROUP_MODES.some((m) => m.value === value);
}

/**
 * Хранилище выбора группировки — один на страницу.
 *
 * Модульное, а не внутри компонента: два списка на одном экране должны
 * соглашаться друг с другом, иначе человек переключит группировку в одном и
 * удивится, почему второй остался прежним. Любой отказ хранилища (приватный
 * режим, запрет сайту) означает «остаёмся на умолчании», а не поломку экрана.
 */
const groupStore = {
  listeners: new Set<() => void>(),

  /**
   * Выбор, который НЕ УДАЛОСЬ сохранить.
   *
   * В приватном окне и при запрете данных сайта `localStorage` бросает и на
   * записи. Читай экран только хранилище — переключатель стал бы мёртвой
   * кнопкой: нажимается и ничего не меняет. Поэтому неудавшаяся запись живёт
   * в памяти до перезагрузки. Когда запись прошла, память не нужна и
   * обнуляется: источник истины один, и разъехаться им негде.
   */
  memory: null as GroupMode | null,

  subscribe(onChange: () => void): () => void {
    groupStore.listeners.add(onChange);
    // Соседняя вкладка того же кабинета меняет выбор — подхватываем. Её
    // значение свежее нашего, поэтому сессионный слепок сбрасываем.
    const onStorage = () => {
      // Значение соседней вкладки свежее нашей памяти.
      groupStore.memory = null;
      onChange();
    };
    window.addEventListener('storage', onStorage);
    return () => {
      groupStore.listeners.delete(onChange);
      window.removeEventListener('storage', onStorage);
    };
  },

  read(): GroupMode {
    try {
      const saved = window.localStorage.getItem(GROUP_STORAGE_KEY);
      if (saved && isGroupMode(saved)) return saved;
    } catch {
      /* хранилище недоступно — ниже ответит память сессии */
    }
    return groupStore.memory ?? DEFAULT_GROUP_MODE;
  },

  /** На сервере хранилища нет — там всегда умолчание. */
  serverRead(): GroupMode {
    return DEFAULT_GROUP_MODE;
  },

  write(mode: GroupMode): void {
    try {
      window.localStorage.setItem(GROUP_STORAGE_KEY, mode);
      groupStore.memory = null;
    } catch {
      // Не сохранилось на следующий раз — но в этой сессии выбор действует.
      groupStore.memory = mode;
    }
    for (const listener of groupStore.listeners) listener();
  },
};

/**
 * Разложить УЖЕ полученные строки по выбранному признаку.
 *
 * Порядок групп — порядок первого появления: строки приходят от свежих к
 * старым, и переставлять группы значило бы прятать самое новое в середину.
 */
function groupRowsBy(
  rows: OrgDocumentRow[],
  mode: GroupMode
): Array<{ key: string; title: string; rows: OrgDocumentRow[] }> {
  if (mode === 'order') return groupRows(rows);

  const groups = new Map<string, { key: string; title: string; rows: OrgDocumentRow[] }>();
  for (const doc of rows) {
    // Год — московский (прогон №36): документ 1 января в 01:30 по Москве
    // относится к новому году, а часы сервера (UTC) ещё показывают старый.
    const key = mode === 'type' ? doc.type : moscowYearMonth(new Date(doc.createdAt)).slice(0, 4);
    const title = mode === 'type' ? (TYPE_LABELS[doc.type] ?? doc.type) : `${key} год`;
    let group = groups.get(key);
    if (!group) {
      group = { key, title, rows: [] };
      groups.set(key, group);
    }
    group.rows.push(doc);
  }
  return Array.from(groups.values());
}
