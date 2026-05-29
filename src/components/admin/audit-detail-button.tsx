'use client';
import React, { useState } from 'react';
import type { AuditRow } from '@/lib/services/admin/auditLog';
import { AuditDiffDialog } from './audit-diff-dialog';

export function AuditDetailButton({ row }: { row: AuditRow }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="text-[#F97316] text-xs hover:underline"
      >
        Подробно
      </button>
      {open && <AuditDiffDialog row={row} onClose={() => setOpen(false)} />}
    </>
  );
}
