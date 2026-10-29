"use client";

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useRequireAuth } from '@/hooks/useRequireAuth';
import { ApiError } from '@/lib/api/client';
import {
  DIFFICULTIES,
  INTERVIEW_TYPES,
  QUESTION_TYPE_INFO,
  completeInterview,
  getInterview,
  getInterviewSummary,
  saveDraft,
  savePosition,
  submitAnswer,
  type InterviewDetails,
  type InterviewQuestion,
} from '@/lib/api/interviews.api';
import { errorMessage, formatDateTime } from '@/lib/format';
import StatusBadge from '@/components/StatusBadge';
import ConfirmDialog from '@/components/ConfirmDialog';
import InterviewFeedback, { SCORE_NOTE } from '@/components/InterviewFeedback';
import InterviewSummary from '@/components/InterviewSummary';

type Busy = 'draft' | 'submit' | 'complete' | 'move' | null;

const stateOf = (q: InterviewQuestion, text: string) =>
  q.evaluation ? { symbol: '✓', label: 'Feedback received' } : text.trim() ? { symbol: '✎', label: 'Draft' } : { symbol: '○', label: 'Not answered' };

export default function InterviewWorkspace() {
  const { isAuthenticated, loading } = useRequireAuth();
  const { id } = useParams<{ id: string }>();
  const [data, setData] = useState<InterviewDetails | null>(null);
  const [status, setStatus] = useState<'loading' | 'ready' | 'not_found' | 'error'>('loading');
  const [loadError, setLoadError] = useState('');
  const [reloadKey, setReloadKey] = useState(0);
  const [index, setIndex] = useState(0);
  // The text in each editor, and what the server last saved for it.
  const [texts, setTexts] = useState<Record<string, string>>({});
  const [saved, setSaved] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<Busy>(null);
  const busyRef = useRef(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [confirming, setConfirming] = useState(false);

  useEffect(() => {
    if (!isAuthenticated || !id) return;
    let cancelled = false;
    getInterview(id)
      .then((d) => {
        if (cancelled) return;
        setData(d);
        const initial = Object.fromEntries(d.questions.map((q) => [q.id, q.draftAnswer ?? q.submittedAnswer ?? '']));
        setTexts(initial);
        setSaved(initial);
        setIndex(Math.min(d.session.currentPosition, d.questions.length - 1));
        setStatus('ready');
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        if (err instanceof ApiError && (err.status === 404 || err.status === 400)) setStatus('not_found');
        else {
          setLoadError(errorMessage(err, 'Failed to load the mock interview'));
          setStatus('error');
        }
      });
    return () => {
      cancelled = true;
    };
  }, [isAuthenticated, id, reloadKey]);

  const dirtyIds = data ? data.questions.filter((q) => (texts[q.id] ?? '') !== (saved[q.id] ?? '')).map((q) => q.id) : [];
  const dirty = dirtyIds.length > 0;

  // Unsaved answers: the browser asks before leaving, and in-app links are confirmed.
  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener('beforeunload', warn);
    const onClick = (e: MouseEvent) => {
      const link = (e.target as HTMLElement | null)?.closest?.('a[href]') as HTMLAnchorElement | null;
      if (!link || link.target === '_blank') return;
      if (!window.confirm('You have an unsaved answer. Leave without saving it?')) {
        e.preventDefault();
        e.stopPropagation();
      }
    };
    document.addEventListener('click', onClick, true);
    return () => {
      window.removeEventListener('beforeunload', warn);
      document.removeEventListener('click', onClick, true);
    };
  }, [dirty]);

  const run = async (kind: Busy, action: () => Promise<void>) => {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(kind);
    setError('');
    setNotice('');
    try {
      await action();
    } finally {
      busyRef.current = false;
      setBusy(null);
    }
  };

  if (loading) return <div className="p-8 text-center text-gray-600">Loading...</div>;
  if (!isAuthenticated) return null;

  const back = (
    <Link href="/dashboard/interviews" className="text-gray-500 hover:text-gray-800 text-sm">
      ← Back to Mock Interviews
    </Link>
  );
  if (status === 'loading') return <div className="page-container p-4 md:p-8 space-y-4">{back}<div className="animate-pulse h-80 bg-gray-100 rounded-xl" role="status" aria-label="Loading mock interview" /></div>;
  if (status === 'not_found') return <div className="page-container p-4 md:p-8 space-y-4">{back}<p role="alert" className="text-lg text-gray-700">Mock interview not found.</p></div>;
  if (status === 'error' || !data) {
    return (
      <div className="page-container p-4 md:p-8 space-y-4">
        {back}
        <div role="alert" className="space-y-3">
          <p className="text-red-600 whitespace-pre-line">{loadError}</p>
          <button onClick={() => { setStatus('loading'); setReloadKey((k) => k + 1); }} className="text-sm bg-gray-200 hover:bg-gray-300 px-3 py-1.5 rounded">
            Retry
          </button>
        </div>
      </div>
    );
  }

  const { session, questions } = data;
  const completed = session.status === 'completed';
  const q = questions[index];
  const text = texts[q.id] ?? '';
  const maxChars = data.limits?.maxAnswerChars ?? 5000;
  const answeredCount = questions.filter((x) => x.evaluation).length;
  const updateQuestion = (questionId: string, change: Partial<InterviewQuestion>) =>
    setData((d) => (d ? { ...d, questions: d.questions.map((x) => (x.id === questionId ? { ...x, ...change } : x)) } : d));

  const persistDraft = async (questionId: string) => {
    const value = texts[questionId] ?? '';
    await saveDraft(session.id, questionId, value);
    setSaved((s) => ({ ...s, [questionId]: value }));
  };

  // Moving saves the current answer as a draft first, so nothing typed is lost.
  const goTo = (next: number) =>
    run('move', async () => {
      if (!completed && dirtyIds.includes(q.id)) {
        try {
          await persistDraft(q.id);
        } catch (err: unknown) {
          setError(`${errorMessage(err, 'The draft could not be saved')} Your text is still here; try saving again.`);
          return;
        }
      }
      setIndex(next);
      if (!completed) savePosition(session.id, next).catch(() => {});
    });

  const saveCurrent = () =>
    run('draft', async () => {
      try {
        await persistDraft(q.id);
        setNotice('Draft saved. You can continue later.');
      } catch (err: unknown) {
        setError(errorMessage(err, 'The draft could not be saved'));
      }
    });

  const submit = () =>
    run('submit', async () => {
      if (!text.trim()) {
        setError('Write an answer before submitting it for feedback.');
        return;
      }
      try {
        const result = await submitAnswer(session.id, q.id, text);
        updateQuestion(q.id, { evaluation: result.evaluation, score: result.score, submittedAnswer: text, draftAnswer: text });
        setSaved((s) => ({ ...s, [q.id]: text }));
        // The running summary is recalculated by the server; a failure only leaves the old one.
        getInterviewSummary(session.id)
          .then((r) => setData((d) => (d ? { ...d, summary: r.summary } : d)))
          .catch(() => {});
      } catch (err: unknown) {
        // No score is shown unless the evaluation really succeeded.
        const details = err instanceof ApiError ? (err.details as { draftSaved?: boolean } | null) : null;
        if (details?.draftSaved) setSaved((s) => ({ ...s, [q.id]: text }));
        setError(
          `${errorMessage(err, 'Feedback could not be generated.')} Nothing was scored. ${
            details?.draftSaved ? 'Your answer was saved as a draft' : 'Your answer is still in the editor'
          }; try submitting again in a moment.`
        );
      }
    });

  const finish = () =>
    run('complete', async () => {
      try {
        for (const questionId of dirtyIds) await persistDraft(questionId);
        const result = await completeInterview(session.id);
        setData(result);
        setConfirming(false);
        window.scrollTo({ top: 0 });
      } catch (err: unknown) {
        setConfirming(false);
        setError(errorMessage(err, 'The interview could not be completed'));
      }
    });

  const unanswered = questions.length - answeredCount;
  return (
    <div className="page-container p-4 md:p-8 space-y-6">
      {back}
      <div className="flex flex-col md:flex-row md:items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-2xl md:text-3xl font-bold break-words">{session.title}</h1>
          <p className="text-sm text-gray-600 break-words">
            {INTERVIEW_TYPES[session.interviewType].label} · {DIFFICULTIES[session.difficulty]} · {session.resumeLabel}
            {completed && session.completedAt && ` · completed ${formatDateTime(session.completedAt)}`}
          </p>
        </div>
        {!completed && (
          <button
            onClick={() => setConfirming(true)}
            disabled={busy !== null}
            className="px-4 py-2 rounded-lg border border-gray-300 text-gray-800 hover:bg-gray-50 text-sm font-medium disabled:opacity-50 shrink-0"
          >
            Finish Interview
          </button>
        )}
      </div>

      {session.notes.length > 0 && (
        <ul className="text-sm text-gray-700 bg-blue-50 border border-blue-100 rounded-lg p-3 space-y-1">
          {session.notes.map((n) => (
            <li key={n}>
              <span aria-hidden="true">ℹ </span>
              {n}
            </li>
          ))}
        </ul>
      )}

      {completed && <InterviewSummary summary={data.summary} final />}

      {/* Progress */}
      <nav aria-label="Questions" className="space-y-2">
        <div className="flex justify-between text-sm text-gray-700">
          <span>
            Question {index + 1} of {questions.length}
          </span>
          <span>
            {answeredCount} of {questions.length} with feedback
          </span>
        </div>
        <div className="h-2 bg-gray-100 rounded" role="progressbar" aria-label="Answers with feedback" aria-valuemin={0} aria-valuemax={questions.length} aria-valuenow={answeredCount}>
          <div className="h-2 bg-blue-600 rounded" style={{ width: `${(answeredCount / questions.length) * 100}%` }} />
        </div>
        <ol className="flex flex-wrap gap-2">
          {questions.map((x, i) => {
            const st = stateOf(x, texts[x.id] ?? '');
            return (
              <li key={x.id}>
                <button
                  onClick={() => i !== index && goTo(i)}
                  disabled={busy !== null}
                  aria-current={i === index ? 'step' : undefined}
                  aria-label={`Question ${i + 1}: ${st.label}`}
                  className={`w-10 h-10 rounded-lg border text-sm font-medium ${i === index ? 'border-blue-600 bg-blue-600 text-white' : 'border-gray-300 bg-white text-gray-800 hover:bg-gray-50'}`}
                >
                  <span aria-hidden="true">
                    {i + 1}
                    {st.symbol !== '○' && <sup>{st.symbol}</sup>}
                  </span>
                </button>
              </li>
            );
          })}
        </ol>
      </nav>

      {error && (
        <p role="alert" className="bg-red-50 text-red-600 p-3 rounded-lg text-sm border border-red-100 whitespace-pre-line">
          {error}
        </p>
      )}
      {notice && (
        <p role="status" className="bg-green-50 text-green-700 p-3 rounded-lg text-sm border border-green-100">
          {notice}
        </p>
      )}

      <section aria-labelledby="question-text" className="bg-white rounded-xl shadow-sm border border-gray-100 p-4 md:p-6 space-y-4">
        <div className="flex flex-wrap items-center gap-2">
          <StatusBadge {...QUESTION_TYPE_INFO[q.type]} />
          <span className="text-sm text-gray-600 break-words">Focus: {q.focus}</span>
        </div>
        <h2 id="question-text" className="text-lg font-semibold text-gray-900 break-words">
          {q.text}
        </h2>
        {q.guidance && <p className="text-sm text-gray-600">{q.guidance}</p>}

        <div>
          <label htmlFor="answer" className="block text-sm font-medium text-gray-800 mb-1">
            Your answer
          </label>
          <textarea
            id="answer"
            rows={10}
            value={text}
            readOnly={completed}
            onChange={(e) => setTexts((t) => ({ ...t, [q.id]: e.target.value }))}
            aria-describedby="answer-count"
            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 read-only:bg-gray-50"
          />
          <p id="answer-count" className={`text-xs mt-1 ${text.length > maxChars ? 'text-red-600' : 'text-gray-500'}`}>
            {text.length.toLocaleString()} / {maxChars.toLocaleString()} characters
            {!completed && dirtyIds.includes(q.id) && ' · unsaved changes'}
            {!completed && !dirtyIds.includes(q.id) && q.draftSavedAt && ` · draft saved ${formatDateTime(q.draftSavedAt)}`}
          </p>
        </div>

        {!completed && (
          <div className="flex flex-wrap gap-2">
            <button
              onClick={submit}
              disabled={busy !== null || !text.trim() || text.length > maxChars}
              aria-busy={busy === 'submit'}
              className="px-4 py-2 rounded-lg bg-blue-600 text-white text-sm font-semibold hover:bg-blue-700 disabled:opacity-50"
            >
              {busy === 'submit' ? 'Evaluating...' : q.evaluation ? 'Resubmit for Feedback' : 'Submit for Feedback'}
            </button>
            <button
              onClick={saveCurrent}
              disabled={busy !== null || !dirtyIds.includes(q.id) || text.length > maxChars}
              className="px-4 py-2 rounded-lg border border-gray-300 text-gray-800 text-sm font-medium hover:bg-gray-50 disabled:opacity-50"
            >
              {busy === 'draft' ? 'Saving...' : 'Save Draft'}
            </button>
          </div>
        )}

        {q.evaluation ? (
          <>
            {q.submittedAnswer !== null && text !== q.submittedAnswer && !completed && (
              <p className="text-xs text-gray-500">This feedback is for the answer you last submitted, not the current text.</p>
            )}
            <InterviewFeedback evaluation={q.evaluation} />
          </>
        ) : (
          completed && <p className="text-sm text-gray-500">No feedback: this answer was not submitted.</p>
        )}

        <div className="flex justify-between gap-2 pt-2">
          <button onClick={() => goTo(index - 1)} disabled={index === 0 || busy !== null} className="px-3 py-1.5 rounded-lg border border-gray-300 text-sm disabled:opacity-50">
            ← Previous
          </button>
          {index < questions.length - 1 ? (
            <button onClick={() => goTo(index + 1)} disabled={busy !== null} className="px-3 py-1.5 rounded-lg border border-gray-300 text-sm font-medium disabled:opacity-50">
              Next question →
            </button>
          ) : (
            !completed && (
              <button onClick={() => setConfirming(true)} disabled={busy !== null} className="px-3 py-1.5 rounded-lg border border-blue-300 text-blue-700 text-sm font-medium disabled:opacity-50">
                Finish Interview
              </button>
            )
          )}
        </div>
      </section>

      {!completed && answeredCount > 0 && <InterviewSummary summary={data.summary} final={false} />}
      {!completed && answeredCount === 0 && <p className="text-xs text-gray-500">{SCORE_NOTE}</p>}

      <ConfirmDialog
        open={confirming}
        title="Finish this interview?"
        confirmLabel="Finish Interview"
        busyLabel="Finishing..."
        busy={busy === 'complete'}
        onConfirm={finish}
        onCancel={() => setConfirming(false)}
        tone="primary"
      >
        <p>
          {unanswered === 0
            ? 'All questions have feedback.'
            : `${unanswered} of ${questions.length} question${questions.length === 1 ? ' has' : 's have'} no feedback yet and will not count towards the average.`}{' '}
          After finishing, answers can no longer be changed and the summary is saved.
        </p>
      </ConfirmDialog>
    </div>
  );
}
