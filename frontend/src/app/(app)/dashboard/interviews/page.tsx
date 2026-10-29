"use client";

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useRequireAuth } from '@/hooks/useRequireAuth';
import { DIFFICULTIES, INTERVIEW_TYPES, deleteInterview, listInterviews, type InterviewListItem } from '@/lib/api/interviews.api';
import { errorMessage, formatDateTime } from '@/lib/format';
import StatusBadge from '@/components/StatusBadge';
import ConfirmDialog from '@/components/ConfirmDialog';

const PAGE_SIZE = 20;
const STATUS = {
  in_progress: { label: 'In progress', symbol: '◔', tone: 'bg-blue-50 text-blue-800 border-blue-200' },
  completed: { label: 'Completed', symbol: '✓', tone: 'bg-green-50 text-green-800 border-green-200' },
} as const;

export default function Interviews() {
  const { isAuthenticated, loading } = useRequireAuth();
  const [items, setItems] = useState<InterviewListItem[]>([]);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(0);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [error, setError] = useState('');
  const [reloadKey, setReloadKey] = useState(0);
  const [toDelete, setToDelete] = useState<InterviewListItem | null>(null);
  const [deleting, setDeleting] = useState(false);
  const deletingRef = useRef(false);

  useEffect(() => {
    if (!isAuthenticated) return;
    let cancelled = false;
    listInterviews(page, PAGE_SIZE)
      .then((data) => {
        if (cancelled) return;
        setItems(data.items);
        setTotalPages(data.pagination.totalPages);
        setStatus('ready');
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setError(errorMessage(err, 'Failed to load your mock interviews'));
        setStatus('error');
      });
    return () => {
      cancelled = true;
    };
  }, [isAuthenticated, page, reloadKey]);

  const remove = async () => {
    if (!toDelete || deletingRef.current) return;
    deletingRef.current = true;
    setDeleting(true);
    try {
      await deleteInterview(toDelete.id);
      setToDelete(null);
      setReloadKey((k) => k + 1);
    } catch (err: unknown) {
      setError(errorMessage(err, 'Failed to delete the interview'));
      setToDelete(null);
    } finally {
      deletingRef.current = false;
      setDeleting(false);
    }
  };

  if (loading) return <div className="p-8 text-center text-gray-600">Loading...</div>;
  if (!isAuthenticated) return null;

  return (
    <div className="page-container p-4 md:p-8 space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-3xl font-bold">Mock Interviews</h1>
          <p className="text-gray-600">Practise answering questions based on your resume and a job description, and get automated feedback.</p>
        </div>
        <Link href="/dashboard/interviews/new" className="bg-blue-600 text-white px-4 py-2 rounded-lg font-semibold hover:bg-blue-700 text-center">
          + New Mock Interview
        </Link>
      </div>

      {status === 'error' && (
        <div role="alert" className="space-y-3">
          <p className="text-red-600 whitespace-pre-line">{error}</p>
          <button onClick={() => { setStatus('loading'); setReloadKey((k) => k + 1); }} className="text-sm bg-gray-200 hover:bg-gray-300 px-3 py-1.5 rounded">
            Retry
          </button>
        </div>
      )}
      {status === 'loading' && (
        <div className="animate-pulse space-y-3" role="status" aria-label="Loading mock interviews">
          {[0, 1, 2].map((i) => (
            <div key={i} className="h-20 bg-gray-100 rounded-xl" />
          ))}
        </div>
      )}
      {status === 'ready' && items.length === 0 && (
        <div className="text-center py-10 border border-dashed border-gray-300 rounded-xl bg-white">
          <p className="text-gray-700 mb-1">You have no mock interviews yet.</p>
          <p className="text-sm text-gray-500 mb-3">Choose a processed resume and a job description to get started.</p>
          <Link href="/dashboard/interviews/new" className="text-sm font-medium text-blue-600 hover:text-blue-800">
            Start a mock interview
          </Link>
        </div>
      )}
      {status === 'ready' && items.length > 0 && (
        <ul className="bg-white rounded-xl shadow-sm border border-gray-100 divide-y divide-gray-100">
          {items.map((s) => (
            <li key={s.id} className="p-4 flex flex-col md:flex-row md:items-center justify-between gap-3">
              <div className="min-w-0 space-y-1">
                <div className="flex flex-wrap items-center gap-2">
                  <StatusBadge {...STATUS[s.status]} />
                  <span className="text-sm text-gray-600">
                    {INTERVIEW_TYPES[s.interviewType].label} · {DIFFICULTIES[s.difficulty]}
                  </span>
                </div>
                <Link href={`/dashboard/interviews/${s.id}`} className="font-semibold text-gray-900 hover:text-blue-700 break-words">
                  {s.title}
                </Link>
                <p className="text-sm text-gray-500 break-words">
                  {s.resumeLabel} · {s.evaluatedCount} of {s.questionCount} answered
                  {s.averageScore !== null && ` · average ${s.averageScore}/100`} · updated {formatDateTime(s.updatedAt)}
                </p>
              </div>
              <div className="flex gap-2 shrink-0">
                <Link href={`/dashboard/interviews/${s.id}`} className="px-3 py-1.5 rounded-lg border border-gray-300 text-sm font-medium hover:bg-gray-50">
                  {s.status === 'completed' ? 'View results' : 'Continue'}
                </Link>
                <button onClick={() => setToDelete(s)} className="px-3 py-1.5 rounded-lg border border-red-200 text-red-600 text-sm font-medium hover:bg-red-50">
                  Delete
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
      {status === 'ready' && totalPages > 1 && (
        <nav className="flex items-center justify-between" aria-label="Pagination">
          <button onClick={() => { setPage((p) => p - 1); setStatus('loading'); }} disabled={page <= 1} className="px-3 py-1.5 rounded-lg border border-gray-300 text-sm disabled:opacity-50">
            ← Previous
          </button>
          <span className="text-sm text-gray-600">
            Page {page} of {totalPages}
          </span>
          <button onClick={() => { setPage((p) => p + 1); setStatus('loading'); }} disabled={page >= totalPages} className="px-3 py-1.5 rounded-lg border border-gray-300 text-sm disabled:opacity-50">
            Next →
          </button>
        </nav>
      )}

      <ConfirmDialog
        open={toDelete !== null}
        title="Delete this mock interview?"
        confirmLabel="Delete Interview"
        busyLabel="Deleting..."
        busy={deleting}
        onConfirm={remove}
        onCancel={() => setToDelete(null)}
      >
        <p>
          <span className="font-semibold break-words">{toDelete?.title}</span>, its answers and feedback will be permanently deleted.
        </p>
      </ConfirmDialog>
    </div>
  );
}
