'use client';

import React, { useRef, useState } from 'react';
import {
  previewPaymentImportAction,
  commitPaymentImportAction,
} from '@/server-actions/payment-import';
import { IMPORT_MAX_FILE_BYTES, IMPORT_MAX_FILE_MB } from '@/lib/config/import-limits';
import { clientLog } from '@/lib/logging/client';
import { PAYMENT_IMPORT_ERRORS, errorMessage as messageFor, fileSizeMb } from './error-messages';

type Counts = {
  totalRows: number;
  imported: number;
  refunds: number;
  queued: number;
  excluded: number;
  excludedByReason: Record<string, number>;
  queuedByReason?: Record<string, number>;
  parseErrors: number;
};
/** «Что система увидела в файле» (`У-58`). */
type Diagnostics = {
  columnSource: 'headers' | 'fallback';
  headerRow: number | null;
  matchedColumns: Record<string, number>;
  startMarkerFound: boolean;
  rowsScanned: number;
  parseErrorsByReason: Record<string, number>;
  samples: Array<{ rowNumber: number; reasons: string[]; document: string; corr: string }>;
  notes: string[];
};
/** `detail` — уточнение к тексту ошибки (например фактический размер файла). */
type Failure = { ok: false; error: string; detail?: string; diagnostics?: Diagnostics };
/** Контрагент из файла, которого нет в системе (`У-52`). */
type NewCounterparty = { name: string; inn: string; rows: number };
type PreviewResult =
  | {
      ok: true;
      plan: { counts: Counts; diagnostics?: Diagnostics; newCounterparties?: NewCounterparty[] };
    }
  | Failure;
type CommitResult =
  | { ok: true; result: { counts: Counts; batchId: string | null; diagnostics?: Diagnostics } }
  | Failure;

function errorMessage(code: string): string {
  return messageFor(PAYMENT_IMPORT_ERRORS, code);
}

/** Отказ до отправки: слишком большой файл не имеет смысла везти на сервер (Т-6). */
function tooLargeFailure(file: File): Failure {
  return { ok: false, error: 'file_too_large', detail: `Ваш файл — ${fileSizeMb(file.size)} МБ.` };
}

const REASON_RU: Record<string, string> = {
  supplier: 'Оплаты поставщикам (60)',
  bank_fee: 'Комиссии/услуги банка (91)',
  internal_transfer: 'Внутренние переводы',
  corr_other: 'Прочие корр-счета',
};

/** Почему строка ушла в очередь — словами, а не кодом матчера. */
const QUEUE_REASON_RU: Record<string, string> = {
  name_fuzzy: 'нашли похожую организацию — нужно подтвердить вручную',
  none: 'не нашли ни счёт, ни ИНН, ни похожую организацию',
};

const PARSE_REASON_RU: Record<string, string> = {
  no_doc_number: 'не найден номер документа',
  no_amount: 'не найдена сумма',
  no_date: 'не найдена дата',
};

/** Порядок и подписи колонок — перебираем известные поля, а не ключи объекта. */
const COLUMN_ORDER = ['date', 'document', 'analyticsCr', 'corr', 'debit', 'credit'] as const;
const COLUMN_RU: Record<(typeof COLUMN_ORDER)[number], string> = {
  date: 'Дата',
  document: 'Документ',
  analyticsCr: 'Аналитика Кт',
  corr: 'Корр. счёт',
  debit: 'Дебет',
  credit: 'Кредит',
};

/**
 * `У-58`: «Что система увидела в файле». Раньше при неудаче человек видел
 * только число «Ошибок разбора» и не мог понять ни причины, ни что чинить.
 */
function DiagnosticsCard({ d }: { d: Diagnostics }) {
  const reasons = Object.entries(d.parseErrorsByReason);
  const headerRowLabel = d.headerRow === null ? '' : ` (строка ${d.headerRow + 1})`;
  const recognized = COLUMN_ORDER.filter((f) => d.matchedColumns[f] !== undefined).map(
    (f) => `${COLUMN_RU[f]} → колонка ${d.matchedColumns[f]! + 1}`
  );
  return (
    <div
      className="bg-white border border-gray-200 rounded-xl p-4 space-y-3"
      data-testid="payment-import-diagnostics"
    >
      <h3 className="text-sm font-semibold text-[#111111]">Что система увидела в файле</h3>

      <ul className="text-xs text-gray-600 space-y-0.5">
        <li>
          Колонки:{' '}
          <span className="font-medium text-[#111111]">
            {d.columnSource === 'headers'
              ? `найдены по заголовкам${headerRowLabel}`
              : 'заголовки не распознаны, взята стандартная раскладка'}
          </span>
        </li>
        {recognized.length > 0 && <li>Распознаны: {recognized.join(', ')}</li>}
        <li>
          Строка «Сальдо на начало»:{' '}
          <span className="font-medium text-[#111111]">
            {d.startMarkerFound ? 'найдена' : 'не найдена'}
          </span>
        </li>
        <li>
          Прочитано строк-операций:{' '}
          <span className="font-medium text-[#111111]">{d.rowsScanned}</span>
        </li>
      </ul>

      {d.notes.map((n) => (
        <p
          key={n}
          className="text-xs text-amber-800 bg-amber-50 border border-amber-100 rounded px-2 py-1"
        >
          {n}
        </p>
      ))}

      {reasons.length > 0 && (
        <div className="text-xs text-gray-600">
          <div className="font-medium mb-1">Почему строки не прочитаны:</div>
          <ul className="space-y-0.5">
            {reasons.map(([code, n]) => (
              <li key={code}>
                {PARSE_REASON_RU[code] ?? code}:{' '}
                <span className="font-medium text-[#111111]">{n}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {d.samples.length > 0 && (
        <div className="text-xs text-gray-600">
          <div className="font-medium mb-1">Примеры непрочитанных строк:</div>
          <ul className="space-y-1">
            {d.samples.map((s) => (
              <li key={s.rowNumber} className="border-l-2 border-gray-200 pl-2">
                <span className="font-medium text-[#111111]">Строка {s.rowNumber}</span> —{' '}
                {s.reasons.map((r) => PARSE_REASON_RU[r] ?? r).join(', ')}
                <div className="text-gray-500 break-words">
                  {s.document || '(колонка «Документ» пуста)'}
                  {s.corr ? ` · корр. счёт ${s.corr}` : ''}
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

/**
 * `У-52`: контрагенты из файла, которых в системе ещё нет, — списком «название
 * + ИНН» ДО применения. Пока автосоздание не включено (следующий PR этапа),
 * блок честно говорит, куда такие строки уходят сейчас: обещать создание,
 * которого не будет, — это дефект понятности, а не мелочь формулировки.
 */
function NewCounterpartiesCard({ list }: { list: NewCounterparty[] }) {
  if (list.length === 0) return null;
  return (
    <div
      className="bg-white border border-gray-200 rounded-xl p-4"
      data-testid="payment-import-new-counterparties"
    >
      <h3 className="text-sm font-semibold text-[#111111]">
        Новых контрагентов в файле: {list.length}
      </h3>
      <p className="mt-1 text-xs text-gray-500">
        Организаций с такими ИНН в системе нет. Сейчас их платежи уходят в очередь разбора — там
        организацию можно завести кнопкой.
      </p>
      <ul className="mt-2 text-xs text-gray-700 space-y-0.5">
        {list.map((c) => (
          <li key={c.inn}>
            <span className="font-medium text-[#111111]">{c.name || 'без названия'}</span> · ИНН{' '}
            {c.inn}
            {c.rows > 1 ? ` · строк: ${c.rows}` : ''}
          </li>
        ))}
      </ul>
    </div>
  );
}

function CountsCard({ title, counts }: { title: string; counts: Counts }) {
  return (
    <div className="bg-white border border-gray-200 rounded-xl p-4">
      <h3 className="text-sm font-semibold text-[#111111] mb-2">{title}</h3>
      <div className="grid grid-cols-2 gap-x-6 gap-y-1 text-sm">
        <div className="text-gray-600">Строк-операций</div>
        <div className="font-medium text-[#111111]">{counts.totalRows}</div>
        <div className="text-gray-600">К импорту</div>
        <div className="font-medium text-[#111111]" data-testid="count-imported">
          {counts.imported}
        </div>
        <div className="text-gray-600">из них возвратов</div>
        <div className="font-medium text-[#111111]">{counts.refunds}</div>
        <div className="text-gray-600">В очередь разбора</div>
        <div className="font-medium text-[#111111]" data-testid="count-queued">
          {counts.queued}
        </div>
        <div className="text-gray-600">Исключено</div>
        <div className="font-medium text-[#111111]">{counts.excluded}</div>
        {counts.parseErrors > 0 && (
          <>
            <div className="text-gray-600">Ошибок разбора</div>
            <div className="font-medium text-red-600">{counts.parseErrors}</div>
          </>
        )}
      </div>
      {/* Строки разобраны, но привязать их не к чему — это НЕ отказ импорта,
          и человек должен понять разницу (жалоба 11.08.2026). */}
      {counts.imported === 0 && counts.queued > 0 && (
        <p
          role="status"
          className="mt-3 text-xs text-amber-900 bg-amber-50 border border-amber-100 rounded px-3 py-2"
          data-testid="payment-import-nothing-matched"
        >
          Операции прочитаны, но ни одна не привязалась к организации или заказу — все ушли в
          очередь разбора. Обычно так бывает, когда в системе ещё нет клиентов и заказов из 1С:
          загрузите их на вкладке «Загрузка Excel» и повторите импорт выписки — тогда платежи
          привяжутся сами. Уже загруженные строки при этом не задвоятся.
        </p>
      )}

      {counts.queuedByReason && Object.keys(counts.queuedByReason).length > 0 && (
        <div className="mt-3 text-xs text-gray-600">
          <div className="font-medium mb-1">В очередь разбора — почему:</div>
          <ul className="space-y-0.5">
            {Object.entries(counts.queuedByReason).map(([k, v]) => (
              <li key={k}>
                {QUEUE_REASON_RU[k] ?? k}: <span className="font-medium text-[#111111]">{v}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {Object.keys(counts.excludedByReason).length > 0 && (
        <div className="mt-3 text-xs text-gray-600">
          <div className="font-medium mb-1">Исключено по причинам:</div>
          <ul className="space-y-0.5">
            {Object.entries(counts.excludedByReason).map(([k, v]) => (
              <li key={k}>
                {REASON_RU[k] ?? k}: <span className="font-medium text-[#111111]">{v}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

export function PaymentImportForm() {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [hasFile, setHasFile] = useState(false);
  const [preview, setPreview] = useState<PreviewResult | null>(null);
  const [commitResult, setCommitResult] = useState<CommitResult | null>(null);
  const [isPreviewing, setIsPreviewing] = useState(false);
  const [isCommitting, setIsCommitting] = useState(false);

  function handleFileChange() {
    setHasFile(!!fileInputRef.current?.files?.length);
    setPreview(null);
    setCommitResult(null);
  }

  async function handlePreview(e: React.FormEvent) {
    e.preventDefault();
    const file = fileInputRef.current?.files?.[0];
    if (!file) return;
    setPreview(null);
    setCommitResult(null);
    // Т-6: слишком большой файл не отправляем — Next обрезал бы тело, и форма
    // замолчала бы вместо внятного отказа.
    if (file.size > IMPORT_MAX_FILE_BYTES) {
      setPreview(tooLargeFailure(file));
      return;
    }
    setIsPreviewing(true);
    try {
      const form = new FormData();
      form.set('file', file);
      setPreview((await previewPaymentImportAction(form)) as PreviewResult);
    } catch (e) {
      // Т-4: раньше отклонённый промис не менял состояние — экран не менялся.
      clientLog.error('[1c-import] запрос предпросмотра выписки не дошёл до сервера', e);
      setPreview({ ok: false, error: 'network_or_server' });
    } finally {
      setIsPreviewing(false);
    }
  }
  async function handleCommit() {
    const file = fileInputRef.current?.files?.[0];
    if (!file) return;
    if (file.size > IMPORT_MAX_FILE_BYTES) {
      setCommitResult(tooLargeFailure(file));
      return;
    }
    setIsCommitting(true);
    try {
      const form = new FormData();
      form.set('file', file);
      setCommitResult((await commitPaymentImportAction(form)) as CommitResult);
    } catch (e) {
      clientLog.error('[1c-import] запрос импорта выписки не дошёл до сервера', e);
      setCommitResult({ ok: false, error: 'network_or_server' });
    } finally {
      setIsCommitting(false);
    }
  }

  const counts = preview?.ok ? preview.plan.counts : null;

  return (
    <div className="space-y-6">
      <form onSubmit={handlePreview} className="space-y-4">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            {`Файл «Карточка счёта 51» (.xls или .xlsx, до ${IMPORT_MAX_FILE_MB} МБ)`}
          </label>
          <input
            ref={fileInputRef}
            type="file"
            accept=".xls,.xlsx"
            onChange={handleFileChange}
            className="block w-full text-sm text-gray-700 border border-gray-300 rounded px-3 py-2 file:mr-3 file:py-1 file:px-3 file:rounded file:border-0 file:text-sm file:font-medium file:bg-[#F97316] file:text-white hover:file:bg-[#EA580C] cursor-pointer"
            data-testid="payment-import-file-input"
          />
        </div>
        <button
          type="submit"
          disabled={!hasFile || isPreviewing}
          className="px-4 py-2 rounded text-sm font-medium text-white transition-colors bg-[#F97316] hover:bg-[#EA580C] disabled:opacity-50 disabled:cursor-not-allowed"
          data-testid="payment-import-preview-button"
        >
          {isPreviewing ? 'Загрузка…' : 'Загрузить и проверить'}
        </button>
      </form>

      {preview && !preview.ok && (
        <div className="space-y-4">
          <div
            role="alert"
            className="text-sm text-red-600 bg-red-50 border border-red-200 rounded px-4 py-2"
          >
            {errorMessage(preview.error)}
            {preview.detail ? ` ${preview.detail}` : ''}
          </div>
          {preview.diagnostics && <DiagnosticsCard d={preview.diagnostics} />}
        </div>
      )}

      {counts && (
        <div className="space-y-4" data-testid="payment-import-plan">
          <div className="bg-white border border-gray-200 rounded-xl p-4">
            <h2 className="text-base font-semibold text-[#111111] mb-1">Результаты проверки</h2>
            <p className="text-xs text-gray-500">Режим: предпросмотр (данные не записаны)</p>
          </div>
          <CountsCard title="План импорта" counts={counts} />
          {preview?.ok && preview.plan.newCounterparties && (
            <NewCounterpartiesCard list={preview.plan.newCounterparties} />
          )}
          {preview?.ok && preview.plan.diagnostics && (
            <DiagnosticsCard d={preview.plan.diagnostics} />
          )}
          {commitResult === null && (
            <button
              type="button"
              onClick={handleCommit}
              disabled={isCommitting}
              className="px-4 py-2 rounded text-sm font-medium text-white transition-colors bg-[#F97316] hover:bg-[#EA580C] disabled:opacity-50 disabled:cursor-not-allowed"
              data-testid="payment-import-commit-button"
            >
              {isCommitting ? 'Импорт…' : 'Подтвердить импорт'}
            </button>
          )}
        </div>
      )}

      {commitResult && commitResult.ok && (
        <div role="status" className="space-y-4">
          <div className="bg-green-50 border border-green-200 rounded-xl p-4">
            <p className="text-sm font-semibold text-green-800">Импорт выполнен</p>
          </div>
          <CountsCard title="Итог импорта" counts={commitResult.result.counts} />
        </div>
      )}
      {commitResult && !commitResult.ok && (
        <div
          role="alert"
          className="text-sm text-red-600 bg-red-50 border border-red-200 rounded px-4 py-2"
        >
          {errorMessage(commitResult.error)}
          {commitResult.detail ? ` ${commitResult.detail}` : ''}
        </div>
      )}
    </div>
  );
}
