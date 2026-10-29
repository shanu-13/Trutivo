"use client";

import { useEffect, useId, useState } from 'react';
import Link from 'next/link';
import { useAuth } from '@/context/AuthContext';
import BrandLogo from '../BrandLogo';
import SectionLink, { LANDING_PATH } from './SectionLink';

const LINKS = [
  { section: 'features', label: 'Features' },
  { section: 'how-it-works', label: 'How it works' },
  { section: 'faq', label: 'FAQ' },
];

// Public website header. Signed-in visitors get a link back to their dashboard;
// nothing about the account is shown here.
export default function SiteHeader() {
  const { isAuthenticated, loading } = useAuth();
  const [open, setOpen] = useState(false);
  const menuId = useId();

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  const actions = loading ? null : isAuthenticated ? (
    <Link href="/dashboard" className="rounded-full bg-accent px-5 py-2.5 text-sm font-semibold text-ink hover:bg-blue-400">
      Go to dashboard
    </Link>
  ) : (
    <>
      <Link href="/login" className="rounded-full px-4 py-2.5 text-sm font-medium text-slate-700 hover:text-ink">
        Log in
      </Link>
      <Link href="/signup" className="rounded-full bg-accent px-5 py-2.5 text-sm font-semibold text-ink hover:bg-blue-400">
        Get started
      </Link>
    </>
  );

  return (
    <header className="sticky top-0 z-40 border-b border-line bg-canvas">
      <div className="mx-auto flex h-16 max-w-[90%] items-center justify-between gap-6 px-4 md:h-[72px] md:px-8">
        <Link href={LANDING_PATH} aria-label="Trutivo home" className="shrink-0">
          <BrandLogo className="h-8 w-auto md:h-9" priority />
        </Link>
        <nav aria-label="Website" className="hidden items-center gap-8 md:flex">
          {LINKS.map((l) => (
            <SectionLink key={l.section} section={l.section} className="text-sm font-medium text-slate-600 hover:text-ink">
              {l.label}
            </SectionLink>
          ))}
        </nav>
        <div className="hidden items-center gap-2 md:flex">{actions}</div>
        <button
          onClick={() => setOpen((o) => !o)}
          aria-expanded={open}
          aria-controls={menuId}
          className="inline-flex items-center gap-2 rounded-md border border-slate-200 bg-white px-3 py-1.5 text-sm font-medium text-ink md:hidden"
        >
          <svg aria-hidden="true" viewBox="0 0 20 20" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round">
            {open ? <path d="M5 5l10 10M15 5L5 15" /> : <path d="M3 6h14M3 10h14M3 14h14" />}
          </svg>
          Menu
        </button>
      </div>
      {open && (
        <div id={menuId} className="border-t border-line bg-white px-4 pb-5 pt-3 md:hidden">
          <nav aria-label="Website" className="flex flex-col">
            {LINKS.map((l) => (
              <SectionLink key={l.section} section={l.section} onNavigate={() => setOpen(false)} className="rounded-md px-2 py-2.5 text-sm font-medium text-slate-700 hover:bg-slate-50">
                {l.label}
              </SectionLink>
            ))}
          </nav>
          <div className="mt-3 flex items-center gap-2 border-t border-line pt-4">{actions}</div>
        </div>
      )}
    </header>
  );
}
