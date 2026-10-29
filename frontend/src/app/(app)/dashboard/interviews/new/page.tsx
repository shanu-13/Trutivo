"use client";

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useRequireAuth } from '@/hooks/useRequireAuth';
import { DIFFICULTIES, INTERVIEW_TYPES, createInterview, listInterviews, type Difficulty, type InterviewType } from '@/lib/api/interviews.api';
import { getResumeList, type ResumeSummary } from '@/lib/api/resume.api';
import { getJobDescriptionList, type JobDescriptionSummary } from '@/lib/api/jobDescription.api';
import { errorMessage } from '@/lib/format';
import { versionName } from '@/lib/resumeStatus';

const selectClass = 'w-full border border-gray-300 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500';

export default function NewInterview() {
  const { isAuthenticated, loading } = useRequireAuth();
  const router = useRouter();
  const [resumes, setResumes] = useState<ResumeSummary[] | null>(null);
  const [jobs, setJobs] = useState<JobDescriptionSummary[] | null>(null);
  const [maxQuestions, setMaxQuestions] = useState(10);
  const [loadError, setLoadError] = useState('');
  const [reloadKey, setReloadKey] = useState(0);
  const [resumeId, setResumeId] = useState('');
  const [jobId, setJobId] = useState('');
  const [interviewType, setInterviewType] = useState<InterviewType>('mixed');
  const [difficulty, setDifficulty] = useState<Difficulty>('intermediate');
  const [count, setCount] = useState(5);
  const [error, setError] = useState('');
  const [creating, setCreating] = useState(false);
  const creatingRef = useRef(false);

  useEffect(() => {
    if (!isAuthenticated) return;
    let cancelled = false;
    Promise.all([getResumeList(), getJobDescriptionList(), listInterviews(1, 1)])
      .then(([r, j, l]) => {
        if (cancelled) return;
        // Only processed resumes and job descriptions with extracted requirements can be used.
        setResumes(r.filter((x) => x.extractionStatus === 'completed'));
        setJobs(j.filter((x) => x.requirementsExtractedAt));
        setMaxQuestions(l.limits.maxQuestions);
      })
      .catch((err: unknown) => {
        if (!cancelled) setLoadError(errorMessage(err, 'Failed to load your resumes and job descriptions'));
      });
    return () => {
      cancelled = true;
    };
  }, [isAuthenticated, reloadKey]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (creatingRef.current) return;
    if (!resumeId || !jobId) {
      setError('Choose a resume and a job description.');
      return;
    }
    creatingRef.current = true;
    setCreating(true);
    setError('');
    try {
      const created = await createInterview({ resumeId, jobDescriptionId: jobId, interviewType, difficulty, questionCount: count });
      router.push(`/dashboard/interviews/${created.session.id}`);
    } catch (err: unknown) {
      setError(errorMessage(err, 'The mock interview could not be created'));
      creatingRef.current = false;
      setCreating(false);
    }
  };

  if (loading) return <div className="p-8 text-center text-gray-600">Loading...</div>;
  if (!isAuthenticated) return null;

  const ready = resumes !== null && jobs !== null;
  return (
    <div className="page-container p-4 md:p-8 space-y-4">
      <Link href="/dashboard/interviews" className="text-gray-500 hover:text-gray-800 text-sm">
        ← Back to Mock Interviews
      </Link>
      <h1 className="text-3xl font-bold">New Mock Interview</h1>
      <p className="text-gray-600">
        Questions are prepared from your resume and the job&apos;s requirements by fixed rules. Questions about skills your resume does not list say so.
      </p>

      {loadError && (
        <div role="alert" className="space-y-2">
          <p className="text-red-600 whitespace-pre-line">{loadError}</p>
          <button onClick={() => { setLoadError(''); setReloadKey((k) => k + 1); }} className="text-sm bg-gray-200 hover:bg-gray-300 px-3 py-1.5 rounded">
            Retry
          </button>
        </div>
      )}
      {!ready && !loadError && <div className="animate-pulse h-64 bg-gray-100 rounded-xl" role="status" aria-label="Loading form" />}

      {ready && (resumes.length === 0 || jobs.length === 0) ? (
        <div className="bg-white rounded-xl border border-dashed border-gray-300 p-6 text-center space-y-2">
          {resumes.length === 0 && (
            <p className="text-gray-700">
              You need a processed resume first. <Link href="/resume/upload" className="text-blue-600 hover:text-blue-800 font-medium">Upload a resume</Link>
            </p>
          )}
          {jobs.length === 0 && (
            <p className="text-gray-700">
              You need a job description with extracted requirements.{' '}
              <Link href="/job-descriptions" className="text-blue-600 hover:text-blue-800 font-medium">Open your job descriptions</Link>
            </p>
          )}
        </div>
      ) : (
        ready && (
          <form onSubmit={submit} noValidate className="bg-white rounded-xl shadow-sm border border-gray-100 p-4 md:p-6 space-y-5">
            {error && (
              <p role="alert" className="bg-red-50 text-red-600 p-3 rounded-lg text-sm border border-red-100 whitespace-pre-line">
                {error}
              </p>
            )}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label htmlFor="iv-resume" className="block text-sm font-medium text-gray-800 mb-1">
                  Resume *
                </label>
                <select id="iv-resume" value={resumeId} onChange={(e) => setResumeId(e.target.value)} className={selectClass}>
                  <option value="">Choose a resume</option>
                  {resumes.map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.originalFilename} ({versionName(r)})
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label htmlFor="iv-job" className="block text-sm font-medium text-gray-800 mb-1">
                  Job description *
                </label>
                <select id="iv-job" value={jobId} onChange={(e) => setJobId(e.target.value)} className={selectClass}>
                  <option value="">Choose a job description</option>
                  {jobs.map((j) => (
                    <option key={j.id} value={j.id}>
                      {j.title}
                      {j.companyName ? ` — ${j.companyName}` : ''}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <fieldset>
              <legend className="block text-sm font-medium text-gray-800 mb-2">Interview type</legend>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                {(Object.keys(INTERVIEW_TYPES) as InterviewType[]).map((t) => (
                  <label key={t} className={`flex gap-2 items-start border rounded-lg p-3 cursor-pointer ${interviewType === t ? 'border-blue-500 bg-blue-50' : 'border-gray-200'}`}>
                    <input type="radio" name="interviewType" value={t} checked={interviewType === t} onChange={() => setInterviewType(t)} className="mt-1" />
                    <span>
                      <span className="font-medium text-gray-900">{INTERVIEW_TYPES[t].label}</span>
                      <span className="block text-xs text-gray-600">{INTERVIEW_TYPES[t].description}</span>
                    </span>
                  </label>
                ))}
              </div>
            </fieldset>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label htmlFor="iv-difficulty" className="block text-sm font-medium text-gray-800 mb-1">
                  Difficulty
                </label>
                <select id="iv-difficulty" value={difficulty} onChange={(e) => setDifficulty(e.target.value as Difficulty)} className={selectClass}>
                  {(Object.keys(DIFFICULTIES) as Difficulty[]).map((d) => (
                    <option key={d} value={d}>
                      {DIFFICULTIES[d]}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label htmlFor="iv-count" className="block text-sm font-medium text-gray-800 mb-1">
                  Number of questions
                </label>
                <select id="iv-count" value={count} onChange={(e) => setCount(Number(e.target.value))} className={selectClass}>
                  {Array.from({ length: maxQuestions }, (_, i) => i + 1).map((n) => (
                    <option key={n} value={n}>
                      {n}
                    </option>
                  ))}
                </select>
                <p className="text-xs text-gray-500 mt-1">Up to {maxQuestions}. HR interviews have at most 5 distinct questions.</p>
              </div>
            </div>

            <button
              type="submit"
              disabled={creating}
              aria-busy={creating}
              className="w-full sm:w-auto bg-blue-600 text-white px-6 py-3 rounded-lg font-semibold hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {creating ? 'Preparing questions...' : 'Start Interview'}
            </button>
          </form>
        )
      )}
    </div>
  );
}
