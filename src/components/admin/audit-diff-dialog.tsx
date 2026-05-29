'use client';
import React, { useEffect } from 'react';
import { useDialogFocus } from '@/hooks/useDialogFocus';
import type { AuditRow } from '@/lib/services/admin/auditLog';

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
  const filtered = Object.fromEntries(
    Object.entries(meta as Record<string, unknown>).filter(([k]) => keys.includes(k))
  );
  return JSON.stringify(maskValue('', filtered), null, 2);
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
  const ref = useDialogFocus(true);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const before = maskedJsonString(row.meta, ['before']);
  const after = maskedJsonString(row.meta, ['after']);
  const extras = maskedExtraJsonString(row.meta, ['before', 'after']);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={onClose}>
      <div
        ref={ref}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-labelledby="audit-diff-title"
        className="bg-white rounded-xl max-w-3xl w-full max-h-[80vh] overflow-auto p-6 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 id="audit-diff-title" className="text-lg font-bold text-[#111111] mb-2">
          {row.action} · {row.entity}
        </h2>
        <div className="text-xs text-gray-500 mb-4">{row.id}</div>

        <div className="grid grid-cols-2 gap-3 text-xs">
          <div>
            <div className="font-medium text-gray-700 mb-1">До</div>
            <pre className="bg-gray-50 border border-gray-200 rounded p-3 font-mono whitespace-pre-wrap overflow-auto max-h-[40vh]">
              {before || '—'}
            </pre>
          </div>
          <div>
            <div className="font-medium text-gray-700 mb-1">После</div>
            <pre className="bg-gray-50 border border-gray-200 rounded p-3 font-mono whitespace-pre-wrap overflow-auto max-h-[40vh]">
              {after || '—'}
            </pre>
          </div>
        </div>

        {extras && (
          <div className="mt-4">
            <div className="text-xs font-medium text-gray-700 mb-1">Прочие meta-поля</div>
            <pre className="bg-gray-50 border border-gray-200 rounded p-3 font-mono text-xs whitespace-pre-wrap overflow-auto max-h-[20vh]">
              {extras}
            </pre>
          </div>
        )}

        <button
          type="button"
          onClick={onClose}
          className="mt-4 px-3 py-1.5 border border-gray-200 rounded text-sm text-gray-700 hover:bg-gray-50"
        >
          Закрыть
        </button>
      </div>
    </div>
  );
}
