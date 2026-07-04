import React, { type ReactNode } from 'react';
import { OrgSidebar, type OrgSidebarMembership } from './org-sidebar';
import { navItemsFor } from '@/lib/navigation/cabinet';
import { LogoutButton } from '@/components/ui';

export function OrgAppShell(props: {
  userEmail?: string | null;
  activeOrgName: string;
  memberships: OrgSidebarMembership[];
  activeOrgId: string;
  viewerRole: 'admin' | 'leader' | 'member';
  children: ReactNode;
}) {
  const items = navItemsFor('organization');

  return (
    <div className='flex min-h-screen bg-gray-50'>
      <OrgSidebar
        items={items}
        memberships={props.memberships}
        activeOrgId={props.activeOrgId}
        viewerRole={props.viewerRole}
      />
      <div className='flex-1 flex flex-col'>
        <header className='bg-white border-b border-gray-200 px-6 py-3 flex items-center justify-between'>
          <div className='text-sm text-gray-700 truncate'>
            <span className='font-medium text-[#111111]'>{props.activeOrgName}</span>
            {props.userEmail ? (
              <span className='ml-3 text-gray-500'>· {props.userEmail}</span>
            ) : null}
          </div>
          <LogoutButton />
        </header>
        <main className='flex-1 px-6 py-6'>
          <div className='max-w-[1280px] mx-auto'>{props.children}</div>
        </main>
      </div>
    </div>
  );
}
