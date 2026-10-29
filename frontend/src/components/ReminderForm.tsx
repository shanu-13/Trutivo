"use client";

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { ApiError } from '@/lib/api/client';
import { LIMITS, REMINDER_TYPES, TYPE_INFO, type Reminder, type ReminderInput, type ReminderType } from '@/lib/api/reminders.api';
import { listApplications, type Application } from '@/lib/api/applications.api';
import { browserTimeZone, errorMessage, timeZoneOptions } from '@/lib/format';

interface Values {
  type: ReminderType;
  title: string;
  notes: string;
  date: string;
  time: string;
  timeZone: string;
  applicationId: string;
}
type Errors = Partial<Record<keyof Values, string>>;

const toValues = (r: Partial<Reminder> & { applicationId?: string | null }): Values => ({
  type: r.type ?? 'custom',
  title: r.title ?? '',
  notes: r.notes ?? '',
  date: r.dueLocal?.slice(0, 10) ?? '',
  time: r.dueLocal?.slice(11, 16) ?? '09:00',
  // A saved reminder keeps its own time zone; a new one starts with the viewer's.
  timeZone: r.timeZone ?? browserTimeZone(),
  applicationId: r.application?.id ?? r.applicationId ?? '',
});

const validate = (v: Values): Errors => {
  const e: Errors = {};
  if (!v.title.trim()) e.title = 'Title is required';
  else if (v.title.trim().length > LIMITS.title) e.title = `Must be at most ${LIMITS.title} characters`;
  if (v.notes.trim().length > LIMITS.notes) e.notes = `Must be at most ${LIMITS.notes.toLocaleString()} characters`;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v.date)) e.date = 'Choose a date';
  if (!/^\d{2}:\d{2}$/.test(v.time)) e.time = 'Choose a time';
  if (!v.timeZone) e.timeZone = 'Choose a time zone';
  return e;
};

const inputClass = (error?: string) =>
  `w-full border rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500 ${error ? 'border-red-400' : 'border-gray-300'}`;

function Field({ id, label, error, hint, children, wide }: { id: string; label: string; error?: string; hint?: string; children: ReactNode; wide?: boolean }) {
  return (
    <div className={wide ? 'md:col-span-2' : undefined}>
      <label htmlFor={id} className="block text-sm font-medium text-gray-800 mb-1">
        {label}
      </label>
      {children}
      {error ? (
        <p id={`${id}-error`} className="text-xs text-red-600 mt-1">
          {error}
        </p>
      ) : (
        hint && <p className="text-xs text-gray-500 mt-1">{hint}</p>
      )}
    </div>
  );
}

interface Props {
  initial: (Partial<Reminder> & { applicationId?: string | null }) | null;
  submitLabel: string;
  onSubmit: (input: ReminderInput) => Promise<void>;
}

export default function ReminderForm({ initial, submitLabel, onSubmit }: Props) {
  const [values, setValues] = useState<Values>(() => toValues(initial ?? {}));
  const [errors, setErrors] = useState<Errors>({});
  const [formError, setFormError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const submittingRef = useRef(false);
  const [applications, setApplications] = useState<Application[]>([]);
  const [zones] = useState(() => timeZoneOptions(initial?.timeZone));

  // The user's own applications to link; a failure only leaves the list empty.
  useEffect(() => {
    let cancelled = false;
    listApplications({ status: '', company: '', title: '', appliedFrom: '', appliedTo: '', sort: 'updated' }, 1, 100)
      .then((data) => {
        if (!cancelled) setApplications(data.items);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  const set = (key: keyof Values) => (e: { target: { value: string } }) => setValues((v) => ({ ...v, [key]: e.target.value }));
  const describedBy = (key: keyof Values) => (errors[key] ? `${key}-error` : undefined);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (submittingRef.current) return;
    const found = validate(values);
    setErrors(found);
    setFormError('');
    if (Object.keys(found).length) {
      setFormError('Please correct the highlighted fields.');
      return;
    }
    submittingRef.current = true;
    setSubmitting(true);
    try {
      await onSubmit({
        type: values.type,
        title: values.title.trim(),
        notes: values.notes.trim() || null,
        dueLocal: `${values.date}T${values.time}`,
        timeZone: values.timeZone,
        applicationId: values.applicationId || null,
      });
    } catch (err: unknown) {
      // Entered values stay as they are; server field messages are shown next to the fields.
      if (err instanceof ApiError && Array.isArray(err.details)) {
        const fieldErrors: Errors = {};
        for (const d of err.details as { field?: string; message?: string }[]) {
          if (!d.field || !d.message) continue;
          const field = (d.field === 'dueLocal' ? 'date' : d.field) as keyof Values;
          fieldErrors[field] ??= d.message;
        }
        setErrors(fieldErrors);
      }
      setFormError(errorMessage(err, 'The reminder could not be saved'));
      submittingRef.current = false;
      setSubmitting(false);
    }
  };

  // A linked application missing from the first page of the list (or deleted) still shows as selected.
  const linked = initial?.application;
  const options = linked && !applications.some((a) => a.id === linked.id) ? [{ id: linked.id, jobTitle: linked.jobTitle, companyName: linked.companyName }, ...applications] : applications;

  return (
    <form onSubmit={submit} noValidate className="bg-white rounded-xl shadow-sm border border-gray-100 p-4 md:p-6 space-y-4">
      {formError && (
        <p role="alert" className="bg-red-50 text-red-600 p-3 rounded-lg text-sm border border-red-100 whitespace-pre-line">
          {formError}
        </p>
      )}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Field id="title" label="Title *" error={errors.title} wide>
          <input id="title" value={values.title} onChange={set('title')} aria-invalid={Boolean(errors.title)} aria-describedby={describedBy('title')} className={inputClass(errors.title)} />
        </Field>
        <Field id="type" label="Type" error={errors.type}>
          <select id="type" value={values.type} onChange={set('type')} className={inputClass(errors.type)}>
            {REMINDER_TYPES.map((t) => (
              <option key={t} value={t}>
                {TYPE_INFO[t].label}
              </option>
            ))}
          </select>
        </Field>
        <Field id="applicationId" label="Application" error={errors.applicationId} hint="Optional. Leave empty for a standalone reminder.">
          <select id="applicationId" value={values.applicationId} onChange={set('applicationId')} aria-invalid={Boolean(errors.applicationId)} aria-describedby={describedBy('applicationId')} className={inputClass(errors.applicationId)}>
            <option value="">No application</option>
            {options.map((a) => (
              <option key={a.id} value={a.id}>
                {a.jobTitle} · {a.companyName}
              </option>
            ))}
          </select>
        </Field>
        <Field id="date" label="Due date *" error={errors.date}>
          <input id="date" type="date" value={values.date} onChange={set('date')} aria-invalid={Boolean(errors.date)} aria-describedby={describedBy('date')} className={inputClass(errors.date)} />
        </Field>
        <Field id="time" label="Due time *" error={errors.time}>
          <input id="time" type="time" value={values.time} onChange={set('time')} aria-invalid={Boolean(errors.time)} aria-describedby={describedBy('time')} className={inputClass(errors.time)} />
        </Field>
        <Field id="timeZone" label="Time zone *" error={errors.timeZone} hint={`The date and time above are in this zone. Yours is ${browserTimeZone().replace(/_/g, ' ')}.`} wide>
          <select id="timeZone" value={values.timeZone} onChange={set('timeZone')} aria-invalid={Boolean(errors.timeZone)} aria-describedby={describedBy('timeZone')} className={inputClass(errors.timeZone)}>
            {zones.map((z) => (
              <option key={z} value={z}>
                {z.replace(/_/g, ' ')}
              </option>
            ))}
          </select>
        </Field>
        <Field id="notes" label="Notes" error={errors.notes} wide>
          <textarea id="notes" rows={3} value={values.notes} onChange={set('notes')} aria-invalid={Boolean(errors.notes)} aria-describedby={describedBy('notes')} className={inputClass(errors.notes)} />
        </Field>
      </div>
      <button
        type="submit"
        disabled={submitting}
        aria-busy={submitting}
        className="w-full sm:w-auto bg-blue-600 text-white px-6 py-3 rounded-lg font-semibold hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition"
      >
        {submitting ? 'Saving...' : submitLabel}
      </button>
    </form>
  );
}
