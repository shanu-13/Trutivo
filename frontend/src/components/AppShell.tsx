"use client";

import { useEffect, useId, useState, type ReactNode } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useAuth } from '@/context/AuthContext';
import { getReminderSummary } from '@/lib/api/reminders.api';
import BrandLogo from './BrandLogo';

type NavItem = { href: string; label: string; also?: string[] };

// The signed-in navigation, grouped by what people are doing.
const NAV: { title: string; items: NavItem[] }[] = [
  {
    title: 'Overview',
    items: [
      { href: '/dashboard', label: 'Dashboard' },
      { href: '/dashboard/insights', label: 'Insights' },
    ],
  },
  {
    title: 'Resumes',
    items: [
      { href: '/dashboard/resumes', label: 'My Resumes' },
      { href: '/resume/upload', label: 'Upload Resume' },
      { href: '/dashboard/tailor', label: 'Tailor' },
      { href: '/dashboard/match', label: 'Job Matching' },
      { href: '/dashboard/match-history', label: 'Match History' },
    ],
  },
  {
    title: 'Job search',
    items: [
      { href: '/job-descriptions', label: 'Job Descriptions' },
      { href: '/dashboard/applications', label: 'Applications' },
      { href: '/dashboard/reminders', label: 'Reminders' },
    ],
  },
  {
    title: 'Prepare',
    items: [
      { href: '/dashboard/cover-letters', label: 'Cover Letters' },
      { href: '/dashboard/interviews', label: 'Interviews' },
    ],
  },
];

const isActive = (pathname: string, item: NavItem) => {
  // The dashboard is only active on itself; other sections include their sub-pages.
  if (item.href === '/dashboard') return pathname === '/dashboard';
  return [item.href, ...(item.also ?? [])].some((p) => pathname === p || pathname.startsWith(`${p}/`));
};

function NavLinks({ pathname, overdue, onNavigate }: { pathname: string; overdue: number; onNavigate?: () => void }) {
  return (
    <div className="space-y-6">
      {NAV.map((group) => (
        <div key={group.title}>
          <p className="px-3 mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-slate-500">{group.title}</p>
          <ul className="space-y-0.5">
            {group.items.map((item) => {
              const active = isActive(pathname, item);
              return (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    onClick={onNavigate}
                    aria-current={active ? 'page' : undefined}
                    className={`flex items-center justify-between gap-2 rounded-md border-l-2 px-3 py-2 text-sm transition-colors ${
                      active ? 'border-accent bg-accent-soft font-semibold text-ink' : 'border-transparent text-slate-600 hover:bg-slate-50 hover:text-ink'
                    }`}
                  >
                    <span>{item.label}</span>
                    {item.href === '/dashboard/reminders' && overdue > 0 && (
                      <span className="inline-flex min-w-5 justify-center rounded-full bg-red-600 px-1.5 text-xs font-semibold text-white">
                        <span aria-hidden="true">{overdue}</span>
                        <span className="sr-only">, {overdue} overdue</span>
                      </span>
                    )}
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </div>
  );
}

function Account({ name, onLogout }: { name?: string; onLogout: () => void }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <div className="min-w-0">
        <p className="text-xs text-slate-500">Signed in as</p>
        <p className="truncate text-sm font-medium text-ink">{name}</p>
      </div>
      <button onClick={onLogout} className="shrink-0 rounded-md border border-slate-200 px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50 hover:text-ink">
        Logout
      </button>
    </div>
  );
}

// Frame of the signed-in application (route group (app)): a white sidebar with
// the logo (a top bar with a menu on smaller screens). It also guards every
// private page: nothing is rendered until the session is confirmed.
export default function AppShell({ children }: { children: ReactNode }) {
  const { user, isAuthenticated, logout, loading } = useAuth();
  const pathname = usePathname();
  const [overdue, setOverdue] = useState(0);
  const [menuOpen, setMenuOpen] = useState(false);
  const menuId = useId();

  // The overdue count is re-read when the page changes; a failure just hides the badge.
  useEffect(() => {
    if (!isAuthenticated) return;
    let cancelled = false;
    getReminderSummary()
      .then((s) => {
        if (!cancelled) setOverdue(s.counts.overdue);
      })
      .catch(() => {
        if (!cancelled) setOverdue(0);
      });
    return () => {
      cancelled = true;
    };
  }, [isAuthenticated, pathname]);

  // Escape closes the mobile menu.
  useEffect(() => {
    if (!menuOpen) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setMenuOpen(false);
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [menuOpen]);

  const router = useRouter();
  // Private pages: wait for the session check, then send anyone signed out to
  // the login page, which brings them back here afterwards.
  useEffect(() => {
    if (!loading && !isAuthenticated) router.replace(`/login?next=${encodeURIComponent(pathname)}`);
  }, [loading, isAuthenticated, pathname, router]);

  const skipLink = (
    <a href="#content" className="sr-only focus:not-sr-only focus:fixed focus:left-3 focus:top-3 focus:z-50 focus:rounded-md focus:bg-white focus:px-3 focus:py-2 focus:text-sm focus:font-medium focus:text-ink focus:shadow">
      Skip to content
    </a>
  );

  if (loading || !isAuthenticated) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-canvas" role="status" aria-live="polite">
        <BrandLogo className="h-8 w-auto" priority />
        <p className="text-sm text-slate-600">{loading ? 'Loading your workspace...' : 'Redirecting to log in...'}</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen">
      {skipLink}
      {/* Large screens: fixed sidebar. */}
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-60 flex-col border-r border-line bg-white lg:flex">
        <div className="flex h-16 shrink-0 items-center border-b border-line px-5">
          <Link href="/dashboard" aria-label="Trutivo dashboard">
            <BrandLogo className="h-7 w-auto" priority />
          </Link>
        </div>
        <nav aria-label="Main" className="flex-1 overflow-y-auto px-3 py-5">
          <NavLinks pathname={pathname} overdue={overdue} />
        </nav>
        <div className="border-t border-line p-4">
          <Account name={user?.name} onLogout={logout} />
        </div>
      </aside>

      {/* Smaller screens: top bar with a menu. */}
      <header className="sticky top-0 z-30 border-b border-line bg-white lg:hidden">
        <div className="flex h-14 items-center justify-between px-4">
          <Link href="/dashboard" aria-label="Trutivo dashboard">
            <BrandLogo className="h-7 w-auto" priority />
          </Link>
          <button
            onClick={() => setMenuOpen((o) => !o)}
            aria-expanded={menuOpen}
            aria-controls={menuId}
            className="inline-flex items-center gap-2 rounded-md border border-slate-200 px-3 py-1.5 text-sm font-medium text-ink hover:bg-slate-50"
          >
            <svg aria-hidden="true" viewBox="0 0 20 20" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round">
              {menuOpen ? <path d="M5 5l10 10M15 5L5 15" /> : <path d="M3 6h14M3 10h14M3 14h14" />}
            </svg>
            Menu
            {overdue > 0 && !menuOpen && <span className="h-2 w-2 rounded-full bg-red-600" aria-label={`${overdue} overdue reminders`} />}
          </button>
        </div>
        {menuOpen && (
          <div id={menuId} className="max-h-[calc(100vh-3.5rem)] overflow-y-auto border-t border-line bg-white px-3 pb-4 pt-4">
            <nav aria-label="Main">
              <NavLinks pathname={pathname} overdue={overdue} onNavigate={() => setMenuOpen(false)} />
            </nav>
            <div className="mt-6 border-t border-line px-1 pt-4">
              <Account name={user?.name} onLogout={logout} />
            </div>
          </div>
        )}
      </header>

      <main id="content" className="min-w-0 text-ink lg:pl-60">
        {children}
      </main>
    </div>
  );
}
