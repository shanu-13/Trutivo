"use client";

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { ApiError } from '@/lib/api/client';
import {
  EMPLOYMENT_TYPES,
  INTERVIEW_TYPES,
  LIMITS,
  STATUSES,
  STATUS_INFO,
  type Application,
  type ApplicationInput,
  type EmploymentType,
  type InterviewType,
} from '@/lib/api/applications.api';
import { getResumeList, type ResumeSummary } from '@/lib/api/resume.api';
import { getJobDescriptionList, type JobDescriptionSummary } from '@/lib/api/jobDescription.api';
import { listCoverLetters, type CoverLetterSummary } from '@/lib/api/coverLetter.api';
import { errorMessage, fromLocalInput, toLocalInput, todayLocal } from '@/lib/format';
import { versionName } from '@/lib/resumeStatus';

type Values = Record<keyof ApplicationInput, string>;
type Errors = Partial<Record<keyof ApplicationInput, string>>;

// The form keeps every field as text; empty means "not set".
const toValues = (a: Partial<ApplicationInput>): Values => ({
  jobTitle: a.jobTitle ?? '',
  companyName: a.companyName ?? '',
  postingUrl: a.postingUrl ?? '',
  status: a.status ?? 'wishlist',
  appliedOn: a.appliedOn ?? '',
  location: a.location ?? '',
  employmentType: a.employmentType ?? '',
  compensationNotes: a.compensationNotes ?? '',
  contactName: a.contactName ?? '',
  contactEmail: a.contactEmail ?? '',
  contactPhone: a.contactPhone ?? '',
  notes: a.notes ?? '',
  interviewAt: a.interviewAt ? toLocalInput(a.interviewAt) : '',
  interviewType: a.interviewType ?? '',
  interviewStage: a.interviewStage ?? '',
  interviewerName: a.interviewerName ?? '',
  interviewNotes: a.interviewNotes ?? '',
  followUpOn: a.followUpOn ?? '',
  followUpNotes: a.followUpNotes ?? '',
  jobDescriptionId: a.jobDescriptionId ?? '',
  resumeId: a.resumeId ?? '',
  coverLetterId: a.coverLetterId ?? '',
});

const toInput = (v: Values): ApplicationInput => {
  const text = (s: string) => (s.trim() ? s.trim() : null);
  return {
    jobTitle: v.jobTitle.trim(),
    companyName: v.companyName.trim(),
    postingUrl: text(v.postingUrl),
    status: v.status as ApplicationInput['status'],
    appliedOn: text(v.appliedOn),
    location: text(v.location),
    employmentType: (text(v.employmentType) as EmploymentType | null) ?? null,
    compensationNotes: text(v.compensationNotes),
    contactName: text(v.contactName),
    contactEmail: text(v.contactEmail),
    contactPhone: text(v.contactPhone),
    notes: text(v.notes),
    interviewAt: v.interviewAt ? fromLocalInput(v.interviewAt) : null,
    interviewType: (text(v.interviewType) as InterviewType | null) ?? null,
    interviewStage: text(v.interviewStage),
    interviewerName: text(v.interviewerName),
    interviewNotes: text(v.interviewNotes),
    followUpOn: text(v.followUpOn),
    followUpNotes: text(v.followUpNotes),
    jobDescriptionId: text(v.jobDescriptionId),
    resumeId: text(v.resumeId),
    coverLetterId: text(v.coverLetterId),
  };
};

// Mirrors the backend rules so most mistakes are shown before sending.
const validate = (v: Values): Errors => {
  const e: Errors = {};
  if (!v.jobTitle.trim()) e.jobTitle = 'Job title is required';
  if (!v.companyName.trim()) e.companyName = 'Company name is required';
  const max: Partial<Record<keyof Values, number>> = {
    jobTitle: LIMITS.title, companyName: LIMITS.company, postingUrl: LIMITS.url, location: LIMITS.location, compensationNotes: LIMITS.compensation,
    contactName: LIMITS.contactName, contactEmail: LIMITS.contactEmail, contactPhone: LIMITS.contactPhone, notes: LIMITS.notes,
    interviewStage: LIMITS.interviewStage, interviewerName: LIMITS.interviewer, interviewNotes: LIMITS.interviewNotes, followUpNotes: LIMITS.followUpNotes,
  };
  for (const [k, n] of Object.entries(max) as [keyof Values, number][]) if (v[k].trim().length > n) e[k] = `Must be at most ${n.toLocaleString()} characters`;
  if (v.postingUrl.trim() && !e.postingUrl) {
    try {
      const u = new URL(v.postingUrl.trim());
      if (u.protocol !== 'http:' && u.protocol !== 'https:') throw new Error();
    } catch {
      e.postingUrl = 'Enter a full web address starting with http:// or https://';
    }
  }
  if (v.contactEmail.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.contactEmail.trim())) e.contactEmail = 'Enter a valid e-mail address';
  if (v.contactPhone.trim() && !(/^[+()\d\s./-]+$/.test(v.contactPhone.trim()) && v.contactPhone.replace(/\D/g, '').length >= 5)) e.contactPhone = 'Use digits, spaces and + ( ) - . / only';
  if (v.appliedOn && v.appliedOn > todayLocal()) e.appliedOn = 'The application date cannot be in the future';
  if (v.interviewAt && Number.isNaN(new Date(v.interviewAt).getTime())) e.interviewAt = 'Enter a valid date and time';
  return e;
};

const inputClass = (error?: string) =>
  `w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 ${error ? 'border-red-400' : 'border-gray-300'}`;

function Field({ id, label, error, hint, children }: { id: string; label: ReactNode; error?: string; hint?: string; children: ReactNode }) {
  return (
    <div>
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

function Section({ title, children, defaultOpen = true }: { title: string; children: ReactNode; defaultOpen?: boolean }) {
  return (
    <details open={defaultOpen} className="bg-white rounded-xl shadow-sm border border-gray-100 p-4 md:p-6 group">
      <summary className="text-lg font-bold text-gray-900 cursor-pointer">{title}</summary>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-4">{children}</div>
    </details>
  );
}

interface Props {
  initial: Partial<Application> | null;
  submitLabel: string;
  onSubmit: (input: ApplicationInput) => Promise<void>;
}

export default function ApplicationForm({ initial, submitLabel, onSubmit }: Props) {
  const [values, setValues] = useState<Values>(() => toValues(initial ?? {}));
  const [errors, setErrors] = useState<Errors>({});
  const [formError, setFormError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const submittingRef = useRef(false);
  const [resumes, setResumes] = useState<ResumeSummary[]>([]);
  const [jobs, setJobs] = useState<JobDescriptionSummary[]>([]);
  const [letters, setLetters] = useState<CoverLetterSummary[]>([]);

  // The user's own records to link; a failure only leaves the lists empty.
  useEffect(() => {
    let cancelled = false;
    Promise.allSettled([getResumeList(), getJobDescriptionList(), listCoverLetters()]).then(([r, j, c]) => {
      if (cancelled) return;
      if (r.status === 'fulfilled') setResumes(r.value);
      if (j.status === 'fulfilled') setJobs(j.value);
      if (c.status === 'fulfilled') setLetters(c.value);
    });
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
      await onSubmit(toInput(values));
    } catch (err: unknown) {
      // Entered values stay as they are; server field messages are shown next to the fields.
      if (err instanceof ApiError && Array.isArray(err.details)) {
        const fieldErrors: Errors = {};
        for (const d of err.details as { field?: string; message?: string }[]) if (d.field && d.message) fieldErrors[d.field as keyof ApplicationInput] ??= d.message;
        setErrors(fieldErrors);
      }
      setFormError(errorMessage(err, 'The application could not be saved'));
      submittingRef.current = false;
      setSubmitting(false);
    }
  };

  const text = (key: keyof Values, label: ReactNode, opts: { type?: string; max?: number; hint?: string; placeholder?: string } = {}) => (
    <Field id={key} label={label} error={errors[key]} hint={opts.hint}>
      <input
        id={key}
        type={opts.type ?? 'text'}
        value={values[key]}
        onChange={set(key)}
        placeholder={opts.placeholder}
        aria-invalid={Boolean(errors[key])}
        aria-describedby={describedBy(key)}
        className={inputClass(errors[key])}
      />
    </Field>
  );
  const area = (key: keyof Values, label: string, rows = 3) => (
    <div className="md:col-span-2">
      <Field id={key} label={label} error={errors[key]}>
        <textarea id={key} value={values[key]} onChange={set(key)} rows={rows} aria-invalid={Boolean(errors[key])} aria-describedby={describedBy(key)} className={inputClass(errors[key])} />
      </Field>
    </div>
  );
  const select = (key: keyof Values, label: string, options: [string, string][], empty: string) => (
    <Field id={key} label={label} error={errors[key]}>
      <select id={key} value={values[key]} onChange={set(key)} aria-invalid={Boolean(errors[key])} aria-describedby={describedBy(key)} className={`${inputClass(errors[key])} bg-white`}>
        <option value="">{empty}</option>
        {options.map(([v, l]) => (
          <option key={v} value={v}>
            {l}
          </option>
        ))}
      </select>
    </Field>
  );
  const required = (label: string) => (
    <>
      {label} <span className="text-red-600" aria-hidden="true">*</span>
      <span className="sr-only"> (required)</span>
    </>
  );

  return (
    <form onSubmit={submit} noValidate className="space-y-4">
      {formError && (
        <p role="alert" className="bg-red-50 text-red-600 p-3 rounded-lg text-sm border border-red-100 whitespace-pre-line">
          {formError}
        </p>
      )}

      <Section title="Job">
        {text('jobTitle', required('Job title'))}
        {text('companyName', required('Company name'))}
        {text('postingUrl', 'Job posting URL', { type: 'url', placeholder: 'https://' })}
        {text('location', 'Location')}
        {select('employmentType', 'Employment type', Object.entries(EMPLOYMENT_TYPES), 'Not specified')}
        {text('compensationNotes', 'Salary or compensation notes')}
      </Section>

      <Section title="Application">
        <Field id="status" label="Status" error={errors.status}>
          <select id="status" value={values.status} onChange={set('status')} className={`${inputClass()} bg-white`}>
            {STATUSES.map((s) => (
              <option key={s} value={s}>
                {STATUS_INFO[s].symbol} {STATUS_INFO[s].label} — {STATUS_INFO[s].description}
              </option>
            ))}
          </select>
        </Field>
        {text('appliedOn', 'Application date', { type: 'date', hint: 'Only the date you actually applied; leave empty if you have not applied yet.' })}
        {select('jobDescriptionId', 'Job description', jobs.map((j) => [j.id, `${j.title}${j.companyName ? ` — ${j.companyName}` : ''}`]), 'None')}
        {select('resumeId', 'Resume version used', resumes.map((r) => [r.id, `${r.originalFilename} (${versionName(r)})`]), 'None')}
        {select('coverLetterId', 'Cover letter', letters.map((l) => [l.id, l.title]), 'None')}
      </Section>

      <Section title="Contact" defaultOpen={Boolean(values.contactName || values.contactEmail || values.contactPhone)}>
        {text('contactName', 'Contact or recruiter name')}
        {text('contactEmail', 'Contact e-mail', { type: 'email' })}
        {text('contactPhone', 'Contact phone', { type: 'tel' })}
      </Section>

      <Section title="Interview" defaultOpen={Boolean(values.interviewAt || values.interviewStage)}>
        {text('interviewAt', 'Interview date and time', { type: 'datetime-local', hint: 'In your local time.' })}
        {select('interviewType', 'Interview type', Object.entries(INTERVIEW_TYPES), 'Not specified')}
        {text('interviewStage', 'Interview stage', { placeholder: 'e.g. Technical round' })}
        {text('interviewerName', 'Interviewer name')}
        {area('interviewNotes', 'Preparation notes')}
      </Section>

      <Section title="Follow-up" defaultOpen={Boolean(values.followUpOn)}>
        {text('followUpOn', 'Follow-up date', { type: 'date' })}
        {area('followUpNotes', 'Follow-up notes', 2)}
      </Section>

      <Section title="Notes" defaultOpen={Boolean(values.notes)}>
        {area('notes', 'General notes', 4)}
      </Section>

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
