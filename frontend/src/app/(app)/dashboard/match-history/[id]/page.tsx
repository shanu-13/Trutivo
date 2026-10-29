"use client";

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { MatchResultView, type MatchResultData } from '@/components/ResumeJobMatch';
import { useRequireAuth } from '@/hooks/useRequireAuth';
import { getMatchHistoryItem, type MatchHistorySummary } from '@/lib/api/matchHistory.api';
import { formatDateTime } from '@/lib/format';

type SavedMatch = MatchHistorySummary & { result: MatchResultData };

export default function SavedMatchAnalysis() {
  const { isAuthenticated, loading } = useRequireAuth();
  const { id } = useParams<{ id: string }>();
  const [saved, setSaved] = useState<SavedMatch | null>(null);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [error, setError] = useState('');

  // Bumped to fetch again after an error.
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    if (!isAuthenticated || !id) return;
    let cancelled = false;
    // Fetches the stored snapshot; nothing is recalculated.
    getMatchHistoryItem(id)
      .then((data) => {
        if (cancelled) return;
        setSaved(data.data.matchHistory);
        setStatus('ready');
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setError(err instanceof Error && err.message ? err.message : 'Failed to load the saved analysis');
        setStatus('error');
      });
    return () => {
      cancelled = true;
    };
  }, [isAuthenticated, id, reloadKey]);

  const retry = () => {
    setStatus('loading');
    setError('');
    setReloadKey((key) => key + 1);
  };

  if (loading) return <div className="p-8 text-center text-gray-600">Loading...</div>;
  if (!isAuthenticated) return null;

  return (
    <div className="page-container p-4 md:p-8">
      <Link href="/dashboard/match-history" className="text-gray-500 hover:text-gray-800 text-sm">
        ← Back to Match History
      </Link>

      {status === 'loading' && (
        <p className="mt-6 text-gray-500" role="status">Loading saved analysis...</p>
      )}

      {status === 'error' && (
        <div role="alert" className="mt-6 space-y-3">
          <p className="text-red-600 font-medium whitespace-pre-line">{error}</p>
          <button onClick={retry} className="text-sm bg-gray-200 hover:bg-gray-300 px-3 py-1 rounded transition">
            Retry
          </button>
        </div>
      )}

      {status === 'ready' && saved && (
        <div className="mt-4 space-y-4">
          <div className="bg-white p-4 md:p-6 rounded-xl shadow-sm border border-gray-100">
            <h1 className="text-2xl md:text-3xl font-bold text-gray-900 break-words">{saved.jobTitle}</h1>
            {saved.companyName && <p className="text-lg text-gray-600 break-words">{saved.companyName}</p>}
            <p className="text-sm text-gray-500 break-all">Resume: {saved.resumeFilename}</p>
            <p className="text-sm text-gray-500">Analyzed: {formatDateTime(saved.createdAt)}</p>
            <p className="text-xs text-gray-500 mt-2">
              This is the analysis as it was saved. It is not recalculated, so later changes to the resume or job description are
              not reflected here.
            </p>
          </div>
          <MatchResultView result={saved.result} />
        </div>
      )}
    </div>
  );
}
