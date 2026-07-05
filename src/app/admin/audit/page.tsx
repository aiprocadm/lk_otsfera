import React from 'react';
import Link from 'next/link';
import { requireAdmin } from '@/lib/auth/requireRole';
import { prisma } from '@/lib/db/prisma';
import type { AuditEntity } from '@/lib/auth/audit';
import { listAudit, listAuditFilters } from '@/lib/services/admin/auditLog';
import { AuditLogFilters } from '@/components/admin/audit-log-filters';
import { AuditLogTable } from '@/components/admin/audit-log-table';

export const dynamic = 'force-dynamic';

type SP = {
  entity?: string;
  action?: string;
  actorUserId?: string;
  from?: string;
  to?: string;
  q?: string;
  cursor?: string;
};

function parseDate(v?: string): Date | undefined {
  if (!v) return undefined;
  const d = new Date(v);
  return Number.isFinite(d.getTime()) ? d : undefined;
}

export default async function AdminAuditPage({ searchParams }: { searchParams: Promise<SP> }) {
  await requireAdmin();
  const sp = await searchParams;

  const filters = {
    entity: sp.entity as AuditEntity | undefined,
    action: sp.action || undefined,
    actorUserId: sp.actorUserId || undefined,
    from: parseDate(sp.from),
    to: parseDate(sp.to),
    q: sp.q?.trim() || undefined,
    cursor: sp.cursor || undefined,
    take: 50
  };

  const [{ rows, nextCursor }, options] = await Promise.all([
    listAudit(prisma, filters),
    listAuditFilters(prisma)
  ]);

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold text-[#111111]">Аудит</h1>
      <AuditLogFilters
        entities={options.entities}
        actions={options.actions}
        actors={options.actors}
        current={sp}
      />
      <AuditLogTable rows={rows} />
      {nextCursor && <LoadMore sp={sp} cursor={nextCursor} />}
    </div>
  );
}

function LoadMore({ sp, cursor }: { sp: SP; cursor: string }) {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(sp)) if (v && k !== 'cursor') p.set(k, v);
  p.set('cursor', cursor);
  return (
    <div className="text-center">
      <Link
        href={`/admin/audit?${p.toString()}`}
        className="inline-block px-4 py-2 border border-gray-200 rounded text-sm text-gray-700 hover:bg-gray-50"
      >
        Загрузить ещё
      </Link>
    </div>
  );
}
