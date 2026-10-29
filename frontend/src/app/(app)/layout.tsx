import AppShell from '@/components/AppShell';

// Every page in this group needs a signed-in user (see AppShell).
export default function AppLayout({ children }: { children: React.ReactNode }) {
  return <AppShell>{children}</AppShell>;
}
