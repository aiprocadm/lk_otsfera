import type { Metadata } from 'next';
import React from 'react';
import { requireSettingsSection } from '@/lib/auth/requireSettings';
import { getSettingsView } from '@/lib/config/integrationSettings';
import { prisma } from '@/lib/db/prisma';
import { getAppBaseUrl } from '@/lib/notifications/shared';
import { listAssignableStaff } from '@/lib/services/messengers/assign';
import { WebsiteFormSettings } from '@/components/settings/website-form-settings';

export const metadata: Metadata = { title: 'Сайт · Настройки' };

export const dynamic = 'force-dynamic';

/**
 * «Сайт» (`У-211`): приём заявок с формы на otsfera.ru.
 *
 * Только администратор (`Р-22`): здесь живёт секрет — токен формы. Наружу его
 * значение не отдаётся даже на эту страницу: `getSettingsView` возвращает
 * лишь признак «задан».
 */
export default async function AdminWebsiteSettingsPage() {
  const session = await requireSettingsSection('integrations.website', 'admin');

  const [view, managers] = await Promise.all([
    getSettingsView(prisma, [
      'site.enabled',
      'site.formToken',
      'site.allowedOrigins',
      'site.defaultManagerId',
    ]),
    listAssignableStaff(prisma, session),
  ]);

  const byKey = new Map(view.map((row) => [row.key, row]));
  const enabled = (byKey.get('site.enabled')?.value ?? '').trim().toLowerCase() === 'true';

  return (
    <WebsiteFormSettings
      enabled={enabled}
      allowedOrigins={byKey.get('site.allowedOrigins')?.value ?? ''}
      defaultManagerId={byKey.get('site.defaultManagerId')?.value ?? ''}
      tokenIsSet={byKey.get('site.formToken')?.isSet ?? false}
      appOrigin={getAppBaseUrl()}
      managers={managers}
    />
  );
}
