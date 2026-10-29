import type { ReactNode } from 'react';

// Frame for the sign-in and sign-up pages.
export default function AuthLayout({ title, subtitle, children, footer }: { title: string; subtitle: string; children: ReactNode; footer: ReactNode }) {
  return (
    <div className="flex justify-center px-4 py-14 md:py-20">
      <div className="w-full max-w-sm">
        <h1 className="text-2xl font-semibold">{title}</h1>
        <p className="mt-1 text-sm text-slate-600">{subtitle}</p>
        <div className="mt-6 rounded-lg border border-line bg-white p-6 shadow-sm">{children}</div>
        <p className="mt-6 text-center text-sm text-slate-600">{footer}</p>
      </div>
    </div>
  );
}

// Shared input styling for the auth forms.
export const authInput =
  'block w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-ink placeholder:text-slate-400 focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/30';
export const authLabel = 'block text-sm font-medium text-slate-700 mb-1.5';
export const authButton =
  'w-full rounded-md bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-60';
