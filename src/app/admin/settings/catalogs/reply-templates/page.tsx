import type { Metadata } from 'next';
import React from 'react';
import { requireSettingsSection } from '@/lib/auth/requireSettings';
import { prisma } from '@/lib/db/prisma';
import { listReplyTemplates, REPLY_TEMPLATE_TOKENS } from '@/lib/services/replyTemplates/crud';
import { ReplyTemplatesScreen } from '@/components/settings/reply-templates-screen';

export const metadata: Metadata = { title: 'Шаблоны ответов · Настройки' };

export const dynamic = 'force-dynamic';

/** «Шаблоны ответов» администратора (`У-208`). База — здесь, в слое app. */
export default async function AdminReplyTemplatesPage() {
  const session = await requireSettingsSection('catalogs.replyTemplates', 'admin');
  const rows = await listReplyTemplates(prisma, session);

  return <ReplyTemplatesScreen cabinet="admin" rows={rows} tokens={[...REPLY_TEMPLATE_TOKENS]} />;
}
