import Link from 'next/link';
import SiteHeader from '@/components/site/SiteHeader';
import SiteFooter from '@/components/site/SiteFooter';

export const metadata = { title: 'Page not found' };

// Branded 404 (Next's built-in page switches to a dark theme that does not suit the app).
// It sits outside the route groups, so it brings the public header and footer itself.
export default function NotFound() {
  return (
    <div className="flex min-h-screen flex-col bg-canvas">
      <SiteHeader />
      <main className="flex-1 text-ink">
        <div className="mx-auto max-w-xl px-4 py-20 md:py-28">
          <p className="text-sm font-semibold text-blue-600">404</p>
          <h1 className="mt-2 text-3xl font-semibold">Page not found</h1>
          <p className="mt-3 text-slate-600">The page you are looking for does not exist or has moved.</p>
          <div className="mt-8 flex flex-wrap gap-3">
            <Link href="/dashboard" className="rounded-md bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700">
              Go to the dashboard
            </Link>
            <Link href="/trutivo" className="rounded-md border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-ink hover:bg-slate-50">
              Home
            </Link>
          </div>
        </div>
      </main>
      <SiteFooter />
    </div>
  );
}
