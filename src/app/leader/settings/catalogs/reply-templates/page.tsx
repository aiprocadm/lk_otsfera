import type { Metadata } from 'next';
import React from 'react';
import { requireSettingsSection } from '@/lib/auth/requireSettings';
import { prisma } from '@/lib/db/prisma';
import { listReplyTemplates, REPLY_TEMPLATE_TOKENS } from '@/lib/services/replyTemplates/crud';
import { ReplyTemplatesScreen } from '@/components/settings/reply-templates-screen';

export const metadata: Metadata = { title: 'Шаблоны ответов · Настройки' };

export const dynamic = 'force-dynamic';

/**
 * «Шаблоны ответов» руководителя (`У-208`) — зеркало админского раздела
 * (§0.2): то же название, то же место, тот же экран. Отличие одно — скоуп
 * данных: руководитель видит шаблоны своей компании.
 */
export default async function LeaderReplyTemplatesPage() {
  const session = await requireSettingsSection('catalogs.replyTemplates', 'leader');
  const rows = await listReplyTemplates(prisma, session);

  return <ReplyTemplatesScreen cabinet="leader" rows={rows} tokens={[...REPLY_TEMPLATE_TOKENS]} />;
}
