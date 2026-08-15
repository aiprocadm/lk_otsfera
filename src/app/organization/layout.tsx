import React, { type ReactNode } from 'react';
import { notFound } from 'next/navigation';
import { requireOrganization } from '@/lib/auth/requireRole';
import { isFeatureEnabled } from '@/lib/featureFlags';

export default async function OrganizationLayout({ children }: { children: ReactNode }) {
  // Server-side auth gate for the whole /organization/* subtree.
  // Active org context (memberships dropdown, viewer role, name) is
  // resolved per-page because searchParams are not available in layout
  // (Next.js 15 App Router constraint). Each page wraps itself in
  // OrgAppShell with the right props.
  await requireOrganization();
  // Третья точка гейтинга флага (§5): middleware и меню — первые две. Без неё
  // выключение кабинета держалось бы на одном лишь списке префиксов; у кабинета
  // руководителя такая проверка есть с самого начала. Порядок важен: сначала
  // авторизация, потом флаг — иначе существование раздела утекало бы гостю.
  if (!isFeatureEnabled('organization_cabinet')) notFound();
  return <>{children}</>;
}
