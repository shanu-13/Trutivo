"use client";

import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useRequireAuth } from '@/hooks/useRequireAuth';
import { ApiError } from '@/lib/api/client';
import {
  MAX_EDITED_LINE_LENGTH,
  getTailoring,
  getTailoringPreview,
  reviewSuggestion,
  saveTailoredCopy,
  type RequirementCoverage,
  type ReviewAction,
  type ReviewStatus,
  type SuggestionCategory,
  type TailoringPreview,
  type TailoringSession,
  type TailoringSuggestion,
} from '@/lib/api/tailoring.api';
import type { ResumeSummary } from '@/lib/api/resume.api';
import { errorMessage, formatDateTime } from '@/lib/format';
import { versionName } from '@/lib/resumeStatus';
import StatusBadge from '@/components/StatusBadge';
import ConfirmDialog from '@/components/ConfirmDialog';

type Status = 'loading' | 'ready' | 'not_found' | 'error';

const REVIEW_BADGE: Record<ReviewStatus, { label: string; symbol: string; tone: string }> = {
  pending: { label: 'Pending', symbol: '○', tone: 'bg-gray-50 text-gray-700 border-gray-200' },
  accepted: { label: 'Accepted', symbol: '✓', tone: 'bg-green-50 text-green-800 border-green-200' },
  edited: { label: 'Edited', symbol: '✎', tone: 'bg-blue-50 text-blue-800 border-blue-200' },
  rejected: { label: 'Rejected', symbol: '✕', tone: 'bg-red-50 text-red-700 border-red-200' },
};

const COVERAGE: Record<RequirementCoverage['status'], { label: string; symbol: string; tone: string }> = {
  supported: { label: 'Supported by your resume', symbol: '✓', tone: 'bg-green-50 text-green-800 border-green-200' },
  partial: { label: 'Partially supported', symbol: '◐', tone: 'bg-amber-50 text-amber-800 border-amber-200' },
  not_found: { label: 'Not found in your resume', symbol: '○', tone: 'bg-gray-50 text-gray-700 border-gray-200' },
};

const TYPE_LABEL: Record<RequirementCoverage['type'], string> = {
  required_skill: 'Required skill',
  preferred_skill: 'Preferred skill',
  experience: 'Experience',
  education: 'Education',
};

const GROUPS: { key: SuggestionCategory; title: string; empty: string }[] = [
  { key: 'skills', title: 'Skills', empty: 'No skills changes suggested: no skills list was found, or it already leads with what the job asks for.' },
  { key: 'experience', title: 'Experience', empty: 'No wording changes suggested for your experience.' },
  { key: 'projects', title: 'Projects', empty: 'No wording changes suggested for your projects.' },
  { key: 'structure', title: 'Structure and Clarity', empty: 'No repeated lines found.' },
];

// Client-side check matching the backend's rules for an edited line.
const editProblem = (text: string) => {
  const t = text.trim();
  if (!t) return 'Your wording cannot be empty.';
  if (t.length > MAX_EDITED_LINE_LENGTH) return `Keep it to ${MAX_EDITED_LINE_LENGTH} characters or fewer.`;
  if (/[\r\n]/.test(text)) return 'Keep it to a single line.';
  return '';
};

function Panel({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  return (
    <section className="bg-white rounded-xl shadow-sm border border-gray-100 p-4 md:p-6" aria-labelledby={id}>
      <h2 id={id} className="text-lg font-bold text-gray-900 mb-3">
        {title}
      </h2>
      {children}
    </section>
  );
}

function TextBlock({ label, children, tone = 'bg-gray-50 border-gray-200' }: { label: string; children: ReactNode; tone?: string }) {
  return (
    <div className={`border rounded-lg p-3 min-w-0 ${tone}`}>
      <p className="text-xs font-semibold text-gray-600 mb-1">{label}</p>
      <div className="text-sm text-gray-900 whitespace-pre-wrap break-words">{children}</div>
    </div>
  );
}

interface CardProps {
  suggestion: TailoringSuggestion;
  readOnly: boolean;
  onReview: (s: TailoringSuggestion, action: ReviewAction, editedText?: string) => Promise<string | null>;
  onDraftChange: (id: string, dirty: boolean) => void;
}

function SuggestionCard({ suggestion: s, readOnly, onReview, onDraftChange }: CardProps) {
  const fieldId = useId();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const busyRef = useRef(false);
  const removal = s.suggestedText === '';

  const run = async (action: ReviewAction, editedText?: string) => {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    setError('');
    const problem = await onReview(s, action, editedText);
    busyRef.current = false;
    setBusy(false);
    if (problem) setError(problem);
    else if (action === 'edit') {
      setEditing(false);
      onDraftChange(s.id, false);
    }
  };

  const startEdit = () => {
    setDraft(s.editedText ?? (removal ? s.originalText : s.suggestedText));
    setEditing(true);
    setError('');
  };
  const discardEdit = () => {
    setEditing(false);
    setError('');
    onDraftChange(s.id, false);
  };
  const problem = editing ? editProblem(draft) : '';

  return (
    <li className="py-4 space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <StatusBadge {...REVIEW_BADGE[s.status]} />
        {s.entryLabel && <span className="text-sm font-medium text-gray-700 break-words">{s.entryLabel}</span>}
        <span className="text-xs text-gray-500">Line {s.lineIndex + 1}</span>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <TextBlock label="Original">{s.originalText}</TextBlock>
        {s.status === 'edited' ? (
          <TextBlock label="Your wording (accepted)" tone="bg-blue-50 border-blue-200">
            {s.editedText}
          </TextBlock>
        ) : (
          <TextBlock label={removal ? 'Proposed change' : 'Proposed revision'} tone="bg-green-50 border-green-200">
            {removal ? <em>Remove this line</em> : s.suggestedText}
          </TextBlock>
        )}
      </div>
      <p className="text-sm text-gray-700">
        <span className="font-medium">Why: </span>
        {s.reason}
      </p>
      {s.relatedRequirements.length > 0 && (
        <p className="text-sm text-gray-600">
          <span className="font-medium">Related job requirements: </span>
          {s.relatedRequirements.join(', ')}
        </p>
      )}

      {editing && (
        <div className="space-y-2">
          <label htmlFor={fieldId} className="block text-sm font-medium text-gray-800">
            Your wording for this line
          </label>
          <textarea
            id={fieldId}
            value={draft}
            rows={2}
            onChange={(e) => {
              setDraft(e.target.value);
              onDraftChange(s.id, true);
            }}
            aria-invalid={Boolean(problem)}
            aria-describedby={`${fieldId}-help`}
            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
          <p id={`${fieldId}-help`} className={`text-xs ${problem ? 'text-red-600' : 'text-gray-500'}`}>
            {problem || `Only write what is true for you. ${draft.trim().length} / ${MAX_EDITED_LINE_LENGTH}`}
          </p>
        </div>
      )}

      {error && (
        <p role="alert" className="text-sm text-red-600 whitespace-pre-line">
          {error}
        </p>
      )}

      {!readOnly && (
        <div className="flex flex-wrap gap-2 text-sm font-medium">
          {editing ? (
            <>
              <button
                onClick={() => run('edit', draft)}
                disabled={busy || Boolean(problem)}
                className="px-3 py-1.5 rounded-lg bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50"
              >
                Accept Edited Text
              </button>
              <button onClick={discardEdit} disabled={busy} className="px-3 py-1.5 rounded-lg border border-gray-300 hover:bg-gray-50 disabled:opacity-50">
                Discard Edit
              </button>
            </>
          ) : (
            <>
              {s.status !== 'accepted' && (
                <button onClick={() => run('accept')} disabled={busy} className="px-3 py-1.5 rounded-lg bg-green-600 text-white hover:bg-green-700 disabled:opacity-50">
                  Accept
                </button>
              )}
              <button onClick={startEdit} disabled={busy} className="px-3 py-1.5 rounded-lg border border-gray-300 hover:bg-gray-50 disabled:opacity-50">
                Edit
              </button>
              {s.status !== 'rejected' && (
                <button onClick={() => run('reject')} disabled={busy} className="px-3 py-1.5 rounded-lg border border-red-200 text-red-700 hover:bg-red-50 disabled:opacity-50">
                  Reject
                </button>
              )}
              {s.status !== 'pending' && (
                <button onClick={() => run('reset')} disabled={busy} className="px-3 py-1.5 rounded-lg text-gray-600 hover:text-gray-900 disabled:opacity-50">
                  Undo Decision
                </button>
              )}
            </>
          )}
        </div>
      )}
    </li>
  );
}

function Preview({ preview }: { preview: TailoringPreview }) {
  return (
    <div className="space-y-3">
      <p className="text-sm text-gray-600">
        Tailored draft: your original resume text with the {preview.appliedCount} change(s) you accepted. Revised lines are
        marked; nothing is saved yet.
      </p>
      {preview.staleSuggestionIds.length > 0 && (
        <p role="alert" className="text-sm text-amber-700">
          {preview.staleSuggestionIds.length} accepted suggestion(s) no longer match the resume text and were not applied.
        </p>
      )}
      <ol className="border border-gray-200 rounded-lg p-3 text-sm font-mono space-y-0.5 overflow-hidden" aria-label="Tailored draft">
        {preview.lines.map((line) =>
          line.status === 'original' ? (
            <li key={line.index} className="whitespace-pre-wrap break-words text-gray-800 min-h-[1.25rem]">
              {line.text}
            </li>
          ) : line.status === 'removed' ? (
            <li key={line.index} className="whitespace-pre-wrap break-words bg-red-50 text-red-800 px-1 rounded">
              <span className="font-sans text-xs font-semibold mr-2">[Removed]</span>
              <del>{line.originalText}</del>
            </li>
          ) : (
            <li key={line.index} className="whitespace-pre-wrap break-words bg-green-50 px-1 rounded">
              <span className="font-sans text-xs font-semibold text-green-800 mr-2">[Revised]</span>
              {line.text}
              <span className="block font-sans text-xs text-gray-500">
                Was: <del>{line.originalText}</del>
              </span>
            </li>
          )
        )}
      </ol>
    </div>
  );
}

export default function TailoringSessionPage() {
  const { isAuthenticated, loading } = useRequireAuth();
  const { id, sessionId } = useParams<{ id: string; sessionId: string }>();
  const [session, setSession] = useState<TailoringSession | null>(null);
  const [status, setStatus] = useState<Status>('loading');
  const [error, setError] = useState('');
  const [reloadKey, setReloadKey] = useState(0);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [preview, setPreview] = useState<TailoringPreview | null>(null);
  const [previewError, setPreviewError] = useState('');
  const [previewKey, setPreviewKey] = useState(0);
  const [confirmingSave, setConfirmingSave] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState('');
  const [saved, setSaved] = useState<ResumeSummary | null>(null);
  const savingRef = useRef(false);
  const [dirtyDrafts, setDirtyDrafts] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (!isAuthenticated || !id || !sessionId) return;
    let cancelled = false;
    getTailoring(id, sessionId)
      .then((data) => {
        if (cancelled) return;
        setSession(data);
        setStatus('ready');
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        if (err instanceof ApiError && (err.status === 404 || err.status === 400)) setStatus('not_found');
        else {
          setError(errorMessage(err, 'Failed to load the tailoring session'));
          setStatus('error');
        }
      });
    return () => {
      cancelled = true;
    };
  }, [isAuthenticated, id, sessionId, reloadKey]);

  // The preview is rebuilt by the server after every decision while it is open.
  useEffect(() => {
    if (!previewOpen || !id || !sessionId) return;
    let cancelled = false;
    getTailoringPreview(id, sessionId)
      .then((data) => {
        if (cancelled) return;
        setPreview(data);
        setPreviewError('');
      })
      .catch((err: unknown) => {
        if (!cancelled) setPreviewError(errorMessage(err, 'Failed to build the preview'));
      });
    return () => {
      cancelled = true;
    };
  }, [previewOpen, id, sessionId, previewKey]);

  // Unsaved wording in an open editor is not lost by accident.
  useEffect(() => {
    if (dirtyDrafts.size === 0) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirtyDrafts]);

  const onDraftChange = (suggestionId: string, dirty: boolean) =>
    setDirtyDrafts((current) => {
      if (current.has(suggestionId) === dirty) return current;
      const next = new Set(current);
      if (dirty) next.add(suggestionId);
      else next.delete(suggestionId);
      return next;
    });

  // Returns an error message to show on the card, or null on success.
  const onReview = async (s: TailoringSuggestion, action: ReviewAction, editedText?: string) => {
    try {
      const updated = await reviewSuggestion(id, sessionId, s.id, action, editedText);
      setSession((current) =>
        current ? { ...current, suggestions: current.suggestions.map((x) => (x.id === updated.id ? updated : x)) } : current
      );
      setPreviewKey((k) => k + 1);
      return null;
    } catch (err: unknown) {
      if (err instanceof ApiError && err.code === 'TAILORING_ALREADY_SAVED') setReloadKey((k) => k + 1);
      return errorMessage(err, 'Failed to update the suggestion');
    }
  };

  const save = async () => {
    if (savingRef.current) return;
    savingRef.current = true;
    setSaving(true);
    setSaveError('');
    try {
      const result = await saveTailoredCopy(id, sessionId);
      setSaved(result.resume);
      setConfirmingSave(false);
      setReloadKey((k) => k + 1);
    } catch (err: unknown) {
      setSaveError(errorMessage(err, 'Failed to save the tailored copy'));
      setConfirmingSave(false);
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  };

  if (loading) return <div className="p-8 text-center text-gray-600">Loading...</div>;
  if (!isAuthenticated) return null;

  const back = (
    <Link href={`/dashboard/tailor?resumeId=${id}`} className="text-gray-500 hover:text-gray-800 text-sm">
      ← Back to Tailoring
    </Link>
  );

  if (status === 'loading') {
    return (
      <div className="page-container p-4 md:p-8 space-y-4">
        {back}
        <div className="animate-pulse space-y-4" role="status" aria-label="Loading tailoring session">
          <div className="h-24 bg-gray-100 rounded-xl" />
          <div className="h-48 bg-gray-100 rounded-xl" />
        </div>
      </div>
    );
  }
  if (status === 'not_found') {
    return (
      <div className="page-container p-4 md:p-8 text-center space-y-4" role="alert">
        <p className="text-gray-700 text-lg">Tailoring session not found.</p>
        <Link href="/dashboard/tailor" className="text-blue-600 hover:text-blue-800 font-medium">
          Start a new tailoring session
        </Link>
      </div>
    );
  }
  if (status === 'error' || !session) {
    return (
      <div className="page-container p-4 md:p-8 space-y-4">
        {back}
        <div role="alert" className="space-y-3">
          <p className="text-red-600 font-medium whitespace-pre-line">{error}</p>
          <button
            onClick={() => {
              setStatus('loading');
              setReloadKey((k) => k + 1);
            }}
            className="text-sm bg-gray-200 hover:bg-gray-300 px-3 py-1.5 rounded transition"
          >
            Retry
          </button>
        </div>
      </div>
    );
  }

  const readOnly = session.status === 'saved';
  const counts = session.suggestions.reduce<Record<ReviewStatus, number>>(
    (acc, s) => ({ ...acc, [s.status]: acc[s.status] + 1 }),
    { pending: 0, accepted: 0, edited: 0, rejected: 0 }
  );
  const acceptedCount = counts.accepted + counts.edited;
  const savedResumeId = saved?.id ?? session.savedResumeId;
  const coverageGroups = (['supported', 'partial', 'not_found'] as const).map((key) => ({
    key,
    items: session.requirements.filter((r) => r.status === key),
  }));

  return (
    <div className="page-container p-4 md:p-8 space-y-6">
      {back}
      <div>
        <h1 className="text-3xl font-bold mb-1 break-words">Tailor for {session.jobTitle}</h1>
        <p className="text-gray-600 break-words">
          {session.companyName && <>{session.companyName} · </>}
          Resume: {session.resumeFilename} ({versionName(session)}) · Created {formatDateTime(session.createdAt)}
        </p>
      </div>

      <div className="bg-blue-50 border border-blue-100 text-blue-900 rounded-lg p-4 text-sm space-y-1">
        <p className="font-semibold">How these suggestions work</p>
        <p>
          They come from fixed rules applied to your resume and the job&apos;s extracted requirements. No AI writing is used.
          Suggestions only reorder, shorten or reword lines that are already in your resume. They never add skills,
          experience or numbers.
        </p>
        <p>Nothing changes until you accept suggestions and save a tailored copy. Your original resume is never modified.</p>
      </div>

      {readOnly && savedResumeId && (
        <div role="status" className="bg-green-50 border border-green-100 text-green-800 rounded-lg p-4 text-sm space-y-2">
          <p className="font-semibold">
            Saved as a new version of your resume. It is not the current version unless you choose it in the version history.
          </p>
          <div className="flex flex-wrap gap-x-4 gap-y-1 font-medium">
            <Link href={`/dashboard/resumes/${savedResumeId}`} className="underline hover:text-green-900">
              Open tailored copy
            </Link>
            <Link href={`/dashboard/resumes/${savedResumeId}/versions`} className="underline hover:text-green-900">
              Version history
            </Link>
            <Link href={`/dashboard/resumes/${session.resumeId}/compare/${savedResumeId}`} className="underline hover:text-green-900">
              Compare with the original
            </Link>
            <Link href={`/dashboard/resumes/${savedResumeId}/export`} className="underline hover:text-green-900">
              Export as PDF
            </Link>
          </div>
        </div>
      )}
      {readOnly && !savedResumeId && (
        <p role="status" className="bg-gray-50 border border-gray-200 rounded-lg p-4 text-sm text-gray-700">
          This session was saved, but its tailored copy has since been deleted.
        </p>
      )}

      <Panel id="coverage" title="Job Requirements and Your Resume">
        {session.requirements.length === 0 ? (
          <p className="text-sm text-gray-600">This job description has no extracted requirements to compare.</p>
        ) : (
          <div className="space-y-4">
            <p className="text-sm text-gray-600">
              Based on the text of your resume. A requirement that is not found may still be something you have; add it to
              your resume only if it is true.
            </p>
            {coverageGroups.map(
              ({ key, items }) =>
                items.length > 0 && (
                  <div key={key}>
                    <h3 className="mb-2">
                      <StatusBadge {...COVERAGE[key]} /> <span className="text-sm text-gray-600">({items.length})</span>
                    </h3>
                    <ul className="space-y-1 text-sm">
                      {items.map((r) => (
                        <li key={`${r.type}:${r.requirement}`} className="break-words">
                          <span className="font-medium text-gray-900">{r.requirement}</span>{' '}
                          <span className="text-gray-500">({TYPE_LABEL[r.type]})</span>
                          <span className="block text-gray-600">{r.detail}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )
            )}
          </div>
        )}
      </Panel>

      <div className="flex flex-wrap gap-2 text-sm" aria-label="Review progress">
        {(Object.keys(REVIEW_BADGE) as ReviewStatus[]).map((key) => (
          <StatusBadge key={key} {...REVIEW_BADGE[key]} label={`${REVIEW_BADGE[key].label}: ${counts[key]}`} />
        ))}
      </div>

      {session.suggestions.length === 0 && (
        <p className="bg-white border border-gray-100 rounded-xl p-4 text-sm text-gray-600">
          No line changes were suggested for this resume and job. See the requirements above and the advice below.
        </p>
      )}

      {GROUPS.map(({ key, title, empty }) => {
        const items = session.suggestions.filter((s) => s.category === key);
        const notes = key === 'structure' ? session.notes : [];
        return (
          <Panel key={key} id={`group-${key}`} title={title}>
            {items.length === 0 && notes.length === 0 && <p className="text-sm text-gray-500">{empty}</p>}
            {items.length > 0 && (
              <ul className="divide-y divide-gray-100">
                {items.map((s) => (
                  <SuggestionCard key={s.id} suggestion={s} readOnly={readOnly} onReview={onReview} onDraftChange={onDraftChange} />
                ))}
              </ul>
            )}
            {notes.length > 0 && (
              <div className="mt-3">
                <h3 className="text-sm font-semibold text-gray-800 mb-2">Advice that needs your input (nothing is changed automatically)</h3>
                <ul className="space-y-2 text-sm">
                  {notes.map((n, i) => (
                    <li key={i} className="border border-amber-100 bg-amber-50 rounded-lg p-3 break-words">
                      {n.lineText && <span className="block text-gray-800 mb-1">&ldquo;{n.lineText}&rdquo;</span>}
                      <span className="text-gray-700">{n.message}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </Panel>
        );
      })}

      <Panel id="preview" title="Preview">
        {!previewOpen ? (
          <button
            onClick={() => setPreviewOpen(true)}
            className="text-sm px-4 py-2 rounded-lg border border-gray-300 hover:bg-gray-50 font-medium"
          >
            Preview Tailored Draft
          </button>
        ) : previewError ? (
          <div role="alert" className="space-y-2">
            <p className="text-sm text-red-600">{previewError}</p>
            <button onClick={() => setPreviewKey((k) => k + 1)} className="text-sm bg-gray-200 hover:bg-gray-300 px-3 py-1.5 rounded">
              Retry
            </button>
          </div>
        ) : !preview ? (
          <p className="text-sm text-gray-500" role="status">
            Building preview...
          </p>
        ) : (
          <>
            <Preview preview={preview} />
            <div className="mt-3 flex flex-wrap gap-x-4 gap-y-2 text-sm font-medium">
              <button onClick={() => setPreviewOpen(false)} className="text-blue-600 hover:text-blue-800">
                Hide preview and keep reviewing
              </button>
              <Link href={`/dashboard/resumes/${session.resumeId}/export?session=${session.id}`} className="text-blue-600 hover:text-blue-800">
                Choose a template and export PDF
              </Link>
            </div>
          </>
        )}
      </Panel>

      {!readOnly && (
        <section className="bg-white rounded-xl shadow-sm border border-gray-100 p-4 md:p-6 space-y-3" aria-labelledby="save-heading">
          <h2 id="save-heading" className="text-lg font-bold text-gray-900">
            Save Tailored Copy
          </h2>
          <p className="text-sm text-gray-600">
            Saves your resume text with the {acceptedCount} accepted change(s) as a new version of this resume. The original
            file and version are kept, and the copy does not become the current version unless you choose it.
          </p>
          {dirtyDrafts.size > 0 && (
            <p className="text-sm text-amber-700">You have unconfirmed edits. Accept or discard them before saving.</p>
          )}
          {saveError && (
            <p role="alert" className="text-sm text-red-600 whitespace-pre-line">
              {saveError}
            </p>
          )}
          <button
            onClick={() => setConfirmingSave(true)}
            disabled={acceptedCount === 0 || saving || dirtyDrafts.size > 0}
            className="bg-blue-600 text-white px-5 py-2.5 rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition font-medium"
          >
            Save Tailored Copy
          </button>
          {acceptedCount === 0 && <p className="text-xs text-gray-500">Accept at least one suggestion to save a copy.</p>}
        </section>
      )}

      <ConfirmDialog
        open={confirmingSave}
        title="Save tailored copy?"
        confirmLabel="Save Copy"
        busyLabel="Saving..."
        busy={saving}
        tone="primary"
        onConfirm={save}
        onCancel={() => setConfirmingSave(false)}
      >
        <p>
          A new version of <span className="font-semibold">{session.resumeFilename}</span> will be created with your{' '}
          {acceptedCount} accepted change(s).
        </p>
        <p>The original stays unchanged and the current version stays the same. This session can no longer be changed after saving.</p>
      </ConfirmDialog>
    </div>
  );
}
