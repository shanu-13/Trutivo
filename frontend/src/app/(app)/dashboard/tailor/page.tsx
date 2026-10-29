"use client";

import { Suspense, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useRequireAuth } from '@/hooks/useRequireAuth';
import { ApiError } from '@/lib/api/client';
import { getResumeList, type ResumeSummary } from '@/lib/api/resume.api';
import { getJobDescriptionList, type JobDescriptionSummary } from '@/lib/api/jobDescription.api';
import { createTailoring, listTailoring, type TailoringSessionListItem } from '@/lib/api/tailoring.api';
import { errorMessage, formatDate, formatDateTime } from '@/lib/format';
import { versionName } from '@/lib/resumeStatus';

type Status = 'loading' | 'ready' | 'error';

const selectClass =
  'w-full border border-gray-300 rounded-lg px-3 py-2 bg-white focus:outline-none focus:ring-2 focus:ring-blue-500';

// Choose a processed resume and a job description with extracted requirements,
// then generate rule-based tailoring suggestions for review.
function TailorContent() {
  const { isAuthenticated, loading } = useRequireAuth();
  const params = useSearchParams();
  const router = useRouter();
  const [resumes, setResumes] = useState<ResumeSummary[]>([]);
  const [jobs, setJobs] = useState<JobDescriptionSummary[]>([]);
  const [status, setStatus] = useState<Status>('loading');
  const [error, setError] = useState('');
  const [reloadKey, setReloadKey] = useState(0);
  const [resumeId, setResumeId] = useState<string | null>(null);
  const [jobId, setJobId] = useState<string | null>(null);
  const [generating, setGenerating] = useState(false);
  const [generateError, setGenerateError] = useState<{ message: string; code: string | null } | null>(null);
  const [sessions, setSessions] = useState<TailoringSessionListItem[] | null>(null);
  // Blocks a second click that arrives before the disabled button has rendered.
  const generatingRef = useRef(false);

  useEffect(() => {
    if (!isAuthenticated) return;
    let cancelled = false;
    Promise.all([getResumeList(), getJobDescriptionList()])
      .then(([r, j]) => {
        if (cancelled) return;
        setResumes(r);
        setJobs(j);
        setStatus('ready');
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setError(errorMessage(err, 'Failed to load your resumes and job descriptions'));
        setStatus('error');
      });
    return () => {
      cancelled = true;
    };
  }, [isAuthenticated, reloadKey]);

  const ready = resumes.filter((r) => r.extractionStatus === 'completed');
  const usableJobs = jobs.filter((j) => j.requirementsExtractedAt);
  // URL preselections count only when they are among the user's own usable items.
  const selectedResume = resumeId ?? (ready.some((r) => r.id === params.get('resumeId')) ? params.get('resumeId')! : '');
  const selectedJob = jobId ?? (usableJobs.some((j) => j.id === params.get('jobDescriptionId')) ? params.get('jobDescriptionId')! : '');

  useEffect(() => {
    if (!selectedResume) return;
    let cancelled = false;
    listTailoring(selectedResume)
      .then((items) => {
        if (!cancelled) setSessions(items);
      })
      .catch(() => {
        if (!cancelled) setSessions([]);
      });
    return () => {
      cancelled = true;
    };
  }, [selectedResume]);

  const generate = async () => {
    if (!selectedResume || !selectedJob || generatingRef.current) return;
    generatingRef.current = true;
    setGenerating(true);
    setGenerateError(null);
    try {
      const session = await createTailoring(selectedResume, selectedJob);
      router.push(`/dashboard/resumes/${selectedResume}/tailoring/${session.id}`);
    } catch (err: unknown) {
      setGenerateError({ message: errorMessage(err, 'Failed to generate suggestions'), code: err instanceof ApiError ? err.code : null });
      generatingRef.current = false;
      setGenerating(false);
    }
  };

  if (loading) return <div className="p-8 text-center text-gray-600">Loading...</div>;
  if (!isAuthenticated) return null;

  return (
    <div className="page-container p-4 md:p-8 space-y-6">
      <div>
        <h1 className="text-3xl font-bold mb-1">Tailor a Resume for a Job</h1>
        <p className="text-gray-600">
          Get suggestions for making one of your resumes more relevant to a saved job. You review every suggestion; your
          original resume is never changed.
        </p>
      </div>

      <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-4 md:p-6 space-y-6">
        {status === 'loading' && (
          <div className="animate-pulse space-y-4" role="status" aria-label="Loading resumes and job descriptions">
            <div className="h-10 bg-gray-100 rounded-lg" />
            <div className="h-10 bg-gray-100 rounded-lg" />
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

        {status === 'ready' && (
          <>
            <div>
              <label htmlFor="tailor-resume" className="block font-semibold text-gray-900 mb-2">
                1. Resume
              </label>
              {ready.length === 0 ? (
                <p className="text-sm text-gray-600">
                  {resumes.length === 0 ? 'You have no resumes yet. ' : 'None of your resumes has finished text extraction yet. '}
                  <Link href={resumes.length === 0 ? '/resume/upload' : '/dashboard/resumes'} className="text-blue-600 hover:text-blue-800 font-medium">
                    {resumes.length === 0 ? 'Upload a resume' : 'Check My Resumes'}
                  </Link>
                </p>
              ) : (
                <>
                  <select id="tailor-resume" value={selectedResume} onChange={(e) => setResumeId(e.target.value)} className={selectClass}>
                    <option value="">Select a resume</option>
                    {ready.map((r) => (
                      <option key={r.id} value={r.id}>
                        {r.originalFilename} ({versionName(r)}
                        {r.isCurrent ? ', current' : ''}, uploaded {formatDate(r.createdAt)})
                      </option>
                    ))}
                  </select>
                  {ready.length < resumes.length && (
                    <p className="text-xs text-gray-500 mt-1">Resumes whose text has not been extracted are not listed.</p>
                  )}
                </>
              )}
            </div>

            <div>
              <label htmlFor="tailor-job" className="block font-semibold text-gray-900 mb-2">
                2. Job description
              </label>
              {jobs.length === 0 ? (
                <p className="text-sm text-gray-600">
                  You have no saved job descriptions.{' '}
                  <Link href="/job-descriptions/create" className="text-blue-600 hover:text-blue-800 font-medium">
                    Add a job description
                  </Link>
                </p>
              ) : (
                <>
                  <select id="tailor-job" value={selectedJob} onChange={(e) => setJobId(e.target.value)} className={selectClass}>
                    <option value="">Select a job description</option>
                    {jobs.map((j) => (
                      <option key={j.id} value={j.id} disabled={!j.requirementsExtractedAt}>
                        {j.title}
                        {j.companyName ? ` — ${j.companyName}` : ''}
                        {j.requirementsExtractedAt ? '' : ' (requirements not extracted)'}
                      </option>
                    ))}
                  </select>
                  {usableJobs.length < jobs.length && (
                    <p className="text-xs text-gray-500 mt-1">
                      Requirements must be extracted first: open the job description and choose &ldquo;Extract Requirements&rdquo;.
                    </p>
                  )}
                </>
              )}
            </div>

            {generateError && (
              <div role="alert" className="text-sm space-y-1">
                <p className="text-red-600 font-medium whitespace-pre-line">{generateError.message}</p>
                {generateError.code === 'JOB_REQUIREMENTS_NOT_AVAILABLE' && selectedJob && (
                  <Link href={`/job-descriptions/${selectedJob}`} className="text-blue-600 hover:text-blue-800">
                    Open the job description to extract its requirements
                  </Link>
                )}
              </div>
            )}

            <button
              onClick={generate}
              disabled={!selectedResume || !selectedJob || generating}
              aria-busy={generating}
              className="bg-blue-600 text-white px-5 py-2.5 rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition font-medium"
            >
              {generating ? 'Generating suggestions...' : 'Generate Suggestions'}
            </button>
          </>
        )}
      </div>

      {selectedResume && sessions && sessions.length > 0 && (
        <section className="bg-white rounded-xl shadow-sm border border-gray-100 p-4 md:p-6" aria-labelledby="earlier-sessions">
          <h2 id="earlier-sessions" className="text-lg font-bold text-gray-900 mb-3">
            Earlier tailoring for this resume
          </h2>
          <ul className="divide-y divide-gray-100">
            {sessions.map((s) => (
              <li key={s.id} className="py-3 flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                <div className="min-w-0">
                  <p className="font-medium text-gray-900 break-words">
                    {s.jobTitle}
                    {s.companyName && <span className="font-normal text-gray-600"> · {s.companyName}</span>}
                  </p>
                  <p className="text-sm text-gray-500">
                    {formatDateTime(s.createdAt)} · {s.acceptedCount} of {s.suggestionCount} accepted ·{' '}
                    {s.status === 'saved' ? 'Saved' : 'Draft'}
                  </p>
                </div>
                <Link href={`/dashboard/resumes/${s.resumeId}/tailoring/${s.id}`} className="text-sm font-medium text-blue-600 hover:text-blue-800 shrink-0">
                  {s.status === 'saved' ? 'View' : 'Continue Review'}
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

// useSearchParams (for preselection links) must sit inside a Suspense boundary.
export default function Tailor() {
  return (
    <Suspense fallback={<div className="p-8 text-center text-gray-600">Loading...</div>}>
      <TailorContent />
    </Suspense>
  );
}
