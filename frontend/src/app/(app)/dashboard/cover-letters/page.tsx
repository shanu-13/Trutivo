"use client";

import { Suspense, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useRequireAuth } from '@/hooks/useRequireAuth';
import { deleteCoverLetter, listCoverLetters, TONES, LENGTHS, type CoverLetterSummary } from '@/lib/api/coverLetter.api';
import { errorMessage, formatDateTime } from '@/lib/format';
import ConfirmDialog from '@/components/ConfirmDialog';

type Status = 'loading' | 'ready' | 'error';

function CoverLettersContent() {
  const { isAuthenticated, loading } = useRequireAuth();
  const deletedFromEditor = useSearchParams().get('deleted') === '1';
  const [letters, setLetters] = useState<CoverLetterSummary[]>([]);
  const [status, setStatus] = useState<Status>('loading');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState(deletedFromEditor ? 'Cover letter deleted.' : '');
  const [reloadKey, setReloadKey] = useState(0);
  const [toDelete, setToDelete] = useState<CoverLetterSummary | null>(null);
  const [deleting, setDeleting] = useState(false);
  const deletingRef = useRef(false);

  useEffect(() => {
    if (!isAuthenticated) return;
    let cancelled = false;
    listCoverLetters()
      .then((items) => {
        if (cancelled) return;
        setLetters(items);
        setStatus('ready');
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setError(errorMessage(err, 'Failed to load your cover letters'));
        setStatus('error');
      });
    return () => {
      cancelled = true;
    };
  }, [isAuthenticated, reloadKey]);

  const confirmDelete = async () => {
    if (!toDelete || deletingRef.current) return;
    deletingRef.current = true;
    const target = toDelete;
    setDeleting(true);
    setError('');
    setNotice('');
    try {
      await deleteCoverLetter(target.id);
      setLetters((current) => current.filter((l) => l.id !== target.id));
      setNotice(`"${target.title}" was deleted.`);
    } catch (err: unknown) {
      setError(errorMessage(err, 'Failed to delete the cover letter'));
    } finally {
      deletingRef.current = false;
      setDeleting(false);
      setToDelete(null);
    }
  };

  if (loading) return <div className="p-8 text-center text-gray-600">Loading...</div>;
  if (!isAuthenticated) return null;

  return (
    <div className="page-container p-4 md:p-8">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 mb-6">
        <div>
          <h1 className="text-3xl font-bold mb-1">Cover Letters</h1>
          <p className="text-gray-600">Drafts built from your resume and a saved job description, which you edit and save.</p>
        </div>
        <Link href="/dashboard/cover-letters/new" className="bg-blue-600 text-white px-5 py-2.5 rounded-lg hover:bg-blue-700 transition font-medium text-center whitespace-nowrap">
          New Cover Letter
        </Link>
      </div>

      {notice && (
        <p role="status" className="bg-green-50 text-green-700 p-3 rounded-lg mb-4 text-sm font-medium border border-green-100 break-words">
          {notice}
        </p>
      )}
      {error && status === 'ready' && (
        <p role="alert" className="bg-red-50 text-red-600 p-3 rounded-lg mb-4 text-sm font-medium border border-red-100 whitespace-pre-line">
          {error}
        </p>
      )}

      <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-4 md:p-6">
        {status === 'loading' && (
          <div className="animate-pulse space-y-3" role="status" aria-label="Loading cover letters">
            {[0, 1].map((i) => (
              <div key={i} className="h-16 bg-gray-100 rounded-lg" />
            ))}
          </div>
        )}
        {status === 'error' && (
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
        )}
        {status === 'ready' && letters.length === 0 && (
          <div className="text-center py-10">
            <p className="text-gray-700 text-lg mb-2">No saved cover letters yet.</p>
            <p className="text-gray-500 mb-6">Generate a draft from one of your resumes and a job description.</p>
            <Link href="/dashboard/cover-letters/new" className="bg-blue-600 text-white px-5 py-2.5 rounded-lg hover:bg-blue-700 transition font-medium">
              New Cover Letter
            </Link>
          </div>
        )}
        {status === 'ready' && letters.length > 0 && (
          <ul className="divide-y divide-gray-100">
            {letters.map((l) => (
              <li key={l.id} className="py-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div className="min-w-0">
                  <Link href={`/dashboard/cover-letters/${l.id}`} className="font-semibold text-gray-900 hover:text-blue-700 break-words">
                    {l.title}
                  </Link>
                  <p className="text-sm text-gray-600 break-words">
                    {TONES.find((t) => t.id === l.tone)?.label} · {LENGTHS.find((x) => x.id === l.length)?.label}
                    {l.resume ? ` · from ${l.resume.filename} (Version ${l.resume.versionNumber})` : ''}
                  </p>
                  <p className="text-sm text-gray-500">Updated {formatDateTime(l.updatedAt)}</p>
                </div>
                <div className="flex gap-4 shrink-0 text-sm font-medium">
                  <Link href={`/dashboard/cover-letters/${l.id}`} className="text-blue-600 hover:text-blue-800 py-1">
                    Open
                  </Link>
                  <button onClick={() => setToDelete(l)} disabled={deleting} className="text-red-600 hover:text-red-800 disabled:opacity-50 py-1">
                    Delete
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

      <ConfirmDialog
        open={toDelete !== null}
        title="Delete this cover letter?"
        confirmLabel="Delete Cover Letter"
        busyLabel="Deleting..."
        busy={deleting}
        onConfirm={confirmDelete}
        onCancel={() => setToDelete(null)}
      >
        <p>
          <span className="font-semibold">{toDelete?.title}</span> will be permanently deleted. Your resume and job description are not affected.
        </p>
      </ConfirmDialog>
    </div>
  );
}

// useSearchParams (for the "deleted" notice) must sit inside a Suspense boundary.
export default function CoverLetters() {
  return (
    <Suspense fallback={<div className="p-8 text-center text-gray-600">Loading...</div>}>
      <CoverLettersContent />
    </Suspense>
  );
}
