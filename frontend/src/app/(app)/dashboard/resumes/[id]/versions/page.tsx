"use client";

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useRequireAuth } from '@/hooks/useRequireAuth';
import { ApiError } from '@/lib/api/client';
import { deleteResume, getResumeVersions, makeCurrentVersion, type ResumeSummary } from '@/lib/api/resume.api';
import { errorMessage, formatDateTime, formatFileSize } from '@/lib/format';
import { CURRENT_BADGE, sourceBadge, isExtractionInProgress, resumeStatusInfo, versionName } from '@/lib/resumeStatus';
import StatusBadge from '@/components/StatusBadge';
import { DeleteResumeDialog } from '@/components/DeleteDialogs';

type Status = 'loading' | 'ready' | 'not_found' | 'error';

const POLL_INTERVAL_MS = 3000;
const selectClass =
  'w-full border border-gray-300 rounded-lg px-3 py-2 bg-white focus:outline-none focus:ring-2 focus:ring-blue-500';

function VersionSelect({ id, label, value, onChange, versions }: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  versions: ResumeSummary[];
}) {
  return (
    <div>
      <label htmlFor={id} className="block text-sm font-medium text-gray-800 mb-1">
        {label}
      </label>
      <select id={id} value={value} onChange={(e) => onChange(e.target.value)} className={selectClass}>
        <option value="">Select a version</option>
        {versions.map((v) => (
          <option key={v.id} value={v.id}>
            {versionName(v)}
          </option>
        ))}
      </select>
    </div>
  );
}

export default function ResumeVersions() {
  const { isAuthenticated, loading } = useRequireAuth();
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [versions, setVersions] = useState<ResumeSummary[]>([]);
  const [status, setStatus] = useState<Status>('loading');
  const [error, setError] = useState('');
  const [actionError, setActionError] = useState('');
  const [notice, setNotice] = useState('');
  const [reloadKey, setReloadKey] = useState(0);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [toDelete, setToDelete] = useState<ResumeSummary | null>(null);
  const [deleting, setDeleting] = useState(false);
  // Blocks a repeated action that arrives before the disabled button has rendered.
  const busyRef = useRef(false);
  const [compareA, setCompareA] = useState('');
  const [compareB, setCompareB] = useState('');

  useEffect(() => {
    if (!isAuthenticated || !id) return;
    let cancelled = false;
    getResumeVersions(id)
      .then((data) => {
        if (cancelled) return;
        setVersions(data.versions);
        setStatus('ready');
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        if (err instanceof ApiError && (err.status === 404 || err.status === 400)) setStatus('not_found');
        else {
          setError(errorMessage(err, 'Failed to load the version history'));
          setStatus('error');
        }
      });
    return () => {
      cancelled = true;
    };
  }, [isAuthenticated, id, reloadKey]);

  const extracting = versions.some((v) => isExtractionInProgress(v.extractionStatus));
  useEffect(() => {
    if (status !== 'ready' || !extracting) return;
    const timer = setTimeout(() => setReloadKey((key) => key + 1), POLL_INTERVAL_MS);
    return () => clearTimeout(timer);
  }, [status, extracting, versions]);

  const reload = () => setReloadKey((key) => key + 1);

  const makeCurrent = async (version: ResumeSummary) => {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusyId(version.id);
    setActionError('');
    setNotice('');
    try {
      await makeCurrentVersion(version.id);
      setNotice(`${versionName(version)} is now the current version.`);
      reload();
    } catch (err: unknown) {
      setActionError(errorMessage(err, 'Failed to change the current version'));
    } finally {
      busyRef.current = false;
      setBusyId(null);
    }
  };

  const confirmDelete = async () => {
    if (!toDelete || busyRef.current) return;
    busyRef.current = true;
    const target = toDelete;
    setDeleting(true);
    setActionError('');
    setNotice('');
    try {
      await deleteResume(target.id);
      const remaining = versions.filter((v) => v.id !== target.id);
      if (remaining.length === 0) {
        router.push('/dashboard/resumes?deleted=1');
        return;
      }
      setNotice(`${versionName(target)} was deleted. The other versions are kept.`);
      // This page's id may have been the deleted version.
      if (target.id === id) router.replace(`/dashboard/resumes/${remaining[0].id}/versions`);
      else reload();
    } catch (err: unknown) {
      setActionError(errorMessage(err, 'Failed to delete the version'));
    } finally {
      busyRef.current = false;
      setDeleting(false);
      setToDelete(null);
    }
  };

  if (loading) return <div className="p-8 text-center text-gray-600">Loading...</div>;
  if (!isAuthenticated) return null;

  if (status === 'not_found') {
    return (
      <div className="page-container p-4 md:p-8 text-center space-y-4" role="alert">
        <p className="text-gray-700 text-lg">Resume not found.</p>
        <Link href="/dashboard/resumes" className="text-blue-600 hover:text-blue-800 font-medium">
          Back to My Resumes
        </Link>
      </div>
    );
  }

  const current = versions.find((v) => v.isCurrent) ?? null;
  // Only versions with extracted text have data to compare.
  const comparable = versions.filter((v) => v.extractionStatus === 'completed');
  const canCompare = compareA && compareB && compareA !== compareB;
  const title = (current ?? versions[0])?.originalFilename;

  return (
    <div className="page-container p-4 md:p-8 space-y-6">
      <Link href="/dashboard/resumes" className="text-gray-500 hover:text-gray-800 text-sm">
        ← Back to My Resumes
      </Link>

      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div className="min-w-0">
          <h1 className="text-3xl font-bold mb-1">Version History</h1>
          {title && <p className="text-gray-600 break-all">{title}</p>}
        </div>
        {versions.length > 0 && (
          <Link
            href={`/resume/upload?versionOf=${versions[0].id}`}
            className="bg-blue-600 text-white px-5 py-2.5 rounded-lg hover:bg-blue-700 transition font-medium text-center whitespace-nowrap"
          >
            Upload New Version
          </Link>
        )}
      </div>

      {notice && (
        <p role="status" className="bg-green-50 text-green-700 p-3 rounded-lg text-sm font-medium border border-green-100 break-words">
          {notice}
        </p>
      )}
      {actionError && (
        <p role="alert" className="bg-red-50 text-red-600 p-3 rounded-lg text-sm font-medium border border-red-100 whitespace-pre-line">
          {actionError}
        </p>
      )}

      <section className="bg-white rounded-xl shadow-sm border border-gray-100 p-4 md:p-6" aria-labelledby="versions-heading">
        <h2 id="versions-heading" className="text-lg font-bold text-gray-900 mb-1">
          Versions
        </h2>
        <p className="text-sm text-gray-500 mb-3">
          Newest first. The current version is the newest one whose text was extracted, unless you choose another.
          {versions.length > 0 && !current && ' No version is current yet.'}
        </p>

        {status === 'loading' && (
          <div className="animate-pulse space-y-3" role="status" aria-label="Loading versions">
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
                reload();
              }}
              className="text-sm bg-gray-200 hover:bg-gray-300 px-3 py-1.5 rounded transition"
            >
              Retry
            </button>
          </div>
        )}

        {status === 'ready' && (
          <ol className="divide-y divide-gray-100">
            {versions.map((v) => {
              const info = resumeStatusInfo(v.extractionStatus);
              return (
                <li key={v.id} className="py-4 flex flex-col md:flex-row md:items-center justify-between gap-3">
                  <div className="min-w-0 space-y-1">
                    <p className="font-semibold text-gray-900 break-words">{versionName(v)}</p>
                    <p className="text-sm text-gray-700 break-all">{v.originalFilename}</p>
                    <div className="flex flex-wrap items-center gap-2 text-sm text-gray-500">
                      <StatusBadge {...info} />
                      {v.isCurrent && <StatusBadge {...CURRENT_BADGE} />}
                      {sourceBadge(v.sourceType) && <StatusBadge {...sourceBadge(v.sourceType)!} />}
                      <span>
                        Uploaded {formatDateTime(v.createdAt)} · {formatFileSize(v.fileSize)}
                      </span>
                    </div>
                    {v.extractionStatus !== 'completed' && <p className="text-sm text-gray-600">{info.description}</p>}
                  </div>
                  <div className="flex flex-wrap gap-x-4 gap-y-2 shrink-0 text-sm font-medium">
                    <Link href={`/dashboard/resumes/${v.id}`} className="text-blue-600 hover:text-blue-800 py-1">
                      View
                    </Link>
                    {!v.isCurrent && v.extractionStatus === 'completed' && (
                      <button
                        onClick={() => makeCurrent(v)}
                        disabled={busyId !== null || deleting}
                        className="text-blue-600 hover:text-blue-800 disabled:opacity-50 py-1"
                      >
                        {busyId === v.id ? 'Updating...' : 'Make Current'}
                      </button>
                    )}
                    <button
                      onClick={() => setToDelete(v)}
                      disabled={busyId !== null || deleting}
                      className="text-red-600 hover:text-red-800 disabled:opacity-50 py-1"
                    >
                      Delete
                    </button>
                  </div>
                </li>
              );
            })}
          </ol>
        )}
      </section>

      {status === 'ready' && (
        <section className="bg-white rounded-xl shadow-sm border border-gray-100 p-4 md:p-6" aria-labelledby="compare-heading">
          <h2 id="compare-heading" className="text-lg font-bold text-gray-900 mb-1">
            Compare Versions
          </h2>
          {comparable.length < 2 ? (
            <p className="text-sm text-gray-600">
              {versions.length < 2
                ? 'There is only one version so far. Upload a new version to compare them.'
                : 'At least two versions with extracted text are needed for a comparison.'}
            </p>
          ) : (
            <form
              className="space-y-3"
              onSubmit={(e) => {
                e.preventDefault();
                if (canCompare) router.push(`/dashboard/resumes/${compareA}/compare/${compareB}`);
              }}
            >
              <p className="text-sm text-gray-500">Choose two versions of this resume. Only versions with extracted text are listed.</p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <VersionSelect id="compare-a" label="First version" value={compareA} onChange={setCompareA} versions={comparable} />
                <VersionSelect id="compare-b" label="Second version" value={compareB} onChange={setCompareB} versions={comparable} />
              </div>
              {compareA && compareA === compareB && <p className="text-sm text-red-600">Choose two different versions.</p>}
              <button
                type="submit"
                disabled={!canCompare}
                className="text-sm bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed px-4 py-2 rounded-lg transition"
              >
                Compare
              </button>
            </form>
          )}
        </section>
      )}

      <DeleteResumeDialog
        target={toDelete ? { ...toDelete, versionCount: versions.length } : null}
        busy={deleting}
        onConfirm={confirmDelete}
        onCancel={() => setToDelete(null)}
      />
    </div>
  );
}
