"use client";

import { useId, useRef, useState } from 'react';
import { STATUSES, STATUS_INFO, updateApplication, type Application, type ApplicationStatus } from '@/lib/api/applications.api';
import { errorMessage } from '@/lib/format';

interface Props {
  application: Pick<Application, 'id' | 'status' | 'jobTitle' | 'companyName'>;
  onChanged: (updated: Application) => void;
  compact?: boolean;
}

// Quick status change. The server records the change in the history; nothing
// else about the application (such as its application date) is changed.
export default function ApplicationStatusSelect({ application, onChanged, compact = false }: Props) {
  const id = useId();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const savingRef = useRef(false);

  const change = async (status: ApplicationStatus) => {
    if (savingRef.current || status === application.status) return;
    savingRef.current = true;
    setSaving(true);
    setError('');
    try {
      onChanged(await updateApplication(application.id, { status }));
    } catch (err: unknown) {
      setError(errorMessage(err, 'Status could not be changed'));
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  };

  return (
    <div className={compact ? '' : 'space-y-1'}>
      <label htmlFor={id} className="sr-only">
        Status of {application.jobTitle} at {application.companyName}
      </label>
      <select
        id={id}
        value={application.status}
        disabled={saving}
        aria-busy={saving}
        onChange={(e) => change(e.target.value as ApplicationStatus)}
        className="border border-gray-300 rounded-lg px-2 py-1.5 bg-white text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-60 max-w-full"
      >
        {STATUSES.map((s) => (
          <option key={s} value={s}>
            {STATUS_INFO[s].symbol} {STATUS_INFO[s].label}
          </option>
        ))}
      </select>
      {error && (
        <p role="alert" className="text-xs text-red-600">
          {error}
        </p>
      )}
    </div>
  );
}
