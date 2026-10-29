"use client";

import { useEffect, type ReactNode } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';

// The public landing page lives here; "/" redirects to it (next.config.ts).
export const LANDING_PATH = '/trutivo';

const scrollToSection = (id: string) => {
  const smooth = !window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  document.getElementById(id)?.scrollIntoView({ behavior: smooth ? 'smooth' : 'auto', block: 'start' });
};

// A link to a landing-page section that keeps the address bar clean
// (/trutivo, not /trutivo#faq). On the landing page it just scrolls; from
// other pages it opens the landing page, which then scrolls (see below).
export default function SectionLink({ section, className, children, onNavigate }: { section: string; className?: string; children: ReactNode; onNavigate?: () => void }) {
  const pathname = usePathname();
  return (
    <Link
      href={`${LANDING_PATH}#${section}`}
      className={className}
      onClick={(e) => {
        onNavigate?.();
        if (pathname !== LANDING_PATH) return;
        e.preventDefault();
        // Next frame, after anything onNavigate changed (e.g. a closing menu) has re-rendered,
        // so the section's position is measured on the final layout.
        requestAnimationFrame(() => requestAnimationFrame(() => scrollToSection(section)));
      }}
    >
      {children}
    </Link>
  );
}

// On the landing page: opening or reloading it starts at the hero; arriving
// with #section (from another page or a pasted link) scrolls there and then
// removes the hash from the address bar.
export function ScrollToSectionOnLoad() {
  const router = useRouter();
  useEffect(() => {
    // The browser would otherwise put a reloaded page back where it was scrolled to.
    const previous = window.history.scrollRestoration;
    window.history.scrollRestoration = 'manual';
    if (!window.location.hash) window.scrollTo(0, 0);

    let timer = 0;
    const handle = () => {
      const id = decodeURIComponent(window.location.hash.slice(1));
      if (!id) return;
      // After the page has laid out, so the position is right. The hash is removed
      // through Next's router: it would otherwise restore the original URL.
      window.clearTimeout(timer);
      timer = window.setTimeout(() => {
        scrollToSection(id);
        router.replace(LANDING_PATH, { scroll: false });
      }, 50);
    };
    handle();
    // Also when a #section address is opened while already on this page.
    window.addEventListener('hashchange', handle);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener('hashchange', handle);
      // Other pages keep the browser's normal behaviour.
      window.history.scrollRestoration = previous;
    };
  }, [router]);
  return null;
}
