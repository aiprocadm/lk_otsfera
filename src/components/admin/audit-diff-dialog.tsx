'use client';
import React from 'react';
import type { AuditRow } from '@/lib/services/admin/auditLog';
import { Dialog } from '@/components/ui/dialog';
import { auditActionLabel, auditEntityLabel, auditFieldLabel } from '@/lib/audit/labels';

const SENSITIVE_KEY_REGEX = /^(passwordHash|token|code|secret|apiKey|signedUrl|.*Secret|.*Token)$/i;

function maskValue(key: string, value: unknown): unknown {
  if (SENSITIVE_KEY_REGEX.test(key)) return '*****';
  if (value !== null && typeof value === 'object') {
    if (Array.isArray(value)) return value.map((v, i) => maskValue(`${i}`, v));
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, maskValue(k, v)]));
  }
  return value;
}

/** Значение поля для показа: строку — как есть, остальное — компактным JSON. */
function displayValue(value: unknown): string {
  if (value === null || value === undefined) return '—';
  if (typeof value === 'string') return value === '' ? '—' : value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return JSON.stringify(value);
}

function section(meta: unknown, key: 'before' | 'after'): Array<[string, unknown]> {
  if (!meta || typeof meta !== 'object') return [];
  const value = (meta as Record<string, unknown>)[key];
  if (!value || typeof value !== 'object' || Array.isArray(value)) return [];
  return Object.entries(value).map(([k, v]) => [k, maskValue(k, v)]);
}

function extras(meta: unknown): string {
  if (!meta || typeof meta !== 'object') return '';
  const rest = Object.fromEntries(
    Object.entries(meta as Record<string, unknown>).filter(
      ([k]) => !['before', 'after', 'status'].includes(k)
    )
  );
  if (Object.keys(rest).length === 0) return '';
  return JSON.stringify(maskValue('', rest), null, 2);
}

/** Колонка «Было»/«Стало»: названия полей — по-русски (ТЗ §6.2). */
function FieldList({ title, rows }: { title: string; rows: Array<[string, unknown]> }) {
  return (
    <div>
      <div className="font-medium text-gray-700 mb-1">{title}</div>
      <div className="bg-gray-50 border border-gray-200 rounded p-3 overflow-auto max-h-[40vh]">
        {rows.length === 0 ? (
          <span className="text-gray-400">—</span>
        ) : (
          <dl className="space-y-1">
            {rows.map(([field, value]) => (
              <div key={field} className="flex gap-2">
                <dt className="text-gray-500 flex-shrink-0">{auditFieldLabel(field)}:</dt>
                <dd className="text-[#111111] break-all">{displayValue(value)}</dd>
              </div>
            ))}
          </dl>
        )}
      </div>
    </div>
  );
}

export function AuditDiffDialog({ row, onClose }: { row: AuditRow; onClose: () => void }) {
  // Only mounted while open, so `open` is constant true. The primitive's
  // unmount-close effect runs the native close() (and focus-restore) when the
  // parent stops rendering this component.
  const before = section(row.meta, 'before');
  const after = section(row.meta, 'after');
  const rest = extras(row.meta);

  return (
    <Dialog
      open
      onClose={onClose}
      title={`${auditActionLabel(row.action)} · ${auditEntityLabel(row.entity)}`}
      size="xl"
    >
      <div className="text-xs text-gray-500 mb-4 -mt-2">{row.id}</div>

      <div className="grid grid-cols-2 gap-3 text-xs">
        <FieldList title="Было" rows={before} />
        <FieldList title="Стало" rows={after} />
      </div>

      {rest && (
        <div className="mt-4">
          <div className="text-xs font-medium text-gray-700 mb-1">Прочие сведения</div>
          <pre className="bg-gray-50 border border-gray-200 rounded p-3 font-mono text-xs whitespace-pre-wrap overflow-auto max-h-[20vh]">
            {rest}
          </pre>
        </div>
      )}

      <div className="flex justify-end pt-4">
        <button
          type="button"
          onClick={onClose}
          className="px-3 py-1.5 border border-gray-200 rounded text-sm text-gray-700 hover:bg-gray-50"
        >
          Закрыть
        </button>
      </div>
    </Dialog>
  );
}
