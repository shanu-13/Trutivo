"use client";

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { getReminderSummary, type ReminderSummary } from '@/lib/api/reminders.api';
import { errorMessage } from '@/lib/format';
import ReminderItem from './ReminderItem';

// In-app reminder delivery on the dashboard (Step 14): overdue reminders first,
// then those due in the next few days. Reading it never changes a reminder.
export default function RemindersPanel() {
  const [summary, setSummary] = useState<ReminderSummary | null>(null);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [error, setError] = useState('');
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let cancelled = false;
    getReminderSummary()
      .then((s) => {
        if (cancelled) return;
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
  }, [reloadKey]);

  const reload = () => setReloadKey((k) => k + 1);
  const c = summary?.counts;

  return (
    <section className="rounded-xl border border-line bg-white p-5 md:p-6 mb-6" aria-labelledby="reminders-panel-title">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 mb-4">
        <div>
          <h2 id="reminders-panel-title" className="text-lg font-semibold">
            Reminders
          </h2>
          {c && (
            <p className="text-sm text-gray-600">
              {c.overdue > 0 && <span className="text-red-700 font-medium">⚠ {c.overdue} overdue · </span>}
              {c.upcomingThisWeek} due in the next {summary!.upcomingWindowDays} days
              {c.mayBeOutdated > 0 && <span className="text-amber-800"> · ⚑ {c.mayBeOutdated} may no longer be relevant</span>}
            </p>
          )}
        </div>
        <div className="flex gap-4 text-sm font-medium">
          <Link href="/dashboard/reminders" className="text-blue-600 hover:text-blue-800">
            All reminders
          </Link>
          <Link href="/dashboard/insights" className="text-blue-600 hover:text-blue-800">
            Application insights
          </Link>
        </div>
      </div>

      {status === 'loading' && <div className="animate-pulse h-20 bg-gray-100 rounded-lg" role="status" aria-label="Loading reminders" />}
      {status === 'error' && (
        <div role="alert" className="space-y-2">
          <p className="text-red-600 whitespace-pre-line">{error}</p>
          <button onClick={() => { setStatus('loading'); reload(); }} className="text-sm bg-gray-200 hover:bg-gray-300 px-3 py-1 rounded">
            Retry
          </button>
        </div>
      )}
      {status === 'ready' && summary && (
        <>
          {summary.overdue.length === 0 && summary.upcoming.length === 0 ? (
            <p className="text-sm text-gray-500 py-4 text-center border border-dashed border-gray-300 rounded-lg">
              Nothing overdue or due in the next {summary.upcomingWindowDays} days.{' '}
              <Link href="/dashboard/reminders/new" className="text-blue-600 hover:text-blue-800 font-medium">
                Create a reminder
              </Link>
            </p>
          ) : (
            <ul className="divide-y divide-gray-100">
              {[...summary.overdue, ...summary.upcoming].map((r) => (
                <ReminderItem key={r.id} reminder={r} onChanged={reload} />
              ))}
            </ul>
          )}
          {c && c.overdue > summary.overdue.length && (
            <p className="text-sm mt-2">
              <Link href="/dashboard/reminders?view=overdue" className="text-blue-600 hover:text-blue-800 font-medium">
                See all {c.overdue} overdue reminders
              </Link>
            </p>
          )}
        </>
      )}
    </section>
  );
}
