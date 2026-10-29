"use client";

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRequireAuth } from '@/hooks/useRequireAuth';
import {
  deleteMatchHistoryItem,
  getMatchHistory,
  type MatchHistoryPagination,
  type MatchHistorySummary,
} from '@/lib/api/matchHistory.api';
import { formatDate } from '@/lib/format';

type Status = 'loading' | 'ready' | 'error';

const errorMessage = (err: unknown, fallback: string) => (err instanceof Error && err.message ? err.message : fallback);

export default function MatchHistory() {
  const { isAuthenticated, loading } = useRequireAuth();
  const [page, setPage] = useState(1);
  const [items, setItems] = useState<MatchHistorySummary[]>([]);
  const [pagination, setPagination] = useState<MatchHistoryPagination | null>(null);
  const [status, setStatus] = useState<Status>('loading');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [deletingId, setDeletingId] = useState<string | null>(null);

  // Bumped to refetch the current page (retry, after a deletion).
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    if (!isAuthenticated) return;
    let cancelled = false;
    getMatchHistory(page)
      .then((data) => {
        if (cancelled) return;
        const { items: pageItems, pagination: meta } = data.data as { items: MatchHistorySummary[]; pagination: MatchHistoryPagination };
        // A page emptied by deletions: show the last page that still has results.
        if (pageItems.length === 0 && page > 1 && meta.totalPages > 0) {
          setPage(Math.min(page - 1, meta.totalPages));
          return;
        }
        setItems(pageItems);
        setPagination(meta);
        setStatus('ready');
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setError(errorMessage(err, 'Failed to load match history'));
        setStatus('error');
      });
    return () => {
      cancelled = true;
    };
  }, [isAuthenticated, page, reloadKey]);

  const reload = () => {
    setStatus('loading');
    setReloadKey((key) => key + 1);
  };

  const goToPage = (target: number) => {
    setStatus('loading');
    setNotice('');
    setPage(target);
  };

  const retry = () => {
    setError('');
    reload();
  };

  const handleDelete = async (item: MatchHistorySummary) => {
    if (!confirm(`Delete the saved analysis for "${item.jobTitle}"?\n\nThe resume and job description are not deleted.`)) return;
    setDeletingId(item.id);
    setNotice('');
    setError('');
    try {
      await deleteMatchHistoryItem(item.id);
      // Only reported once the server has confirmed the deletion.
      setNotice('Saved analysis deleted.');
      reload();
    } catch (err: unknown) {
      setError(errorMessage(err, 'Failed to delete the saved analysis'));
    } finally {
      setDeletingId(null);
    }
  };

  if (loading) return <div className="p-8 text-center text-gray-600">Loading...</div>;
  if (!isAuthenticated) return null;

  const totalPages = pagination?.totalPages ?? 0;

  return (
    <div className="page-container p-4 md:p-8">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3 mb-6">
        <div>
          <h1 className="text-3xl font-bold mb-1">Match History</h1>
          <p className="text-gray-600">Your saved resume-job analyses, newest first.</p>
        </div>
        <Link href="/dashboard" className="text-blue-600 hover:text-blue-800 font-medium whitespace-nowrap">
          Run a new match
        </Link>
      </div>

      {notice && (
        <p role="status" className="bg-green-50 text-green-700 p-3 rounded-lg mb-4 text-sm font-medium border border-green-100">
          {notice}
        </p>
      )}
      {error && status !== 'error' && (
        <p role="alert" className="bg-red-50 text-red-600 p-3 rounded-lg mb-4 text-sm font-medium border border-red-100 whitespace-pre-line">
          {error}
        </p>
      )}

      <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-4 md:p-6">
        {status === 'loading' && (
          <p className="text-gray-500" role="status">Loading match history...</p>
        )}

        {status === 'error' && (
          <div role="alert" className="space-y-3">
            <p className="text-red-600 font-medium whitespace-pre-line">{error}</p>
            <button onClick={retry} className="text-sm bg-gray-200 hover:bg-gray-300 px-3 py-1 rounded transition">
              Retry
            </button>
          </div>
        )}

        {status === 'ready' && items.length === 0 && (
          <div className="text-center py-10">
            <p className="text-gray-700 text-lg mb-2">No match history yet.</p>
            <p className="text-gray-500 mb-6">Run a resume-job analysis to see your results here.</p>
            <Link href="/dashboard" className="bg-blue-600 text-white px-5 py-2.5 rounded-lg hover:bg-blue-700 transition font-medium">
              Go to Dashboard
            </Link>
          </div>
        )}

        {status === 'ready' && items.length > 0 && (
          <ul className="divide-y divide-gray-100">
            {items.map((item) => (
              <li key={item.id} className="py-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="font-semibold text-gray-900 break-words">{item.jobTitle}</p>
                  {item.companyName && <p className="text-gray-600 break-words">{item.companyName}</p>}
                  <p className="text-sm text-gray-500 break-all">Resume: {item.resumeFilename}</p>
                  <p className="text-sm text-gray-500">
                    Match Score:{' '}
                    <span className="font-medium text-gray-800">
                      {item.overallScore === null ? 'Not available' : `${item.overallScore.toFixed(2)}%`}
                    </span>
                    {' · '}Analyzed: {formatDate(item.createdAt)}
                  </p>
                </div>
                <div className="flex gap-4 shrink-0 text-sm font-medium">
                  <Link href={`/dashboard/match-history/${item.id}`} className="text-blue-600 hover:text-blue-800">
                    View Analysis
                  </Link>
                  <button
                    onClick={() => handleDelete(item)}
                    disabled={deletingId === item.id}
                    className="text-red-700 hover:text-red-700 disabled:opacity-50"
                  >
                    {deletingId === item.id ? 'Deleting...' : 'Delete'}
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}

        {status === 'ready' && totalPages > 1 && (
          <nav aria-label="Match history pages" className="flex items-center justify-between gap-3 pt-4 mt-2 border-t border-gray-100">
            <button
              onClick={() => goToPage(Math.max(page - 1, 1))}
              disabled={page <= 1}
              className="text-sm px-3 py-1 rounded border border-gray-300 disabled:opacity-40"
            >
              Previous
            </button>
            <span className="text-sm text-gray-600">
              Page {page} of {totalPages} · {pagination?.total} saved
            </span>
            <button
              onClick={() => goToPage(Math.min(page + 1, totalPages))}
              disabled={page >= totalPages}
              className="text-sm px-3 py-1 rounded border border-gray-300 disabled:opacity-40"
            >
              Next
            </button>
          </nav>
        )}
      </div>
    </div>
  );
}
