"use client";

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { acceptSuggestion, getSuggestions, type Suggestion } from '@/lib/api/reminders.api';
import { browserTimeZone, errorMessage, formatDateTime, formatDay } from '@/lib/format';

const LEAD_LABELS: Record<number, string> = { 0: 'At the interview time', 60: '1 hour before', 180: '3 hours before', 1440: '1 day before', 2880: '2 days before' };
const key = (s: Suggestion) => `${s.applicationId}:${s.kind}`;

// The longest offered lead time that is still ahead, so the default never lands in the past.
const defaultLead = (eventAt: string, leads: number[]) => {
  const ahead = leads.filter((m) => Date.parse(eventAt) - m * 60_000 > Date.now());
  return ahead.includes(1440) ? 1440 : (ahead[ahead.length - 1] ?? 0);
};

// Reminders suggested from dates already on the user's applications. Nothing is
// saved until the user confirms one, and confirming twice saves it once.
export default function ReminderSuggestions({ applicationId, onAccepted, showApplication = true }: { applicationId?: string; onAccepted: () => void; showApplication?: boolean }) {
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [leads, setLeads] = useState<number[]>([]);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [reloadKey, setReloadKey] = useState(0);
  const [choice, setChoice] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [notice, setNotice] = useState('');
  const savingRef = useRef(false);
  const timeZone = browserTimeZone();

  useEffect(() => {
    let cancelled = false;
    getSuggestions(applicationId)
      .then((data) => {
        if (cancelled) return;
        setSuggestions(data.suggestions);
        setLeads(data.interviewLeadMinutes);
        setStatus('ready');
      })
      .catch(() => {
        if (!cancelled) setStatus('error');
      });
    return () => {
      cancelled = true;
    };
  }, [applicationId, reloadKey]);

  const value = (s: Suggestion) => choice[key(s)] ?? (s.kind === 'interview' ? String(defaultLead(s.eventAt, leads)) : '09:00');

  const accept = async (s: Suggestion) => {
    if (savingRef.current) return;
    savingRef.current = true;
    setSaving(key(s));
    setErrors((e) => ({ ...e, [key(s)]: '' }));
    try {
      const v = value(s);
      const result = await acceptSuggestion(s.kind === 'interview' ? { applicationId: s.applicationId, kind: s.kind, timeZone, leadMinutes: Number(v) } : { applicationId: s.applicationId, kind: s.kind, timeZone, time: v });
      setNotice(result.created ? `Reminder added: ${result.reminder.title}` : 'A reminder for this date already existed, so nothing new was added.');
      setReloadKey((k) => k + 1);
      onAccepted();
    } catch (err: unknown) {
      setErrors((e) => ({ ...e, [key(s)]: errorMessage(err, 'The reminder could not be added') }));
    } finally {
      savingRef.current = false;
      setSaving(null);
    }
  };

  // Suggestions are optional help: on failure they are simply left out, with a quiet note.
  if (status === 'loading') return null;
  if (status === 'error') {
    return (
      <p className="text-sm text-gray-500">
        Suggested reminders could not be loaded.{' '}
        <button onClick={() => { setStatus('loading'); setReloadKey((k) => k + 1); }} className="text-blue-600 hover:text-blue-800 font-medium">
          Retry
        </button>
      </p>
    );
  }
  if (suggestions.length === 0) {
    return notice ? <p role="status" className="text-sm text-green-700">{notice}</p> : null;
  }

  return (
    <section aria-labelledby="suggestions-title" className="border border-blue-100 bg-blue-50/50 rounded-lg p-4 space-y-3">
      <div>
        <h3 id="suggestions-title" className="font-semibold text-gray-900">
          Suggested reminders
        </h3>
        <p className="text-sm text-gray-600">
          Based on interview and follow-up dates you entered. Nothing is added until you choose “Add reminder”. Times are in your time zone ({timeZone.replace(/_/g, ' ')}).
        </p>
      </div>
      {notice && (
        <p role="status" className="text-sm text-green-700">
          {notice}
        </p>
      )}
      <ul className="divide-y divide-blue-100">
        {suggestions.map((s) => {
          const id = `suggestion-${key(s)}`;
          return (
            <li key={key(s)} className="py-3 flex flex-col md:flex-row md:items-end justify-between gap-3">
              <div className="min-w-0">
                <p className="font-medium text-gray-900 break-words">{s.kind === 'interview' ? `Interview on ${formatDateTime(s.eventAt)}` : `Follow-up on ${formatDay(s.eventAt)}`}</p>
                {showApplication && (
                  <Link href={`/dashboard/applications/${s.applicationId}`} className="text-sm text-blue-600 hover:text-blue-800 break-words">
                    {s.jobTitle} · {s.companyName}
                  </Link>
                )}
                {errors[key(s)] && (
                  <p role="alert" className="text-sm text-red-600 mt-1">
                    {errors[key(s)]}
                  </p>
                )}
              </div>
              <div className="flex flex-wrap items-end gap-2">
                <div>
                  <label htmlFor={id} className="block text-xs text-gray-600 mb-1">
                    {s.kind === 'interview' ? 'Remind me' : 'Time on that day'}
                  </label>
                  {s.kind === 'interview' ? (
                    <select id={id} value={value(s)} onChange={(e) => setChoice((c) => ({ ...c, [key(s)]: e.target.value }))} className="border border-gray-300 rounded-lg px-2 py-1.5 text-sm bg-white">
                      {leads.map((m) => (
                        <option key={m} value={m} disabled={Date.parse(s.eventAt) - m * 60_000 <= Date.now()}>
                          {LEAD_LABELS[m] ?? `${m} minutes before`}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <input id={id} type="time" value={value(s)} onChange={(e) => setChoice((c) => ({ ...c, [key(s)]: e.target.value }))} className="border border-gray-300 rounded-lg px-2 py-1.5 text-sm bg-white" />
                  )}
                </div>
                <button
                  onClick={() => accept(s)}
                  disabled={saving !== null || !value(s)}
                  className="px-3 py-1.5 rounded-lg bg-blue-600 text-white text-sm font-medium hover:bg-blue-700 disabled:opacity-50"
                >
                  {saving === key(s) ? 'Adding...' : 'Add reminder'}
                </button>
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
