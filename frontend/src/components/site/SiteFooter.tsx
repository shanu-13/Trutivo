import Link from 'next/link';
import BrandLogo from '../BrandLogo';
import SectionLink from './SectionLink';

// Public website footer. Light, because the logo is navy on transparent and
// must not be recoloured. Only pages that exist are linked.
export default function SiteFooter() {
  return (
    <footer className="border-t border-line bg-white">
      <div className="mx-auto grid max-w-[90%] gap-10 px-4 py-12 md:grid-cols-[1fr_auto_auto] md:gap-16 md:px-8">
        <div>
          <BrandLogo className="h-8 w-auto" />
          <p className="mt-3 max-w-xs text-sm text-slate-600">One resume. A tailored version for every role you target.</p>
        </div>
        <nav aria-label="Product">
          <p className="text-sm font-semibold text-ink">Product</p>
          <ul className="mt-3 space-y-2 text-sm">
            <li><SectionLink section="features" className="text-slate-600 no-underline hover:text-ink">Features</SectionLink></li>
            <li><SectionLink section="how-it-works" className="text-slate-600 no-underline hover:text-ink">How it works</SectionLink></li>
            <li><SectionLink section="faq" className="text-slate-600 no-underline hover:text-ink">FAQ</SectionLink></li>
          </ul>
        </nav>
        <nav aria-label="Account">
          <p className="text-sm font-semibold text-ink">Account</p>
          <ul className="mt-3 space-y-2 text-sm">
            <li><Link href="/signup" className="text-slate-600 no-underline hover:text-ink">Get started</Link></li>
            <li><Link href="/login" className="text-slate-600 no-underline hover:text-ink">Log in</Link></li>
          </ul>
        </nav>
      </div>
      <div className="border-t border-line">
        <p className="mx-auto max-w-6xl px-4 py-5 text-xs text-slate-500 md:px-8">© {new Date().getFullYear()} Trutivo</p>
      </div>
    </footer>
  );
}
