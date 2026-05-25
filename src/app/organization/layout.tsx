import type { ReactNode } from 'react';
import { requireOrganization } from '@/lib/auth/requireRole';

export default async function OrganizationLayout({ children }: { children: ReactNode }) {
  // Server-side auth gate for the whole /organization/* subtree.
  // Active org context (memberships dropdown, viewer role, name) is
  // resolved per-page because searchParams are not available in layout
  // (Next.js 15 App Router constraint). Each page wraps itself in
  // OrgAppShell with the right props.
  await requireOrganization();
  return <>{children}</>;
}
