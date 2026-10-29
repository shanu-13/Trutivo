"use client";

import { useEffect, useRef, useState, type ReactNode } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useRequireAuth } from '@/hooks/useRequireAuth';
import { ApiError } from '@/lib/api/client';
import { deleteResume, extractResume, getResume, type ResumeSummary } from '@/lib/api/resume.api';
import { getJobDescriptionList, type JobDescriptionSummary } from '@/lib/api/jobDescription.api';
import { errorMessage, formatDateTime, formatFileSize } from '@/lib/format';
import { CURRENT_BADGE, canRetryExtraction, fileTypeLabel, isExtractionInProgress, resumeStatusInfo, sourceBadge, versionName } from '@/lib/resumeStatus';
import { downloadResumeFile, saveBlob } from '@/lib/api/export.api';
import StatusBadge from '@/components/StatusBadge';
import ResumeSkills from '@/components/ResumeSkills';
import ResumeSections from '@/components/ResumeSections';
import ResumeAnalysis from '@/components/ResumeAnalysis';
import ResumeJobMatch from '@/components/ResumeJobMatch';
import AtsReadiness from '@/components/AtsReadiness';
import { DeleteResumeDialog } from '@/components/DeleteDialogs';

const POLL_INTERVAL_MS = 3000;

function Panel({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="bg-white rounded-xl shadow-sm border border-gray-100 p-4 md:p-6" aria-labelledby={`panel-${title}`}>
      <h2 id={`panel-${title}`} className="text-lg font-bold text-gray-900 mb-3">
        {title}
      </h2>
      {children}
    </section>
  );
}

export default function ResumeDetail() {
  const { isAuthenticated, loading } = useRequireAuth();
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [resume, setResume] = useState<ResumeSummary | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [loadError, setLoadError] = useState('');
  const [actionError, setActionError] = useState('');
  const [reloadKey, setReloadKey] = useState(0);
  const [retrying, setRetrying] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  // Blocks a second confirmation that arrives before the disabled button has rendered.
  const deletingRef = useRef(false);
  const [jobDescriptions, setJobDescriptions] = useState<JobDescriptionSummary[] | null>(null);
  const [jobDescriptionsError, setJobDescriptionsError] = useState('');
  const [downloadingFile, setDownloadingFile] = useState(false);
  const downloadingRef = useRef(false);

  useEffect(() => {
    if (!isAuthenticated || !id) return;
    let cancelled = false;
    getResume(id)
      .then((data) => {
        if (cancelled) return;
        setResume(data.data.resume as ResumeSummary);
        setLoadError('');
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        if (err instanceof ApiError && err.status === 404) setNotFound(true);
        else setLoadError(errorMessage(err, 'Failed to load the resume'));
      });
    return () => {
      cancelled = true;
    };
  }, [isAuthenticated, id, reloadKey]);

  // Follow extraction until it finishes.
  const extracting = resume !== null && isExtractionInProgress(resume.extractionStatus);
  useEffect(() => {
    if (!extracting) return;
    const timer = setTimeout(() => setReloadKey((key) => key + 1), POLL_INTERVAL_MS);
    return () => clearTimeout(timer);
  }, [extracting, resume]);

  // Job descriptions for the matching panel, once the resume is ready.
  const ready = resume?.extractionStatus === 'completed';
  useEffect(() => {
    if (!ready) return;
    let cancelled = false;
    getJobDescriptionList()
      .then((items) => {
        if (!cancelled) setJobDescriptions(items);
      })
      .catch((err: unknown) => {
        if (!cancelled) setJobDescriptionsError(errorMessage(err, 'Failed to load your job descriptions'));
      });
    return () => {
      cancelled = true;
    };
  }, [ready]);

  const reload = () => {
    setLoadError('');
    setReloadKey((key) => key + 1);
  };

  const retryExtraction = async () => {
    if (!resume || retrying) return;
    setRetrying(true);
    setActionError('');
    try {
      await extractResume(resume.id);
    } catch (err: unknown) {
      setActionError(errorMessage(err, 'Failed to restart text extraction'));
    } finally {
      setRetrying(false);
      reload();
    }
  };

  const downloadFile = async () => {
    if (!resume || downloadingRef.current) return;
    downloadingRef.current = true;
    setDownloadingFile(true);
    setActionError('');
    try {
      const { blob, filename } = await downloadResumeFile(resume.id);
      saveBlob(blob, filename ?? 'resume');
    } catch (err: unknown) {
      setActionError(errorMessage(err, 'Failed to download the file'));
    } finally {
      downloadingRef.current = false;
      setDownloadingFile(false);
    }
  };

  const confirmDelete = async () => {
    if (!resume || deletingRef.current) return;
    deletingRef.current = true;
    setDeleting(true);
    setActionError('');
    try {
      await deleteResume(resume.id);
      router.push(resume.versionCount > 1 ? '/dashboard/resumes?deleted=version' : '/dashboard/resumes?deleted=1');
    } catch (err: unknown) {
      deletingRef.current = false;
      setActionError(errorMessage(err, 'Failed to delete the resume'));
      setDeleting(false);
      setConfirmingDelete(false);
    }
  };

  if (loading) return <div className="p-8 text-center text-gray-600">Loading...</div>;
  if (!isAuthenticated) return null;

  if (notFound || (!resume && loadError)) {
    return (
      <div className="page-container p-4 md:p-8 text-center space-y-4" role="alert">
        <p className="text-gray-700 text-lg whitespace-pre-line">{notFound ? 'Resume not found.' : loadError}</p>
        <div className="flex justify-center gap-4 font-medium">
          {!notFound && (
            <button onClick={reload} className="text-sm bg-gray-200 hover:bg-gray-300 px-3 py-1.5 rounded transition">
              Retry
            </button>
          )}
          <Link href="/dashboard/resumes" className="text-blue-600 hover:text-blue-800">
            Back to My Resumes
          </Link>
        </div>
      </div>
    );
  }

  if (!resume) {
    return (
      <div className="page-container p-4 md:p-8" role="status" aria-label="Loading resume">
        <div className="animate-pulse space-y-4">
          <div className="h-4 w-40 bg-gray-200 rounded" />
          <div className="h-32 bg-white border border-gray-100 rounded-xl" />
        </div>
      </div>
    );
  }

  const info = resumeStatusInfo(resume.extractionStatus);

  return (
    <div className="page-container p-4 md:p-8 space-y-6">
      <Link href="/dashboard/resumes" className="text-gray-500 hover:text-gray-800 text-sm">
        ← Back to My Resumes
      </Link>

      {actionError && (
        <p role="alert" className="bg-red-50 text-red-600 p-3 rounded-lg text-sm font-medium border border-red-100 whitespace-pre-line">
          {actionError}
        </p>
      )}

      <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-4 md:p-6">
        <div className="flex flex-col md:flex-row md:items-start justify-between gap-4">
          <div className="min-w-0 space-y-2">
            <h1 className="text-2xl md:text-3xl font-bold text-gray-900 break-all">{resume.originalFilename}</h1>
            <dl className="text-sm text-gray-600 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
              <dt className="text-gray-500">Version</dt>
              <dd className="flex flex-wrap items-center gap-2">
                <span>
                  {versionName(resume)}
                  {resume.versionCount > 1 && ` of ${resume.versionCount}`}
                </span>
                {resume.isCurrent && <StatusBadge {...CURRENT_BADGE} />}
                {sourceBadge(resume.sourceType) && <StatusBadge {...sourceBadge(resume.sourceType)!} />}
                <Link href={`/dashboard/resumes/${resume.id}/versions`} className="text-blue-600 hover:text-blue-800 font-medium">
                  Version history
                </Link>
              </dd>
              <dt className="text-gray-500">Uploaded</dt>
              <dd>{formatDateTime(resume.createdAt)}</dd>
              <dt className="text-gray-500">Size</dt>
              <dd>{formatFileSize(resume.fileSize)}</dd>
              <dt className="text-gray-500">Type</dt>
              <dd>{fileTypeLabel(resume.mimeType)}</dd>
              <dt className="text-gray-500">Status</dt>
              <dd className="flex flex-wrap items-center gap-2" aria-live="polite">
                <StatusBadge {...info} />
                <span>{info.description}</span>
              </dd>
            </dl>
          </div>
          <div className="flex flex-wrap gap-2 md:max-w-sm md:justify-end">
            {ready && (
              <Link
                href={`/dashboard/match?resumeId=${resume.id}`}
                className="px-4 py-2 rounded-lg bg-blue-600 text-white hover:bg-blue-700 transition text-sm font-medium"
              >
                Match with Job
              </Link>
            )}
            {ready && (
              <Link
                href={`/dashboard/resumes/${resume.id}/export`}
                className="px-4 py-2 rounded-lg border border-gray-300 text-gray-800 hover:bg-gray-50 transition text-sm font-medium"
              >
                Export PDF
              </Link>
            )}
            <button
              onClick={downloadFile}
              disabled={downloadingFile}
              className="px-4 py-2 rounded-lg border border-gray-300 text-gray-800 hover:bg-gray-50 disabled:opacity-50 transition text-sm font-medium"
            >
              {downloadingFile ? 'Downloading...' : 'Download File'}
            </button>
            {ready && (
              <Link
                href={`/dashboard/tailor?resumeId=${resume.id}`}
                className="px-4 py-2 rounded-lg border border-gray-300 text-gray-800 hover:bg-gray-50 transition text-sm font-medium"
              >
                Tailor for a Job
              </Link>
            )}
            {ready && (
              <Link
                href={`/dashboard/cover-letters/new?resumeId=${resume.id}`}
                className="px-4 py-2 rounded-lg border border-gray-300 text-gray-800 hover:bg-gray-50 transition text-sm font-medium"
              >
                Write Cover Letter
              </Link>
            )}
            <Link
              href={`/resume/upload?versionOf=${resume.id}`}
              className="px-4 py-2 rounded-lg border border-gray-300 text-gray-800 hover:bg-gray-50 transition text-sm font-medium"
            >
              Upload New Version
            </Link>
            <button
              onClick={() => setConfirmingDelete(true)}
              disabled={deleting}
              className="px-4 py-2 rounded-lg border border-red-200 text-red-600 hover:bg-red-50 disabled:opacity-50 transition text-sm font-medium"
            >
              Delete
            </button>
          </div>
        </div>

        {canRetryExtraction(resume.extractionStatus) && (
          <div className="mt-4 border-t pt-4">
            <button
              onClick={retryExtraction}
              disabled={retrying}
              className="text-sm bg-gray-200 hover:bg-gray-300 disabled:opacity-50 px-3 py-1.5 rounded transition"
            >
              {retrying ? 'Retrying...' : 'Retry Text Extraction'}
            </button>
          </div>
        )}
      </div>

      {extracting && (
        <p className="text-sm text-blue-700" role="status">
          Skills, sections and analysis become available once text extraction has finished.
        </p>
      )}

      {!extracting && (
        <Panel title="ATS Readiness">
          {/* Linked from the dashboard's "ATS checker" row. */}
          <div id="ats-readiness" className="scroll-mt-20">
            <AtsReadiness key={resume.id} resumeId={resume.id} jobDescriptions={ready ? jobDescriptions : []} />
          </div>
        </Panel>
      )}

      {ready && (
        <>
          <Panel title="Skills">
            <ResumeSkills resumeId={resume.id} skillsExtractedAt={resume.skillsExtractedAt} />
          </Panel>
          <Panel title="Resume Sections">
            <ResumeSections resumeId={resume.id} />
          </Panel>
          <Panel title="Resume Analysis">
            <p className="text-sm text-gray-500 mb-3">Experience, education, projects and certifications found in the resume.</p>
            <ResumeAnalysis resumeId={resume.id} />
          </Panel>
          <Panel title="Match With a Job">
            {jobDescriptionsError ? (
              <p className="text-sm text-red-600 whitespace-pre-line" role="alert">{jobDescriptionsError}</p>
            ) : jobDescriptions === null ? (
              <p className="text-sm text-gray-500" role="status">Loading job descriptions...</p>
            ) : (
              <ResumeJobMatch resumeId={resume.id} jobDescriptions={jobDescriptions} />
            )}
            <p className="text-sm text-gray-500 mt-3">
              Earlier results are in your{' '}
              <Link href="/dashboard/match-history" className="text-blue-600 hover:text-blue-800">
                match history
              </Link>
              .
            </p>
          </Panel>
        </>
      )}

      <DeleteResumeDialog
        target={confirmingDelete ? resume : null}
        busy={deleting}
        onConfirm={confirmDelete}
        onCancel={() => setConfirmingDelete(false)}
      />
    </div>
  );
}
