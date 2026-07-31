import React from 'react';
import { prisma } from '@/lib/db/prisma';
import { fmtDateTime } from '@/lib/format';
import { listOrgOrderComments } from '@/lib/services/partner/orgComments';

export async function CommentsTab({ orgId }: { orgId: string }) {
  // SECURITY (Track E / E2-C): comments are scoped to the CLIENT organization,
  // not the seller company. See listOrgOrderComments.
  const comments = await listOrgOrderComments(prisma, { orgId });

  if (comments.length === 0) {
    return (
      <div className="bg-white border border-gray-200 rounded-xl p-6 text-sm text-gray-500">
        Комментариев нет.
      </div>
    );
  }

  return (
    <ul className="space-y-2">
      {comments.map((c) => (
        <li key={c.id} className="bg-white border border-gray-200 rounded-xl p-4">
          <div className="flex justify-between text-xs text-gray-500 mb-1">
            <span>
              {c.authorName} · «{c.orderTitle}»
            </span>
            <span>{fmtDateTime(c.createdAt)}</span>
          </div>
          <div className="text-sm text-[#111111] whitespace-pre-wrap">{c.body}</div>
        </li>
      ))}
    </ul>
  );
}
