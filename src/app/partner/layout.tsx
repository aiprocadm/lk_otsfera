import { AppShell } from '@/components/dashboard/app-shell';
import { BottomTabBar } from '@/components/partner/bottom-tab-bar';

export default function PartnerLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <AppShell>
        <div className="pb-16 md:pb-0">{children}</div>
      </AppShell>
      <BottomTabBar />
    </>
  );
}
