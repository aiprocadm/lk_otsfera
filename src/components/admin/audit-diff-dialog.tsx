'use client';
import React from 'react';
import type { AuditRow } from '@/lib/services/admin/auditLog';
import { Dialog } from '@/components/ui/dialog';

const SENSITIVE_KEY_REGEX = /^(passwordHash|token|code|secret|apiKey|signedUrl|.*Secret|.*Token)$/i;

function maskValue(key: string, value: unknown): unknown {
  if (SENSITIVE_KEY_REGEX.test(key)) return '*****';
  if (value !== null && typeof value === 'object') {
    if (Array.isArray(value)) return value.map((v, i) => maskValue(`${i}`, v));
    return Object.fromEntries(
      Object.entries(value).map(([k, v]) => [k, maskValue(k, v)])
    );
  }
  return value;
}

function maskedJsonString(meta: unknown, keys: string[]): string {
  if (!meta || typeof meta !== 'object') return '';
  const record = meta as Record<string, unknown>;
  const parts = keys
    .filter((k) => k in record)
    .map((k) => [k, maskValue(k, record[k])] as const);
  if (parts.length === 0) return '';
  // Single key (before/after): unwrap — the panel header already names it. Both call sites
  // below pass a single-element keys array, so `parts.length` is always exactly 1 here.
  return JSON.stringify(parts[0][1], null, 2);
}

function maskedExtraJsonString(meta: unknown, excludeKeys: string[]): string {
  if (!meta || typeof meta !== 'object') return '';
  const extras = Object.fromEntries(
    Object.entries(meta as Record<string, unknown>).filter(([k]) => !excludeKeys.includes(k))
  );
  if (Object.keys(extras).length === 0) return '';
  return JSON.stringify(maskValue('', extras), null, 2);
}

export function AuditDiffDialog({ row, onClose }: { row: AuditRow; onClose: () => void }) {
  // Only mounted while open, so `open` is constant true. The primitive's
  // unmount-close effect runs the native close() (and focus-restore) when the
  // parent stops rendering this component.
  const before = maskedJsonString(row.meta, ['before']);
  const after = maskedJsonString(row.meta, ['after']);
  const extras = maskedExtraJsonString(row.meta, ['before', 'after']);

  return (
    <Dialog open onClose={onClose} title={`${row.action} · ${row.entity}`} size='xl'>
      <div className='text-xs text-gray-500 mb-4 -mt-2'>{row.id}</div>

      <div className='grid grid-cols-2 gap-3 text-xs'>
        <div>
          <div className='font-medium text-gray-700 mb-1'>До</div>
          <pre className='bg-gray-50 border border-gray-200 rounded p-3 font-mono whitespace-pre-wrap overflow-auto max-h-[40vh]'>
            {before || '—'}
          </pre>
        </div>
        <div>
          <div className='font-medium text-gray-700 mb-1'>После</div>
          <pre className='bg-gray-50 border border-gray-200 rounded p-3 font-mono whitespace-pre-wrap overflow-auto max-h-[40vh]'>
            {after || '—'}
          </pre>
        </div>
      </div>

      {extras && (
        <div className='mt-4'>
          <div className='text-xs font-medium text-gray-700 mb-1'>Прочие meta-поля</div>
          <pre className='bg-gray-50 border border-gray-200 rounded p-3 font-mono text-xs whitespace-pre-wrap overflow-auto max-h-[20vh]'>
            {extras}
          </pre>
        </div>
      )}

      <div className='flex justify-end pt-4'>
        <button
          type='button'
          onClick={onClose}
          className='px-3 py-1.5 border border-gray-200 rounded text-sm text-gray-700 hover:bg-gray-50'
        >
          Закрыть
        </button>
      </div>
    </Dialog>
  );
}
