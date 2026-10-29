"use client";

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useRequireAuth } from '@/hooks/useRequireAuth';
import { ApiError } from '@/lib/api/client';
import { OUTDATED_TEXT, getReminder, updateReminder, type Reminder } from '@/lib/api/reminders.api';
import { errorMessage } from '@/lib/format';
import ReminderForm from '@/components/ReminderForm';

export default function EditReminder() {
  const { isAuthenticated, loading } = useRequireAuth();
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [reminder, setReminder] = useState<Reminder | null>(null);
  const [status, setStatus] = useState<'loading' | 'ready' | 'not_found' | 'error'>('loading');
  const [error, setError] = useState('');
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    if (!isAuthenticated || !id) return;
    let cancelled = false;
    getReminder(id)
      .then((r) => {
        if (cancelled) return;
        setReminder(r);
        setStatus('ready');
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        if (err instanceof ApiError && (err.status === 404 || err.status === 400)) setStatus('not_found');
        else {
          setError(errorMessage(err, 'Failed to load the reminder'));
          setStatus('error');
        }
      });
    return () => {
      cancelled = true;
    };
  }, [isAuthenticated, id, reloadKey]);

  if (loading) return <div className="p-8 text-center text-gray-600">Loading...</div>;
  if (!isAuthenticated) return null;

  return (
    <div className="page-container p-4 md:p-8 space-y-4">
      <Link href="/dashboard/reminders" className="text-gray-500 hover:text-gray-800 text-sm">
        ← Back to Reminders
      </Link>
      <h1 className="text-3xl font-bold">Edit Reminder</h1>
      {status === 'loading' && <div className="animate-pulse h-64 bg-gray-100 rounded-xl" role="status" aria-label="Loading reminder" />}
      {status === 'not_found' && (
        <p role="alert" className="text-gray-700 text-lg">
          Reminder not found.
        </p>
      )}
      {status === 'error' && (
        <div role="alert" className="space-y-3">
          <p className="text-red-600 whitespace-pre-line">{error}</p>
          <button onClick={() => { setStatus('loading'); setReloadKey((k) => k + 1); }} className="text-sm bg-gray-200 hover:bg-gray-300 px-3 py-1.5 rounded">
            Retry
          </button>
        </div>
      )}
      {status === 'ready' && reminder && (
        <>
          {reminder.mayBeOutdated && (
            <p className="bg-amber-50 text-amber-800 p-3 rounded-lg text-sm border border-amber-200">
              <span aria-hidden="true">⚑ </span>
              {OUTDATED_TEXT[reminder.mayBeOutdated]}
            </p>
          )}
          {reminder.status !== 'pending' && (
            <p className="text-sm text-gray-600">This reminder is {reminder.status === 'completed' ? 'done' : 'dismissed'}. Saving changes keeps that status; use Reopen on the list to make it pending again.</p>
          )}
          <ReminderForm
            initial={reminder}
            submitLabel="Save Changes"
            onSubmit={async (input) => {
              await updateReminder(reminder.id, input);
              router.push('/dashboard/reminders?saved=1');
            }}
          />
        </>
      )}
    </div>
  );
}
