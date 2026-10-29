"use client";

import { Suspense, useEffect, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useRequireAuth } from '@/hooks/useRequireAuth';
import { getResumeList, type ResumeSummary } from '@/lib/api/resume.api';
import { getJobDescriptionList, type JobDescriptionSummary } from '@/lib/api/jobDescription.api';
import { errorMessage, formatDate } from '@/lib/format';
import ResumeJobMatch from '@/components/ResumeJobMatch';

type Status = 'loading' | 'ready' | 'error';

// Choose one of your resumes and one of your job descriptions, then run the
// existing match. Matching only ever runs when the button is pressed.
function MatchContent() {
  const { isAuthenticated, loading } = useRequireAuth();
  const params = useSearchParams();
  const [resumes, setResumes] = useState<ResumeSummary[]>([]);
  const [jobDescriptions, setJobDescriptions] = useState<JobDescriptionSummary[]>([]);
  const [status, setStatus] = useState<Status>('loading');
  const [error, setError] = useState('');
  const [reloadKey, setReloadKey] = useState(0);
  const [resumeId, setResumeId] = useState('');

  useEffect(() => {
    if (!isAuthenticated) return;
    let cancelled = false;
    Promise.all([getResumeList(), getJobDescriptionList()])
      .then(([resumeItems, jobItems]) => {
        if (cancelled) return;
        setResumes(resumeItems);
        setJobDescriptions(jobItems);
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

  const retry = () => {
    setStatus('loading');
    setError('');
    setReloadKey((key) => key + 1);
  };

  if (loading) return <div className="p-8 text-center text-gray-600">Loading...</div>;
  if (!isAuthenticated) return null;

  // Only resumes whose text has been extracted can be matched.
  const matchable = resumes.filter((r) => r.extractionStatus === 'completed');
  // Preselections from the URL are used only if they are among the user's own items.
  const requestedResume = params.get('resumeId') ?? '';
  const requestedJob = params.get('jobDescriptionId') ?? '';
  const selectedResumeId = resumeId || (matchable.some((r) => r.id === requestedResume) ? requestedResume : '');
  const initialJobId = jobDescriptions.some((jd) => jd.id === requestedJob) ? requestedJob : undefined;

  return (
    <div className="page-container p-4 md:p-8">
      <div className="mb-6">
        <h1 className="text-3xl font-bold mb-1">Match a Resume With a Job</h1>
        <p className="text-gray-600">Choose one of your resumes and a saved job description, then run the analysis.</p>
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
            <button onClick={retry} className="text-sm bg-gray-200 hover:bg-gray-300 px-3 py-1.5 rounded transition">
              Retry
            </button>
          </div>
        )}

        {status === 'ready' && (
          <>
            <section aria-labelledby="choose-resume">
              <h2 id="choose-resume" className="font-semibold text-gray-900 mb-2">
                1. Resume
              </h2>
              {resumes.length === 0 ? (
                <p className="text-sm text-gray-600">
                  You have no resumes yet.{' '}
                  <Link href="/resume/upload" className="text-blue-600 hover:text-blue-800 font-medium">
                    Upload a resume
                  </Link>{' '}
                  to get started.
                </p>
              ) : matchable.length === 0 ? (
                <p className="text-sm text-gray-600">
                  None of your resumes has finished text extraction yet. Check their status in{' '}
                  <Link href="/dashboard/resumes" className="text-blue-600 hover:text-blue-800 font-medium">
                    My Resumes
                  </Link>
                  .
                </p>
              ) : (
                <>
                  <label htmlFor="match-resume" className="sr-only">
                    Select a resume
                  </label>
                  <select
                    id="match-resume"
                    value={selectedResumeId}
                    onChange={(e) => setResumeId(e.target.value)}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                  >
                    <option value="">Select a resume</option>
                    {matchable.map((r) => (
                      <option key={r.id} value={r.id}>
                        {r.originalFilename} ({r.versionCount > 1 ? `version ${r.versionNumber}${r.isCurrent ? ', current' : ''}, ` : ''}uploaded {formatDate(r.createdAt)})
                      </option>
                    ))}
                  </select>
                  {matchable.length < resumes.length && (
                    <p className="text-xs text-gray-500 mt-1">
                      {resumes.length - matchable.length} resume(s) not listed because text extraction has not completed.
                    </p>
                  )}
                </>
              )}
            </section>

            <section aria-labelledby="choose-job">
              <h2 id="choose-job" className="font-semibold text-gray-900 mb-2">
                2. Job description and analysis
              </h2>
              {jobDescriptions.length === 0 ? (
                <p className="text-sm text-gray-600">
                  You have no saved job descriptions.{' '}
                  <Link href="/job-descriptions/create" className="text-blue-600 hover:text-blue-800 font-medium">
                    Add a job description
                  </Link>{' '}
                  to compare with your resume.
                </p>
              ) : !selectedResumeId ? (
                <div className="space-y-2">
                  <p className="text-sm text-gray-500">Select a resume first.</p>
                  <button
                    type="button"
                    disabled
                    className="text-sm bg-blue-600 text-white opacity-50 cursor-not-allowed px-3 py-1 rounded"
                  >
                    Analyze Match
                  </button>
                </div>
              ) : (
                <ResumeJobMatch
                  key={selectedResumeId}
                  resumeId={selectedResumeId}
                  jobDescriptions={jobDescriptions}
                  initialJobDescriptionId={initialJobId}
                />
              )}
            </section>
          </>
        )}
      </div>
    </div>
  );
}

// useSearchParams (for preselection links) must sit inside a Suspense boundary.
export default function Match() {
  return (
    <Suspense fallback={<div className="p-8 text-center text-gray-600">Loading...</div>}>
      <MatchContent />
    </Suspense>
  );
}
