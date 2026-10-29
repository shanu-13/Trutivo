"use client";

import { Suspense, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useRequireAuth } from '@/hooks/useRequireAuth';
import { deleteJobDescription, getJobDescriptionList, type JobDescriptionSummary } from '@/lib/api/jobDescription.api';
import { errorMessage, formatDate } from '@/lib/format';
import StatusBadge from '@/components/StatusBadge';
import ListSearch, { matchesSearch } from '@/components/ListSearch';
import { DeleteJobDescriptionDialog } from '@/components/DeleteDialogs';

type Status = 'loading' | 'ready' | 'error';

// Requirements are either stored (extracted) or not; failed extractions are not
// recorded, so there is no "failed" state to show here.
const requirementsBadge = (jd: JobDescriptionSummary) =>
  jd.requirementsExtractedAt
    ? { label: 'Requirements extracted', symbol: '✓', tone: 'bg-green-50 text-green-800 border-green-200' }
    : { label: 'Requirements not extracted', symbol: '○', tone: 'bg-gray-50 text-gray-700 border-gray-200' };

function JobDescriptionsContent() {
  const { isAuthenticated, loading } = useRequireAuth();
  const deletedFromDetail = useSearchParams().get('deleted') === '1';
  const [jobDescriptions, setJobDescriptions] = useState<JobDescriptionSummary[]>([]);
  const [status, setStatus] = useState<Status>('loading');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState(deletedFromDetail ? 'Job description deleted.' : '');
  const [query, setQuery] = useState('');
  const [toDelete, setToDelete] = useState<JobDescriptionSummary | null>(null);
  const [deleting, setDeleting] = useState(false);
  // Blocks a second confirmation that arrives before the disabled button has rendered.
  const deletingRef = useRef(false);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    if (!isAuthenticated) return;
    let cancelled = false;
    getJobDescriptionList()
      .then((items) => {
        if (cancelled) return;
        setJobDescriptions(items);
        setStatus('ready');
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setError(errorMessage(err, 'Failed to load job descriptions'));
        setStatus('error');
      });
    return () => {
      cancelled = true;
    };
  }, [isAuthenticated, reloadKey]);

  const retry = () => {
    setStatus('loading');
    setError('');
    setReloadKey((key) => key + 1);
  };

  const confirmDelete = async () => {
    if (!toDelete || deletingRef.current) return;
    deletingRef.current = true;
    const target = toDelete;
    setDeleting(true);
    setNotice('');
    setError('');
    try {
      await deleteJobDescription(target.id);
      // Removed only once the server has confirmed the deletion.
      setJobDescriptions((current) => current.filter((item) => item.id !== target.id));
      setNotice(`"${target.title}" was deleted.`);
    } catch (err: unknown) {
      setError(errorMessage(err, 'Failed to delete job description'));
    } finally {
      deletingRef.current = false;
      setDeleting(false);
      setToDelete(null);
    }
  };

  if (loading) {
    return <div className="p-8 text-center text-gray-600">Loading...</div>;
  }
  if (!isAuthenticated) return null;

  const visible = jobDescriptions.filter((jd) => matchesSearch(query, jd.title, jd.companyName));

  return (
    <div className="page-container p-4 md:p-8">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center mb-6 gap-4">
        <div>
          <h1 className="text-3xl font-bold mb-1">Job Descriptions</h1>
          <p className="text-gray-600">Save the roles you want to compare your resumes against.</p>
        </div>
        <Link
          href="/job-descriptions/create"
          className="bg-blue-600 text-white px-5 py-2.5 rounded-lg hover:bg-blue-700 transition font-medium text-center whitespace-nowrap"
        >
          + Add Job Description
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
          <div className="animate-pulse space-y-4" role="status" aria-label="Loading job descriptions">
            {[0, 1, 2].map((i) => (
              <div key={i} className="h-16 bg-gray-100 rounded-lg" />
            ))}
          </div>
        )}

        {status === 'error' && (
          <div role="alert" className="space-y-3">
            <p className="text-red-600 font-medium whitespace-pre-line">{error}</p>
            <button onClick={retry} className="text-sm bg-gray-200 hover:bg-gray-300 px-3 py-1.5 rounded transition">
              Retry
            </button>
          </div>
        )}

        {status === 'ready' && jobDescriptions.length === 0 && (
          <div className="text-center py-10">
            <p className="text-gray-700 text-lg mb-2">No job descriptions saved yet.</p>
            <p className="text-gray-500 mb-6">Add a job description to compare it with your resume.</p>
            <Link href="/job-descriptions/create" className="bg-blue-600 text-white px-5 py-2.5 rounded-lg hover:bg-blue-700 transition font-medium">
              Add Job Description
            </Link>
          </div>
        )}

        {status === 'ready' && jobDescriptions.length > 0 && (
          <>
            <ListSearch
              label="Search job descriptions by title or company"
              placeholder="Search by title or company"
              value={query}
              onChange={setQuery}
              shown={visible.length}
              total={jobDescriptions.length}
            />
            {visible.length === 0 ? (
              <div className="text-center py-8">
                <p className="text-gray-700 mb-3">No job descriptions match &ldquo;{query.trim()}&rdquo;.</p>
                <button onClick={() => setQuery('')} className="text-sm font-medium text-blue-600 hover:text-blue-800">
                  Clear search
                </button>
              </div>
            ) : (
              <ul className="divide-y divide-gray-100">
                {visible.map((jd) => (
                  <li key={jd.id} className="py-4 flex flex-col md:flex-row md:items-center justify-between gap-3">
                    <div className="min-w-0 space-y-1">
                      <Link href={`/job-descriptions/${jd.id}`} className="font-semibold text-gray-900 hover:text-blue-700 break-words">
                        {jd.title}
                      </Link>
                      {jd.companyName && <p className="text-gray-600 break-words">{jd.companyName}</p>}
                      <div className="flex flex-wrap items-center gap-2 text-sm text-gray-500">
                        <StatusBadge {...requirementsBadge(jd)} />
                        <span>
                          Created: {formatDate(jd.createdAt)}
                          {formatDate(jd.updatedAt) !== formatDate(jd.createdAt) && <> · Updated: {formatDate(jd.updatedAt)}</>}
                        </span>
                      </div>
                    </div>
                    <div className="flex flex-wrap gap-x-4 gap-y-2 shrink-0 text-sm font-medium">
                      <Link href={`/job-descriptions/${jd.id}`} className="text-blue-600 hover:text-blue-800 py-1">
                        View
                      </Link>
                      <Link href={`/job-descriptions/${jd.id}/edit`} className="text-blue-600 hover:text-blue-800 py-1">
                        Edit
                      </Link>
                      <Link href={`/dashboard/match?jobDescriptionId=${jd.id}`} className="text-blue-600 hover:text-blue-800 py-1">
                        Match Resume
                      </Link>
                      <button
                        onClick={() => setToDelete(jd)}
                        disabled={deleting}
                        className="text-red-600 hover:text-red-800 disabled:opacity-50 py-1"
                      >
                        Delete
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
      </div>

      <DeleteJobDescriptionDialog target={toDelete} busy={deleting} onConfirm={confirmDelete} onCancel={() => setToDelete(null)} />
    </div>
  );
}

// useSearchParams (for the "deleted" notice) must sit inside a Suspense boundary.
export default function JobDescriptions() {
  return (
    <Suspense fallback={<div className="p-8 text-center text-gray-600">Loading...</div>}>
      <JobDescriptionsContent />
    </Suspense>
  );
}
