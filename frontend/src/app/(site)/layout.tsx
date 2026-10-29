import SiteHeader from '@/components/site/SiteHeader';
import SiteFooter from '@/components/site/SiteFooter';

// Public website: landing page, log in and sign up. Never requires an account
// and never shows the application sidebar or account data.
export default function SiteLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col bg-canvas">
      <a href="#content" className="sr-only focus:not-sr-only focus:fixed focus:left-3 focus:top-3 focus:z-50 focus:rounded-md focus:bg-white focus:px-3 focus:py-2 focus:text-sm focus:font-medium focus:text-ink focus:shadow">
        Skip to content
      </a>
      <SiteHeader />
      <main id="content" className="flex-1 text-ink">
        {children}
      </main>
      <SiteFooter />
    </div>
  );
}
