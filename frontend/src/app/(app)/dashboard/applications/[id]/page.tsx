"use client";

import { Suspense, useEffect, useRef, useState, type ReactNode } from 'react';
import Link from 'next/link';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import { useRequireAuth } from '@/hooks/useRequireAuth';
import { ApiError } from '@/lib/api/client';
import {
  EMPLOYMENT_TYPES,
  INTERVIEW_TYPES,
  STATUS_INFO,
  deleteApplication,
  getApplication,
  type Application,
  type HistoryEvent,
} from '@/lib/api/applications.api';
import { errorMessage, formatDateTime, formatDay } from '@/lib/format';
import { versionName } from '@/lib/resumeStatus';
import StatusBadge from '@/components/StatusBadge';
import ApplicationStatusSelect from '@/components/ApplicationStatusSelect';
import ConfirmDialog from '@/components/ConfirmDialog';
import ReminderItem from '@/components/ReminderItem';
import ReminderSuggestions from '@/components/ReminderSuggestions';
import { listReminders, type Reminder } from '@/lib/api/reminders.api';

const FIELD_LABELS: Record<string, string> = {
  jobTitle: 'job title', companyName: 'company', postingUrl: 'posting URL', appliedOn: 'application date', location: 'location',
  employmentType: 'employment type', compensationNotes: 'compensation notes', contactName: 'contact name', contactEmail: 'contact e-mail',
  contactPhone: 'contact phone', notes: 'notes', interviewNotes: 'interview notes', followUpNotes: 'follow-up notes',
  jobDescriptionId: 'linked job description', resumeId: 'linked resume', coverLetterId: 'linked cover letter',
};

const describe = (e: HistoryEvent): string => {
  const d = e.details ?? {};
  const interview = () =>
    [d.interviewAt ? formatDateTime(d.interviewAt) : null, d.interviewType ? INTERVIEW_TYPES[d.interviewType] : null, d.interviewStage].filter(Boolean).join(' · ');
  switch (e.type) {
    case 'created':
      return `Added to the tracker as ${STATUS_INFO[e.toStatus ?? 'wishlist'].label}`;
    case 'status_changed':
      if (e.toStatus === 'offer') return `Offer recorded (was ${STATUS_INFO[e.fromStatus!].label})`;
      if (e.toStatus === 'withdrawn') return `Withdrawn (was ${STATUS_INFO[e.fromStatus!].label})`;
      return `Status changed from ${STATUS_INFO[e.fromStatus!].label} to ${STATUS_INFO[e.toStatus!].label}`;
    case 'interview_scheduled':
      return `Interview scheduled: ${interview()}`;
    case 'interview_updated':
      return `Interview updated: ${interview() || 'details changed'}`;
    case 'interview_cleared':
      return 'Interview removed';
    case 'follow_up_set':
      return `Follow-up set for ${d.followUpOn ? formatDay(d.followUpOn) : 'a date'}`;
    case 'follow_up_cleared':
      return 'Follow-up removed';
    case 'details_updated':
      return `Edited: ${(d.fields ?? []).map((f) => FIELD_LABELS[f] ?? f).join(', ')}`;
  }
};

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <>
      <dt className="text-sm text-gray-500">{label}</dt>
      <dd className="text-sm text-gray-900 break-words whitespace-pre-wrap">{children}</dd>
    </>
  );
}

function Card({ title, children, action }: { title: string; children: ReactNode; action?: ReactNode }) {
  return (
    <section className="bg-white rounded-xl shadow-sm border border-gray-100 p-4 md:p-6" aria-labelledby={`card-${title}`}>
      <div className="flex items-center justify-between gap-3 mb-3">
        <h2 id={`card-${title}`} className="text-lg font-bold text-gray-900">
          {title}
        </h2>
        {action}
      </div>
      {children}
    </section>
  );
}

// This application's reminders (pending first, then done) and suggestions from its own dates (Step 14).
function ApplicationReminders({ applicationId, reloadKey }: { applicationId: string; reloadKey: number }) {
  const [items, setItems] = useState<Reminder[]>([]);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [ownKey, setOwnKey] = useState(0);

  useEffect(() => {
    let cancelled = false;
    Promise.all([listReminders({ view: 'pending', applicationId, limit: 100 }), listReminders({ view: 'all', applicationId, limit: 100 })])
      .then(([pending, all]) => {
        if (cancelled) return;
        setItems([...pending.items, ...all.items.filter((r) => r.status !== 'pending')]);
        setStatus('ready');
      })
      .catch(() => {
        if (!cancelled) setStatus('error');
      });
    return () => {
      cancelled = true;
    };
  }, [applicationId, reloadKey, ownKey]);

  const reload = () => setOwnKey((k) => k + 1);
  return (
    <Card
      title="Reminders"
      action={
        <Link href={`/dashboard/reminders/new?applicationId=${applicationId}`} className="text-sm font-medium text-blue-600 hover:text-blue-800 whitespace-nowrap">
          + Add reminder
        </Link>
      }
    >
      <div className="space-y-3">
        {/* Remounted when the application changes, e.g. a new status ends its suggestions. */}
        <ReminderSuggestions key={reloadKey} applicationId={applicationId} onAccepted={reload} showApplication={false} />
        {status === 'loading' && <div className="animate-pulse h-12 bg-gray-100 rounded-lg" role="status" aria-label="Loading reminders" />}
        {status === 'error' && (
          <p role="alert" className="text-sm text-red-600">
            Reminders could not be loaded.{' '}
            <button onClick={() => { setStatus('loading'); reload(); }} className="font-medium underline">
              Retry
            </button>
          </p>
        )}
        {status === 'ready' && items.length === 0 && <p className="text-sm text-gray-500">No reminders for this application.</p>}
        {status === 'ready' && items.length > 0 && (
          <ul className="divide-y divide-gray-100">
            {items.map((r) => (
              <ReminderItem key={r.id} reminder={r} onChanged={reload} showApplication={false} />
            ))}
          </ul>
        )}
      </div>
    </Card>
  );
}

function ApplicationDetailsContent() {
  const { isAuthenticated, loading } = useRequireAuth();
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const params = useSearchParams();
  const saved = params.get('saved') === '1';
  const reminderSaved = params.get('reminder') === '1';
  const [application, setApplication] = useState<Application | null>(null);
  const [history, setHistory] = useState<HistoryEvent[]>([]);
  const [status, setStatus] = useState<'loading' | 'ready' | 'not_found' | 'error'>('loading');
  const [error, setError] = useState('');
  const [reloadKey, setReloadKey] = useState(0);
  const [confirming, setConfirming] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const deletingRef = useRef(false);

  useEffect(() => {
    if (!isAuthenticated || !id) return;
    let cancelled = false;
    getApplication(id)
      .then((data) => {
        if (cancelled) return;
        setApplication(data.application);
        setHistory(data.history);
        setStatus('ready');
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        if (err instanceof ApiError && (err.status === 404 || err.status === 400)) setStatus('not_found');
        else {
          setError(errorMessage(err, 'Failed to load the application'));
          setStatus('error');
        }
      });
    return () => {
      cancelled = true;
    };
  }, [isAuthenticated, id, reloadKey]);

  const remove = async () => {
    if (!application || deletingRef.current) return;
    deletingRef.current = true;
    setDeleting(true);
    try {
      await deleteApplication(application.id);
      router.push('/dashboard/applications?deleted=1');
    } catch (err: unknown) {
      setError(errorMessage(err, 'Failed to delete the application'));
      deletingRef.current = false;
      setDeleting(false);
      setConfirming(false);
    }
  };

  if (loading) return <div className="p-8 text-center text-gray-600">Loading...</div>;
  if (!isAuthenticated) return null;

  const back = (
    <Link href="/dashboard/applications" className="text-gray-500 hover:text-gray-800 text-sm">
      ← Back to Applications
    </Link>
  );
  if (status === 'loading') return <div className="page-container p-4 md:p-8 space-y-4">{back}<div className="animate-pulse h-64 bg-gray-100 rounded-xl" role="status" aria-label="Loading application" /></div>;
  if (status === 'not_found') {
    return (
      <div className="page-container p-4 md:p-8 space-y-4">
        {back}
        <p role="alert" className="text-gray-700 text-lg">
          Application not found.
        </p>
      </div>
    );
  }
  if (status === 'error' || !application) {
    return (
      <div className="page-container p-4 md:p-8 space-y-4">
        {back}
        <div role="alert" className="space-y-3">
          <p className="text-red-600 whitespace-pre-line">{error}</p>
          <button onClick={() => { setStatus('loading'); setReloadKey((k) => k + 1); }} className="text-sm bg-gray-200 hover:bg-gray-300 px-3 py-1.5 rounded">
            Retry
          </button>
        </div>
      </div>
    );
  }

  const a = application;
  return (
    <div className="page-container p-4 md:p-8 space-y-6">
      {back}
      {saved && (
        <p role="status" className="bg-green-50 text-green-700 p-3 rounded-lg text-sm font-medium border border-green-100">
          Application saved.
        </p>
      )}
      {reminderSaved && (
        <p role="status" className="bg-green-50 text-green-700 p-3 rounded-lg text-sm font-medium border border-green-100">
          Reminder saved.
        </p>
      )}
      {error && (
        <p role="alert" className="bg-red-50 text-red-600 p-3 rounded-lg text-sm border border-red-100">
          {error}
        </p>
      )}

      <div className="flex flex-col md:flex-row md:items-start justify-between gap-4">
        <div className="min-w-0">
          <h1 className="text-3xl font-bold break-words">{a.jobTitle}</h1>
          <p className="text-lg text-gray-600 break-words">{a.companyName}</p>
          <div className="flex flex-wrap items-center gap-2 mt-2">
            <StatusBadge {...STATUS_INFO[a.status]} />
            {a.followUpDue && <span className="text-sm text-amber-700 font-medium">⚑ Follow-up due</span>}
          </div>
        </div>
        <div className="flex flex-wrap items-start gap-2">
          <ApplicationStatusSelect application={a} onChanged={() => setReloadKey((k) => k + 1)} />
          <Link href={`/dashboard/applications/${a.id}/edit`} className="px-4 py-2 rounded-lg border border-gray-300 text-gray-800 hover:bg-gray-50 text-sm font-medium">
            Edit
          </Link>
          <button onClick={() => setConfirming(true)} disabled={deleting} className="px-4 py-2 rounded-lg border border-red-200 text-red-600 hover:bg-red-50 disabled:opacity-50 text-sm font-medium">
            Delete
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Card title="Job">
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2">
            <Row label="Posting">
              {a.postingUrl ? (
                <a href={a.postingUrl} target="_blank" rel="noopener noreferrer nofollow" className="text-blue-600 hover:text-blue-800 break-all">
                  {a.postingUrl}
                </a>
              ) : '—'}
            </Row>
            <Row label="Location">{a.location ?? '—'}</Row>
            <Row label="Type">{a.employmentType ? EMPLOYMENT_TYPES[a.employmentType] : '—'}</Row>
            <Row label="Compensation">{a.compensationNotes ?? '—'}</Row>
          </dl>
        </Card>
        <Card title="Application">
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2">
            <Row label="Applied">{a.appliedOn ? formatDay(a.appliedOn) : 'Not recorded'}</Row>
            <Row label="Job description">
              {a.links.jobDescription ? <Link href={`/job-descriptions/${a.links.jobDescription.id}`} className="text-blue-600 hover:text-blue-800">{a.links.jobDescription.title}</Link> : '—'}
            </Row>
            <Row label="Resume">
              {a.links.resume ? (
                <Link href={`/dashboard/resumes/${a.links.resume.id}`} className="text-blue-600 hover:text-blue-800">
                  {a.links.resume.filename} ({versionName({ versionNumber: a.links.resume.versionNumber, versionLabel: null })})
                </Link>
              ) : '—'}
            </Row>
            <Row label="Cover letter">
              {a.links.coverLetter ? <Link href={`/dashboard/cover-letters/${a.links.coverLetter.id}`} className="text-blue-600 hover:text-blue-800">{a.links.coverLetter.title}</Link> : '—'}
            </Row>
          </dl>
        </Card>
        <Card title="Interview">
          {a.interviewAt || a.interviewStage || a.interviewType ? (
            <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2">
              <Row label="When">{a.interviewAt ? formatDateTime(a.interviewAt) : '—'}</Row>
              <Row label="Type">{a.interviewType ? INTERVIEW_TYPES[a.interviewType] : '—'}</Row>
              <Row label="Stage">{a.interviewStage ?? '—'}</Row>
              <Row label="Interviewer">{a.interviewerName ?? '—'}</Row>
              <Row label="Preparation">{a.interviewNotes ?? '—'}</Row>
            </dl>
          ) : (
            <p className="text-sm text-gray-500">No interview recorded.</p>
          )}
        </Card>
        <Card title="Follow-up and contact">
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2">
            <Row label="Follow up">{a.followUpOn ? formatDay(a.followUpOn) : '—'}</Row>
            <Row label="Notes">{a.followUpNotes ?? '—'}</Row>
            <Row label="Contact">{[a.contactName, a.contactEmail, a.contactPhone].filter(Boolean).join(' · ') || '—'}</Row>
          </dl>
        </Card>
      </div>

      {a.notes && (
        <Card title="Notes">
          <p className="text-sm text-gray-800 whitespace-pre-wrap break-words">{a.notes}</p>
        </Card>
      )}

      <ApplicationReminders applicationId={a.id} reloadKey={reloadKey} />

      <Card title="History">
        <ol className="space-y-2 text-sm">
          {history.map((e) => (
            <li key={e.id} className="flex flex-col sm:flex-row sm:gap-3">
              <span className="text-gray-500 shrink-0 sm:w-44">{formatDateTime(e.createdAt)}</span>
              <span className="text-gray-800 break-words">{describe(e)}</span>
            </li>
          ))}
        </ol>
      </Card>

      <ConfirmDialog
        open={confirming}
        title="Delete this application?"
        confirmLabel="Delete Application"
        busyLabel="Deleting..."
        busy={deleting}
        onConfirm={remove}
        onCancel={() => setConfirming(false)}
      >
        <p>
          <span className="font-semibold">{a.jobTitle} at {a.companyName}</span> and its history will be permanently deleted. Linked resumes, job descriptions and cover letters are not affected. Its reminders are kept, unlinked, so you can review or dismiss them.
        </p>
      </ConfirmDialog>
    </div>
  );
}

// useSearchParams (for the "saved" notice) must sit inside a Suspense boundary.
export default function ApplicationDetails() {
  return (
    <Suspense fallback={<div className="p-8 text-center text-gray-600">Loading...</div>}>
      <ApplicationDetailsContent />
    </Suspense>
  );
}
