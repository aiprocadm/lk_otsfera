import React from 'react';
import Link from 'next/link';
import { requireAdmin } from '@/lib/auth/requireRole';
import { prisma } from '@/lib/db/prisma';
import { isFeatureEnabled } from '@/lib/featureFlags';
import {
  listPiiAccess,
  listPiiAccessFilters,
  type PiiAccessFilters as Filters,
} from '@/lib/services/admin/piiAccess';
import type { PiiContextKey, PiiSubjectType } from '@/lib/pii/contexts';
import { PiiAccessFilters } from '@/components/admin/pii-access-filters';
import { PiiAccessTable } from '@/components/admin/pii-access-table';

export const dynamic = 'force-dynamic';

type SP = {
  actorUserId?: string;
  userRole?: string;
  context?: string;
  subjectType?: string;
  subjectId?: string;
  from?: string;
  to?: string;
  cursor?: string;
};

function parseDate(v?: string): Date | undefined {
  if (!v) return undefined;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? undefined : d;
}

export default async function AdminPiiAccessPage({ searchParams }: { searchParams: Promise<SP> }) {
  const session = await requireAdmin();
  const sp = await searchParams;

  const actorUserId = sp.actorUserId || undefined;
  const userRole = sp.userRole || undefined;
  const context = (sp.context || undefined) as PiiContextKey | undefined;
  const subjectType = (sp.subjectType || undefined) as PiiSubjectType | undefined;
  const subjectId = sp.subjectId?.trim() || undefined;
  const from = parseDate(sp.from);
  const to = parseDate(sp.to);
  const cursor = sp.cursor || undefined;

  // exactOptionalPropertyTypes: PiiAccessFilters различает «поля нет» и «поле = undefined».
  const filters: Filters = {
    ...(actorUserId !== undefined ? { actorUserId } : {}),
    ...(userRole !== undefined ? { userRole } : {}),
    ...(context !== undefined ? { context } : {}),
    ...(subjectType !== undefined ? { subjectType } : {}),
    ...(subjectId !== undefined ? { subjectId } : {}),
    ...(from !== undefined ? { from } : {}),
    ...(to !== undefined ? { to } : {}),
    ...(cursor !== undefined ? { cursor } : {}),
    take: 50,
  };

  const [listResult, optionsResult] = await Promise.all([
    listPiiAccess(prisma, session, filters),
    listPiiAccessFilters(prisma, session),
  ]);
  // requireAdmin уже гарантировал роль; forbidden здесь недостижим, но Result-контракт §3 сохраняем.
  const rows = listResult.ok ? listResult.rows : [];
  const nextCursor = listResult.ok ? listResult.nextCursor : null;
  const options = optionsResult.ok ? optionsResult : { contexts: [], subjectTypes: [], actors: [] };

  const recordingEnabled = isFeatureEnabled('pii_access_log');

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold text-[#111111]">Доступ к ПДн</h1>
        <p className="text-sm text-gray-500 mt-1">
          Журнал чтения персональных данных сотрудниками (§25.7). Скачивания файлов — в разделе{' '}
          <Link href="/admin/audit" className="underline">
            Аудит
          </Link>
          .
        </p>
      </div>
      {!recordingEnabled && (
        <div
          role="status"
          className="bg-amber-50 border border-amber-200 text-amber-800 rounded-xl p-3 text-sm"
        >
          Запись журнала приостановлена (FEATURE_PII_ACCESS_LOG=0). Показана накопленная история;
          новые доступы к ПДн сейчас не фиксируются — включите флаг сразу после устранения
          инцидента.
        </div>
      )}
      <PiiAccessFilters
        contexts={options.contexts}
        subjectTypes={options.subjectTypes}
        actors={options.actors}
        current={{
          actorUserId: sp.actorUserId,
          userRole: sp.userRole,
          context: sp.context,
          subjectType: sp.subjectType,
          subjectId: sp.subjectId,
          from: sp.from,
          to: sp.to,
        }}
      />
      <PiiAccessTable rows={rows} />
      {nextCursor && (
        <div className="flex justify-end">
          <Link
            href={{ pathname: '/admin/pii-access', query: { ...sp, cursor: nextCursor } }}
            className="px-3 py-1.5 border border-gray-200 rounded text-sm text-gray-600 hover:bg-gray-50"
          >
            Следующая страница →
          </Link>
        </div>
      )}
    </div>
  );
}
