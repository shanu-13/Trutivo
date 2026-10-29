"use client";

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useRequireAuth } from '@/hooks/useRequireAuth';
import { ApiError } from '@/lib/api/client';
import { getCoverLetter, type SavedCoverLetter } from '@/lib/api/coverLetter.api';
import { errorMessage } from '@/lib/format';
import CoverLetterWorkspace from '@/components/CoverLetterWorkspace';

type Status = 'loading' | 'ready' | 'not_found' | 'error';

export default function CoverLetterPage() {
  const { isAuthenticated, loading } = useRequireAuth();
  const { id } = useParams<{ id: string }>();
  const [letter, setLetter] = useState<SavedCoverLetter | null>(null);
  const [status, setStatus] = useState<Status>('loading');
  const [error, setError] = useState('');
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    if (!isAuthenticated || !id) return;
    let cancelled = false;
    getCoverLetter(id)
      .then((data) => {
        if (cancelled) return;
        setLetter(data);
        setStatus('ready');
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        if (err instanceof ApiError && (err.status === 404 || err.status === 400)) setStatus('not_found');
        else {
          setError(errorMessage(err, 'Failed to load the cover letter'));
          setStatus('error');
        }
      });
    return () => {
      cancelled = true;
    };
  }, [isAuthenticated, id, reloadKey]);

  if (loading) return <div className="p-8 text-center text-gray-600">Loading...</div>;
  if (!isAuthenticated) return null;

  return (
    <div className="page-container p-4 md:p-8 space-y-4">
      <Link href="/dashboard/cover-letters" className="text-gray-500 hover:text-gray-800 text-sm">
        ← Back to Cover Letters
      </Link>
      {status === 'loading' && (
        <div className="animate-pulse space-y-4" role="status" aria-label="Loading cover letter">
          <div className="h-12 bg-gray-100 rounded-xl" />
          <div className="h-80 bg-gray-100 rounded-xl" />
        </div>
      )}
      {status === 'not_found' && (
        <p role="alert" className="text-center text-gray-700 text-lg py-10">
          Cover letter not found.
        </p>
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
      {status === 'ready' && letter && <CoverLetterWorkspace key={letter.id} saved={letter} />}
    </div>
  );
}
