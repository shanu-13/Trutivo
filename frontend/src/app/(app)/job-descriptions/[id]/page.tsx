"use client";

import { Suspense, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import JobRequirements from '@/components/JobRequirements';
import { DeleteJobDescriptionDialog } from '@/components/DeleteDialogs';
import { useRequireAuth } from '@/hooks/useRequireAuth';
import {
  deleteJobDescription,
  getJobDescription,
  processJobDescription,
  type JobDescription,
} from '@/lib/api/jobDescription.api';
import { formatDateTime } from '@/lib/format';

type ProcessStatus = 'idle' | 'processing' | 'completed' | 'failed';

function JobDescriptionDetailContent() {
  const { isAuthenticated, loading } = useRequireAuth();
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const saved = useSearchParams().get('saved') === '1';

  const [jobDescription, setJobDescription] = useState<JobDescription | null>(null);
  const [fetching, setFetching] = useState(true);
  const [error, setError] = useState('');
  const [deleting, setDeleting] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  // Blocks a second confirmation that arrives before the disabled button has rendered.
  const deletingRef = useRef(false);
  const [processStatus, setProcessStatus] = useState<ProcessStatus>('idle');
  const [processedText, setProcessedText] = useState('');
  const [processError, setProcessError] = useState('');

  useEffect(() => {
    if (!isAuthenticated || !id) return;
    let cancelled = false;
    getJobDescription(id)
      .then((data) => {
        if (!cancelled) setJobDescription(data.data.jobDescription);
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Failed to load job description');
      })
      .finally(() => {
        if (!cancelled) setFetching(false);
      });
    return () => {
      cancelled = true;
    };
  }, [isAuthenticated, id]);

  const handleDelete = async () => {
    if (!jobDescription || deletingRef.current) return;
    deletingRef.current = true;
    setDeleting(true);
    setError('');
    try {
      await deleteJobDescription(jobDescription.id);
      router.push('/job-descriptions?deleted=1');
    } catch (err: unknown) {
      deletingRef.current = false;
      setError(err instanceof Error ? err.message : 'Failed to delete job description');
      setDeleting(false);
      setConfirmingDelete(false);
    }
  };

  const handleProcess = async () => {
    if (!jobDescription) return;
    setProcessStatus('processing');
    setProcessError('');
    try {
      const data = await processJobDescription(jobDescription.id);
      setProcessedText(data.data.jobDescription.processedText);
      setProcessStatus('completed');
    } catch (err: unknown) {
      setProcessError(err instanceof Error ? err.message : 'Failed to process job description');
      setProcessStatus('failed');
    }
  };

  if (loading || (isAuthenticated && fetching)) {
    return <div className="p-8 text-center text-gray-600">Loading...</div>;
  }
  if (!isAuthenticated) return null;

  if (!jobDescription) {
    return (
      <div className="page-container p-4 md:p-8 text-center">
        <p className="text-gray-700 text-lg mb-6 whitespace-pre-line">{error || 'Job description not found'}</p>
        <Link href="/job-descriptions" className="text-blue-600 hover:text-blue-800 font-medium">
          Back to Job Descriptions
        </Link>
      </div>
    );
  }

  return (
    <div className="page-container p-4 md:p-8">
      <Link href="/job-descriptions" className="text-gray-500 hover:text-gray-800 text-sm">
        ← Back to Job Descriptions
      </Link>

      {saved && (
        <div className="bg-green-50 text-green-700 p-4 rounded-lg mt-4 text-sm font-medium border border-green-100">
          Job description saved successfully.
        </div>
      )}
      {error && (
        <div className="bg-red-50 text-red-600 p-4 rounded-lg mt-4 text-sm font-medium border border-red-100 whitespace-pre-line">
          {error}
        </div>
      )}

      <div className="bg-white p-6 md:p-8 rounded-xl shadow-sm border border-gray-100 mt-4">
        {/* Six actions: they sit under the title until there is room beside it, and wrap rather than squeeze the title. */}
        <div className="flex flex-col lg:flex-row lg:items-start justify-between gap-4 mb-6">
          <div className="min-w-0 lg:flex-1">
            <h1 className="text-2xl md:text-3xl font-bold text-gray-900 break-words">{jobDescription.title}</h1>
            {jobDescription.companyName && <p className="text-lg text-gray-600 break-words">{jobDescription.companyName}</p>}
            <p className="text-sm text-gray-500 mt-2">
              Created: {formatDateTime(jobDescription.createdAt)} · Updated: {formatDateTime(jobDescription.updatedAt)}
            </p>
          </div>
          <div className="flex flex-wrap gap-2 lg:max-w-md lg:justify-end">
            <Link
              href={`/job-descriptions/${jobDescription.id}/edit`}
              className="px-4 py-2 rounded-lg border border-gray-300 text-gray-800 hover:bg-gray-50 transition text-sm font-medium"
            >
              Edit
            </Link>
            <Link
              href={`/dashboard/match?jobDescriptionId=${jobDescription.id}`}
              className="px-4 py-2 rounded-lg border border-gray-300 text-gray-800 hover:bg-gray-50 transition text-sm font-medium"
            >
              Match Resume
            </Link>
            <Link
              href={`/dashboard/tailor?jobDescriptionId=${jobDescription.id}`}
              className="px-4 py-2 rounded-lg border border-gray-300 text-gray-800 hover:bg-gray-50 transition text-sm font-medium"
            >
              Tailor a Resume
            </Link>
            <Link
              href={`/dashboard/cover-letters/new?jobDescriptionId=${jobDescription.id}`}
              className="px-4 py-2 rounded-lg border border-gray-300 text-gray-800 hover:bg-gray-50 transition text-sm font-medium"
            >
              Write Cover Letter
            </Link>
            <Link
              href={`/dashboard/applications/new?jobDescriptionId=${jobDescription.id}`}
              className="px-4 py-2 rounded-lg border border-gray-300 text-gray-800 hover:bg-gray-50 transition text-sm font-medium"
            >
              Track Application
            </Link>
            <button
              onClick={() => setConfirmingDelete(true)}
              disabled={deleting}
              className="px-4 py-2 rounded-lg border border-red-200 text-red-600 hover:bg-red-50 disabled:opacity-50 transition text-sm font-medium"
            >
              {deleting ? 'Deleting...' : 'Delete'}
            </button>
            <button
              onClick={handleProcess}
              disabled={processStatus === 'processing'}
              className="px-4 py-2 rounded-lg bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50 transition text-sm font-medium"
            >
              {processStatus === 'processing' ? 'Processing...' : 'Process Description'}
            </button>
          </div>
        </div>

        {processStatus === 'completed' && (
          <div className="bg-green-50 text-green-700 p-4 rounded-lg mb-6 text-sm border border-green-100">
            <p className="font-medium">Job description processed successfully</p>
            <details className="mt-2">
              <summary className="cursor-pointer">Show processed text</summary>
              <p className="mt-2 text-gray-800 whitespace-pre-wrap break-words">{processedText}</p>
            </details>
          </div>
        )}
        {processStatus === 'failed' && (
          <div className="bg-red-50 text-red-600 p-4 rounded-lg mb-6 text-sm font-medium border border-red-100 whitespace-pre-line">
            {processError}
          </div>
        )}

        <h2 className="text-xs font-semibold uppercase tracking-wide text-gray-500 mb-2">Job Description</h2>
        <p className="text-gray-800 whitespace-pre-wrap break-words">{jobDescription.descriptionText}</p>
      </div>

      <JobRequirements jobDescriptionId={jobDescription.id} />

      <DeleteJobDescriptionDialog
        target={confirmingDelete ? jobDescription : null}
        busy={deleting}
        onConfirm={handleDelete}
        onCancel={() => setConfirmingDelete(false)}
      />
    </div>
  );
}

// useSearchParams (for the "saved" banner) must sit inside a Suspense boundary.
export default function JobDescriptionDetail() {
  return (
    <Suspense fallback={<div className="p-8 text-center text-gray-600">Loading...</div>}>
      <JobDescriptionDetailContent />
    </Suspense>
  );
}
