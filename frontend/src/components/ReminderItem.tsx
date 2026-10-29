"use client";

import { useRef, useState } from 'react';
import Link from 'next/link';
import {
  OUTDATED_TEXT,
  TYPE_INFO,
  completeReminder,
  deleteReminder,
  dismissReminder,
  reopenReminder,
  type Reminder,
} from '@/lib/api/reminders.api';
import { errorMessage, formatDateTime, formatDue } from '@/lib/format';
import StatusBadge from './StatusBadge';
import ConfirmDialog from './ConfirmDialog';

type Action = 'complete' | 'dismiss' | 'reopen' | 'delete';

// One reminder with its actions. `onChanged` reloads the list it belongs to.
// `showApplication` is off on an application's own page, where the link would point back to itself.
export default function ReminderItem({ reminder: r, onChanged, showApplication = true }: { reminder: Reminder; onChanged: () => void; showApplication?: boolean }) {
  const [busy, setBusy] = useState<Action | null>(null);
  const [error, setError] = useState('');
  const [confirming, setConfirming] = useState(false);
  const busyRef = useRef(false);

  const run = async (action: Action) => {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(action);
    setError('');
    try {
      if (action === 'complete') await completeReminder(r.id);
      else if (action === 'dismiss') await dismissReminder(r.id);
      else if (action === 'reopen') await reopenReminder(r.id);
      else await deleteReminder(r.id);
      setConfirming(false);
      onChanged();
    } catch (err: unknown) {
      setError(errorMessage(err, 'The reminder could not be updated'));
      setConfirming(false);
    } finally {
      busyRef.current = false;
      setBusy(null);
    }
  };

  const button = 'px-3 py-1.5 rounded-lg border text-sm font-medium disabled:opacity-50';
  return (
    <li className={`py-3 flex flex-col md:flex-row md:items-start justify-between gap-3 ${r.overdue ? 'border-l-4 border-l-red-500 pl-3' : ''}`}>
      <div className="min-w-0 space-y-1">
        <div className="flex flex-wrap items-center gap-2">
          <StatusBadge {...TYPE_INFO[r.type]} />
          {r.overdue && <span className="text-xs font-semibold text-red-700">⚠ Overdue</span>}
          {r.status === 'completed' && <span className="text-xs font-semibold text-green-700">✓ Done</span>}
          {r.status === 'dismissed' && <span className="text-xs font-semibold text-gray-600">⊘ Dismissed</span>}
        </div>
        <p className="font-semibold text-gray-900 break-words">{r.title}</p>
        <p className={`text-sm ${r.overdue ? 'text-red-700 font-medium' : 'text-gray-600'}`}>
          {r.overdue ? 'Was due ' : 'Due '}
          {formatDue(r.dueAt, r.timeZone)}
        </p>
        {r.status === 'completed' && r.completedAt && <p className="text-xs text-gray-500">Done {formatDateTime(r.completedAt)}</p>}
        {r.status === 'dismissed' && r.dismissedAt && <p className="text-xs text-gray-500">Dismissed {formatDateTime(r.dismissedAt)}</p>}
        {showApplication && r.application && (
          <p className="text-sm">
            <Link href={`/dashboard/applications/${r.application.id}`} className="text-blue-600 hover:text-blue-800 break-words">
              {r.application.jobTitle} · {r.application.companyName}
            </Link>
          </p>
        )}
        {r.notes && <p className="text-sm text-gray-700 whitespace-pre-wrap break-words">{r.notes}</p>}
        {r.mayBeOutdated && (
          <p className="text-sm text-amber-800 bg-amber-50 border border-amber-200 rounded px-2 py-1">
            <span aria-hidden="true">⚑ </span>
            May no longer be relevant: {OUTDATED_TEXT[r.mayBeOutdated]} Edit or dismiss it if it is not needed.
          </p>
        )}
        {error && (
          <p role="alert" className="text-sm text-red-600">
            {error}
          </p>
        )}
      </div>
      <div className="flex flex-wrap gap-2 shrink-0" aria-label={`Actions for ${r.title}`} role="group">
        {r.status === 'pending' ? (
          <>
            <button onClick={() => run('complete')} disabled={busy !== null} className={`${button} border-green-300 text-green-800 hover:bg-green-50`}>
              {busy === 'complete' ? 'Saving...' : '✓ Mark done'}
            </button>
            <button onClick={() => run('dismiss')} disabled={busy !== null} className={`${button} border-gray-300 text-gray-700 hover:bg-gray-50`}>
              {busy === 'dismiss' ? 'Saving...' : 'Dismiss'}
            </button>
          </>
        ) : (
          <button onClick={() => run('reopen')} disabled={busy !== null} className={`${button} border-gray-300 text-gray-700 hover:bg-gray-50`}>
            {busy === 'reopen' ? 'Saving...' : 'Reopen'}
          </button>
        )}
        <Link href={`/dashboard/reminders/${r.id}/edit`} className={`${button} border-gray-300 text-gray-800 hover:bg-gray-50`}>
          Edit
        </Link>
        <button onClick={() => setConfirming(true)} disabled={busy !== null} className={`${button} border-red-200 text-red-600 hover:bg-red-50`}>
          Delete
        </button>
      </div>
      <ConfirmDialog
        open={confirming}
        title="Delete this reminder?"
        confirmLabel="Delete Reminder"
        busyLabel="Deleting..."
        busy={busy === 'delete'}
        onConfirm={() => run('delete')}
        onCancel={() => setConfirming(false)}
      >
        <p>
          <span className="font-semibold break-words">{r.title}</span> will be permanently deleted. To keep it in your history instead, dismiss it.
        </p>
      </ConfirmDialog>
    </li>
  );
}
