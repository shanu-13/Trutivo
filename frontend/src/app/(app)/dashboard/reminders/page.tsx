"use client";

import { Suspense, useEffect, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useRequireAuth } from '@/hooks/useRequireAuth';
import { getReminderSummary, listReminders, type Reminder, type ReminderSummary, type View } from '@/lib/api/reminders.api';
import { errorMessage } from '@/lib/format';
import ReminderItem from '@/components/ReminderItem';
import ReminderSuggestions from '@/components/ReminderSuggestions';

const PAGE_SIZE = 20;
const TABS: { view: View; label: string; empty: string }[] = [
  { view: 'upcoming', label: 'Upcoming', empty: 'No upcoming reminders.' },
  { view: 'overdue', label: 'Overdue', empty: 'Nothing is overdue.' },
  { view: 'completed', label: 'Done', empty: 'No completed reminders yet.' },
  { view: 'dismissed', label: 'Dismissed', empty: 'No dismissed reminders.' },
];
const isView = (v: string | null): v is View => TABS.some((t) => t.view === v);

// Start and end of local calendar days, as ISO moments for the API.
const dayStart = (d: string) => new Date(`${d}T00:00:00`).toISOString();
const dayEnd = (d: string) => new Date(`${d}T23:59:59.999`).toISOString();

function RemindersContent() {
  const { isAuthenticated, loading } = useRequireAuth();
  const params = useSearchParams();
  const initialView = params.get('view');
  const saved = params.get('saved') === '1';
  const [view, setView] = useState<View>(isView(initialView) ? initialView : 'upcoming');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [applied, setApplied] = useState({ from: '', to: '' });
  const [rangeError, setRangeError] = useState('');
  const [page, setPage] = useState(1);
  const [items, setItems] = useState<Reminder[]>([]);
  const [totalPages, setTotalPages] = useState(0);
  const [total, setTotal] = useState(0);
  const [summary, setSummary] = useState<ReminderSummary | null>(null);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [error, setError] = useState('');
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    if (!isAuthenticated) return;
    let cancelled = false;
    Promise.all([
      listReminders({ view, page, limit: PAGE_SIZE, from: applied.from ? dayStart(applied.from) : undefined, to: applied.to ? dayEnd(applied.to) : undefined }),
      getReminderSummary(),
    ])
      .then(([list, s]) => {
        if (cancelled) return;
        setItems(list.items);
        setTotal(list.pagination.total);
        setTotalPages(list.pagination.totalPages);
        setSummary(s);
        setStatus('ready');
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setError(errorMessage(err, 'Failed to load your reminders'));
        setStatus('error');
      });
    return () => {
      cancelled = true;
    };
  }, [isAuthenticated, view, page, applied, reloadKey]);

  const reload = () => setReloadKey((k) => k + 1);
  const choose = (v: View) => {
    setView(v);
    setPage(1);
    setStatus('loading');
  };
  const applyRange = (e: React.FormEvent) => {
    e.preventDefault();
    if (from && to && from > to) {
      setRangeError('The end date must be on or after the start date.');
      return;
    }
    setRangeError('');
    setPage(1);
    setStatus('loading');
    setApplied({ from, to });
  };
  const clearRange = () => {
    setFrom('');
    setTo('');
    setRangeError('');
    setPage(1);
    setStatus('loading');
    setApplied({ from: '', to: '' });
  };

  if (loading) return <div className="p-8 text-center text-gray-600">Loading...</div>;
  if (!isAuthenticated) return null;

  const counts = summary?.counts;
  const tabCount: Partial<Record<View, number>> = counts ? { overdue: counts.overdue, completed: counts.completed, dismissed: counts.dismissed, upcoming: counts.pending - counts.overdue } : {};
  const filtered = Boolean(applied.from || applied.to);
  const tab = TABS.find((t) => t.view === view)!;

  return (
    <div className="page-container p-4 md:p-8 space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-3xl font-bold">Reminders</h1>
          <p className="text-gray-600">Reminders appear here and on your dashboard. They are not sent by e-mail.</p>
        </div>
        <Link href="/dashboard/reminders/new" className="bg-blue-600 text-white px-4 py-2 rounded-lg font-semibold hover:bg-blue-700 text-center">
          + New Reminder
        </Link>
      </div>

      {saved && (
        <p role="status" className="bg-green-50 text-green-700 p-3 rounded-lg text-sm font-medium border border-green-100">
          Reminder saved.
        </p>
      )}
      {counts && counts.mayBeOutdated > 0 && (
        <p className="bg-amber-50 text-amber-800 p-3 rounded-lg text-sm border border-amber-200">
          <span aria-hidden="true">⚑ </span>
          {counts.mayBeOutdated === 1 ? '1 pending reminder may' : `${counts.mayBeOutdated} pending reminders may`} no longer be relevant because the linked application changed. They are marked below; edit or dismiss them as needed.
        </p>
      )}

      <ReminderSuggestions onAccepted={reload} />

      <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-4 md:p-6 space-y-4">
        <div role="tablist" aria-label="Reminder views" className="flex flex-wrap gap-2">
          {TABS.map((t) => (
            <button
              key={t.view}
              role="tab"
              aria-selected={view === t.view}
              onClick={() => choose(t.view)}
              className={`px-3 py-1.5 rounded-lg text-sm font-medium border ${view === t.view ? 'bg-gray-900 text-white border-gray-900' : 'bg-white text-gray-700 border-gray-300 hover:bg-gray-50'}`}
            >
              {t.view === 'overdue' && <span aria-hidden="true">⚠ </span>}
              {t.label}
              {tabCount[t.view] !== undefined && <span className="ml-1 tabular-nums">({tabCount[t.view]})</span>}
            </button>
          ))}
        </div>

        <form onSubmit={applyRange} className="flex flex-col sm:flex-row sm:items-end gap-3" aria-label="Filter by due date">
          <div>
            <label htmlFor="from" className="block text-xs text-gray-600 mb-1">
              Due from
            </label>
            <input id="from" type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm" />
          </div>
          <div>
            <label htmlFor="to" className="block text-xs text-gray-600 mb-1">
              Due to
            </label>
            <input id="to" type="date" value={to} onChange={(e) => setTo(e.target.value)} aria-invalid={Boolean(rangeError)} className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm" />
          </div>
          <div className="flex gap-2">
            <button type="submit" className="px-4 py-2 rounded-lg bg-gray-200 hover:bg-gray-300 text-sm font-medium">
              Apply
            </button>
            {filtered && (
              <button type="button" onClick={clearRange} className="px-4 py-2 rounded-lg border border-gray-300 hover:bg-gray-50 text-sm font-medium">
                Clear
              </button>
            )}
          </div>
        </form>
        {rangeError && (
          <p role="alert" className="text-sm text-red-600">
            {rangeError}
          </p>
        )}

        <div role="tabpanel" aria-label={tab.label}>
          {status === 'loading' && (
            <div className="animate-pulse space-y-3" role="status" aria-label="Loading reminders">
              {[0, 1, 2].map((i) => (
                <div key={i} className="h-16 bg-gray-100 rounded-lg" />
              ))}
            </div>
          )}
          {status === 'error' && (
            <div role="alert" className="space-y-3">
              <p className="text-red-600 whitespace-pre-line">{error}</p>
              <button onClick={() => { setStatus('loading'); reload(); }} className="text-sm bg-gray-200 hover:bg-gray-300 px-3 py-1.5 rounded">
                Retry
              </button>
            </div>
          )}
          {status === 'ready' && items.length === 0 && (
            <div className="text-center py-8 border border-dashed border-gray-300 rounded-lg">
              <p className="text-gray-700">{filtered ? 'No reminders in this date range.' : tab.empty}</p>
              {view === 'upcoming' && !filtered && (
                <p className="text-sm text-gray-500 mt-1">
                  <Link href="/dashboard/reminders/new" className="text-blue-600 hover:text-blue-800 font-medium">
                    Create a reminder
                  </Link>{' '}
                  or add one from an application’s interview or follow-up date.
                </p>
              )}
            </div>
          )}
          {status === 'ready' && items.length > 0 && (
            <>
              <p className="text-sm text-gray-500 mb-2">
                {total} {total === 1 ? 'reminder' : 'reminders'}
              </p>
              <ul className="divide-y divide-gray-100">
                {items.map((r) => (
                  <ReminderItem key={r.id} reminder={r} onChanged={reload} />
                ))}
              </ul>
            </>
          )}
          {status === 'ready' && totalPages > 1 && (
            <nav className="flex items-center justify-between gap-3 pt-4" aria-label="Pagination">
              <button onClick={() => { setPage((p) => p - 1); setStatus('loading'); }} disabled={page <= 1} className="px-3 py-1.5 rounded-lg border border-gray-300 text-sm disabled:opacity-50">
                ← Previous
              </button>
              <span className="text-sm text-gray-600">
                Page {page} of {totalPages}
              </span>
              <button onClick={() => { setPage((p) => p + 1); setStatus('loading'); }} disabled={page >= totalPages} className="px-3 py-1.5 rounded-lg border border-gray-300 text-sm disabled:opacity-50">
                Next →
              </button>
            </nav>
          )}
        </div>
      </div>
    </div>
  );
}

// useSearchParams (for the view and "saved" notice) must sit inside a Suspense boundary.
export default function Reminders() {
  return (
    <Suspense fallback={<div className="p-8 text-center text-gray-600">Loading...</div>}>
      <RemindersContent />
    </Suspense>
  );
}
