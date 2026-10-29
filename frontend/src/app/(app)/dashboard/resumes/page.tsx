"use client";

import { Suspense, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useRequireAuth } from '@/hooks/useRequireAuth';
import { deleteResume, getResumeList, type ResumeSummary } from '@/lib/api/resume.api';
import { errorMessage, formatDate, formatFileSize } from '@/lib/format';
import { CURRENT_BADGE, sourceBadge, fileTypeLabel, isExtractionInProgress, resumeStatusInfo, versionName } from '@/lib/resumeStatus';
import StatusBadge from '@/components/StatusBadge';
import ListSearch, { matchesSearch } from '@/components/ListSearch';
import { DeleteResumeDialog } from '@/components/DeleteDialogs';

type Status = 'loading' | 'ready' | 'error';

// While a resume is still being extracted, the list is refreshed this often.
const POLL_INTERVAL_MS = 4000;

// One entry per resume: all its versions, shown through the current version
// (or the newest one while none is current yet). `resumes` is newest first.
const groupVersions = (resumes: ResumeSummary[]) => {
  const groups = new Map<string, ResumeSummary[]>();
  for (const r of resumes) groups.set(r.resumeGroupId, [...(groups.get(r.resumeGroupId) ?? []), r]);
  return [...groups.values()].map((versions) => {
    const sorted = [...versions].sort((a, b) => b.versionNumber - a.versionNumber);
    return { shown: sorted.find((v) => v.isCurrent) ?? sorted[0], versions: sorted };
  });
};

function ResumesContent() {
  const { isAuthenticated, loading } = useRequireAuth();
  const deletedFromDetail = useSearchParams().get('deleted');
  const [resumes, setResumes] = useState<ResumeSummary[]>([]);
  const [status, setStatus] = useState<Status>('loading');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState(
    deletedFromDetail === 'version' ? 'Version deleted. The other versions are kept.' : deletedFromDetail === '1' ? 'Resume deleted.' : ''
  );
  const [query, setQuery] = useState('');
  const [toDelete, setToDelete] = useState<ResumeSummary | null>(null);
  const [deleting, setDeleting] = useState(false);
  // Blocks a second confirmation that arrives before the disabled button has rendered.
  const deletingRef = useRef(false);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    if (!isAuthenticated) return;
    let cancelled = false;
    getResumeList()
      .then((items) => {
        if (cancelled) return;
        setResumes(items);
        setStatus('ready');
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setError(errorMessage(err, 'Failed to load your resumes'));
        setStatus('error');
      });
    return () => {
      cancelled = true;
    };
  }, [isAuthenticated, reloadKey]);

  const extracting = resumes.some((r) => isExtractionInProgress(r.extractionStatus));
  useEffect(() => {
    if (status !== 'ready' || !extracting) return;
    const timer = setTimeout(() => setReloadKey((key) => key + 1), POLL_INTERVAL_MS);
    return () => clearTimeout(timer);
  }, [status, extracting, resumes]);

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
      await deleteResume(target.id);
      // Removed only once the server has confirmed the deletion.
      setResumes((current) => current.filter((r) => r.id !== target.id));
      setNotice(`"${target.originalFilename}" was deleted.`);
      // Another version may have become current.
      if (target.versionCount > 1) setReloadKey((key) => key + 1);
    } catch (err: unknown) {
      setError(errorMessage(err, 'Failed to delete the resume'));
    } finally {
      deletingRef.current = false;
      setDeleting(false);
      setToDelete(null);
    }
  };

  if (loading) return <div className="p-8 text-center text-gray-600">Loading...</div>;
  if (!isAuthenticated) return null;

  const groups = groupVersions(resumes);
  const visible = groups.filter((g) => g.versions.some((v) => matchesSearch(query, v.originalFilename)));

  return (
    <div className="page-container p-4 md:p-8">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 mb-6">
        <div>
          <h1 className="text-3xl font-bold mb-1">My Resumes</h1>
          <p className="text-gray-600">Your uploaded resumes and their processing status.</p>
        </div>
        <Link
          href="/resume/upload"
          className="bg-blue-600 text-white px-5 py-2.5 rounded-lg hover:bg-blue-700 transition font-medium text-center whitespace-nowrap"
        >
          Upload Resume
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
          <div className="animate-pulse space-y-4" role="status" aria-label="Loading resumes">
            {[0, 1, 2].map((i) => (
              <div key={i} className="h-20 bg-gray-100 rounded-lg" />
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

        {status === 'ready' && resumes.length === 0 && (
          <div className="text-center py-10">
            <p className="text-gray-700 text-lg mb-2">No resumes uploaded yet.</p>
            <p className="text-gray-500 mb-6">Upload your resume to start analyzing your skills and experience.</p>
            <Link href="/resume/upload" className="bg-blue-600 text-white px-5 py-2.5 rounded-lg hover:bg-blue-700 transition font-medium">
              Upload Resume
            </Link>
          </div>
        )}

        {status === 'ready' && resumes.length > 0 && (
          <>
            <ListSearch
              label="Search resumes by filename"
              placeholder="Search by filename"
              value={query}
              onChange={setQuery}
              shown={visible.length}
              total={groups.length}
            />
            {visible.length === 0 ? (
              <div className="text-center py-8">
                <p className="text-gray-700 mb-3">No resumes match &ldquo;{query.trim()}&rdquo;.</p>
                <button onClick={() => setQuery('')} className="text-sm font-medium text-blue-600 hover:text-blue-800">
                  Clear search
                </button>
              </div>
            ) : (
              <ul className="divide-y divide-gray-100">
                {visible.map(({ shown: resume, versions }) => {
                  const info = resumeStatusInfo(resume.extractionStatus);
                  const ready = resume.extractionStatus === 'completed';
                  const newest = versions[0];
                  return (
                    <li key={resume.resumeGroupId} className="py-4 flex flex-col md:flex-row md:items-center justify-between gap-3">
                      <div className="min-w-0 space-y-1">
                        <Link
                          href={`/dashboard/resumes/${resume.id}`}
                          className="font-semibold text-gray-900 hover:text-blue-700 break-all"
                        >
                          {resume.originalFilename}
                        </Link>
                        <div className="flex flex-wrap items-center gap-2">
                          <StatusBadge {...info} />
                          {resume.isCurrent && <StatusBadge {...CURRENT_BADGE} />}
                          {sourceBadge(resume.sourceType) && <StatusBadge {...sourceBadge(resume.sourceType)!} />}
                          <span className="text-sm text-gray-600">
                            {versionName(resume)}
                            {versions.length > 1 && ` of ${versions.length}`}
                          </span>
                        </div>
                        <p className="text-sm text-gray-600">{info.description}</p>
                        {newest.id !== resume.id && (
                          <p className="text-sm text-gray-600">
                            Newest upload: Version {newest.versionNumber} ({resumeStatusInfo(newest.extractionStatus).label})
                          </p>
                        )}
                        <p className="text-sm text-gray-500">
                          Uploaded: {formatDate(resume.createdAt)} · {formatFileSize(resume.fileSize)} · {fileTypeLabel(resume.mimeType)}
                          {ready && (
                            <>
                              {' · '}
                              {resume.skillsExtractedAt ? `Skills extracted ${formatDate(resume.skillsExtractedAt)}` : 'Skills not extracted yet'}
                            </>
                          )}
                        </p>
                      </div>
                      <div className="flex flex-wrap gap-x-4 gap-y-2 shrink-0 text-sm font-medium md:max-w-xs md:justify-end">
                        <Link href={`/dashboard/resumes/${resume.id}`} className="text-blue-600 hover:text-blue-800 py-1">
                          View Details
                        </Link>
                        <Link href={`/dashboard/resumes/${resume.id}/versions`} className="text-blue-600 hover:text-blue-800 py-1">
                          {versions.length > 1 ? `Versions (${versions.length})` : 'Versions'}
                        </Link>
                        <Link href={`/resume/upload?versionOf=${resume.id}`} className="text-blue-600 hover:text-blue-800 py-1">
                          Upload New Version
                        </Link>
                        {ready && (
                          <Link href={`/dashboard/match?resumeId=${resume.id}`} className="text-blue-600 hover:text-blue-800 py-1">
                            Match with Job
                          </Link>
                        )}
                        {ready && (
                          <Link href={`/dashboard/tailor?resumeId=${resume.id}`} className="text-blue-600 hover:text-blue-800 py-1">
                            Tailor for Job
                          </Link>
                        )}
                        <button
                          onClick={() => setToDelete(resume)}
                          disabled={deleting}
                          className="text-red-600 hover:text-red-800 disabled:opacity-50 py-1"
                        >
                          {versions.length > 1 ? 'Delete This Version' : 'Delete'}
                        </button>
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </>
        )}
      </div>

      <DeleteResumeDialog target={toDelete} busy={deleting} onConfirm={confirmDelete} onCancel={() => setToDelete(null)} />
    </div>
  );
}

// useSearchParams (for the "deleted" notice) must sit inside a Suspense boundary.
export default function Resumes() {
  return (
    <Suspense fallback={<div className="p-8 text-center text-gray-600">Loading...</div>}>
      <ResumesContent />
    </Suspense>
  );
}
