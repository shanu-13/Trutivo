"use client";

import { useEffect, useRef, useState } from 'react';
import { getAtsCheck, runAtsCheck, type AtsHistoryItem, type AtsRelevance, type AtsScoring, type Severity, type StoredAtsCheck, type CheckStatus } from '@/lib/api/ats.api';
import type { JobDescriptionSummary } from '@/lib/api/jobDescription.api';
import { errorMessage, formatDateTime } from '@/lib/format';
import StatusBadge from '@/components/StatusBadge';

type Status = 'loading' | 'ready' | 'error';

const SEVERITY: Record<Severity, { label: string; symbol: string; tone: string }> = {
  high: { label: 'High', symbol: '!', tone: 'bg-red-50 text-red-700 border-red-200' },
  medium: { label: 'Medium', symbol: '▲', tone: 'bg-amber-50 text-amber-800 border-amber-200' },
  low: { label: 'Low', symbol: '•', tone: 'bg-gray-50 text-gray-700 border-gray-200' },
};

const CHECK_STATUS: Record<CheckStatus, string> = {
  pass: '✓ Passed',
  partial: '◐ Partly',
  fail: '✕ Not met',
  not_applicable: '– Not applicable (no deduction)',
  not_evaluated: '? Not evaluated',
};

const COVERAGE = { supported: '✓ Supported', partial: '◐ Partly shown', not_found: '○ Not found' } as const;

const BAND_TONE: Record<string, string> = {
  strong: 'text-green-700',
  good: 'text-blue-700',
  fair: 'text-amber-700',
  weak: 'text-red-700',
};

interface Props {
  resumeId: string;
  // Job descriptions for the optional relevance check (null while loading).
  jobDescriptions: JobDescriptionSummary[] | null;
}

// ATS readiness panel for one resume version (Step 11).
export default function AtsReadiness({ resumeId, jobDescriptions }: Props) {
  const [status, setStatus] = useState<Status>('loading');
  const [loadError, setLoadError] = useState('');
  const [check, setCheck] = useState<StoredAtsCheck | null>(null);
  const [history, setHistory] = useState<AtsHistoryItem[]>([]);
  const [scoring, setScoring] = useState<AtsScoring | null>(null);
  const [relevance, setRelevance] = useState<AtsRelevance | null>(null);
  const [jobId, setJobId] = useState('');
  const [running, setRunning] = useState(false);
  const [runError, setRunError] = useState('');
  const [reloadKey, setReloadKey] = useState(0);
  // Blocks a second click that arrives before the disabled button has rendered.
  const runningRef = useRef(false);

  useEffect(() => {
    let cancelled = false;
    getAtsCheck(resumeId)
      .then((data) => {
        if (cancelled) return;
        setCheck(data.check);
        setHistory(data.history);
        setScoring(data.scoring);
        setStatus('ready');
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setLoadError(errorMessage(err, 'Failed to load ATS readiness'));
        setStatus('error');
      });
    return () => {
      cancelled = true;
    };
  }, [resumeId, reloadKey]);

  const run = async () => {
    if (runningRef.current) return;
    runningRef.current = true;
    setRunning(true);
    setRunError('');
    try {
      const data = await runAtsCheck(resumeId, jobId || null);
      setCheck(data.check);
      setScoring(data.scoring);
      setRelevance(data.relevance);
      setHistory((h) => [
        { id: data.check.id, score: data.check.result.score, band: data.check.result.band?.id ?? null, complete: data.check.result.complete, stale: false, createdAt: data.check.createdAt },
        ...h,
      ].slice(0, 10));
    } catch (err: unknown) {
      setRunError(errorMessage(err, 'The check could not be run'));
    } finally {
      runningRef.current = false;
      setRunning(false);
    }
  };

  if (status === 'loading') {
    return (
      <div className="animate-pulse space-y-3" role="status" aria-label="Loading ATS readiness">
        <div className="h-16 bg-gray-100 rounded-lg" />
        <div className="h-24 bg-gray-100 rounded-lg" />
      </div>
    );
  }
  if (status === 'error') {
    return (
      <div role="alert" className="space-y-2">
        <p className="text-sm text-red-600 whitespace-pre-line">{loadError}</p>
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
    );
  }

  const usableJobs = (jobDescriptions ?? []).filter((j) => j.requirementsExtractedAt);
  const result = check?.result ?? null;

  return (
    <div className="space-y-5">
      <p className="text-sm text-gray-600">
        Checks how readable and complete this resume&apos;s text is: structure, content, parsing and contact details. It is
        separate from the job match score. {scoring?.disclaimer}
      </p>

      <div className="flex flex-col sm:flex-row sm:items-end gap-3">
        <div className="flex-1 min-w-0">
          <label htmlFor={`ats-job-${resumeId}`} className="block text-sm font-medium text-gray-800 mb-1">
            Job relevance (optional, not part of the score)
          </label>
          <select
            id={`ats-job-${resumeId}`}
            value={jobId}
            onChange={(e) => setJobId(e.target.value)}
            disabled={running || jobDescriptions === null}
            className="w-full border border-gray-300 rounded-lg px-3 py-2 bg-white text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            <option value="">No job description</option>
            {usableJobs.map((j) => (
              <option key={j.id} value={j.id}>
                {j.title}
                {j.companyName ? ` — ${j.companyName}` : ''}
              </option>
            ))}
          </select>
        </div>
        <button
          onClick={run}
          disabled={running}
          aria-busy={running}
          className="bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition text-sm font-medium whitespace-nowrap"
        >
          {running ? 'Checking...' : result ? 'Recheck ATS Readiness' : 'Check ATS Readiness'}
        </button>
      </div>
      {runError && (
        <p role="alert" className="text-sm text-red-600 whitespace-pre-line">
          {runError}
        </p>
      )}

      {!result && (
        <p className="text-sm text-gray-500 border border-dashed border-gray-300 rounded-lg p-4 text-center">
          This version has not been checked yet.
        </p>
      )}

      {result && check && (
        <div className="space-y-5" aria-live="polite">
          {check.stale && (
            <p role="status" className="bg-amber-50 border border-amber-200 text-amber-800 rounded-lg p-3 text-sm">
              This result is out of date: the resume text or the checks changed since {formatDateTime(check.createdAt)}. Recheck to update it.
            </p>
          )}

          <div className="flex flex-col sm:flex-row sm:items-center gap-4 border border-gray-200 rounded-lg p-4">
            <div className="text-center sm:w-32 shrink-0">
              <p className="text-4xl font-bold text-gray-900" aria-label={result.score === null ? 'No score' : `Score ${result.score} out of 100`}>
                {result.score === null ? '—' : result.score}
                <span className="text-base font-normal text-gray-500"> / 100</span>
              </p>
              <p className="text-xs text-gray-500">ATS readiness</p>
            </div>
            <div className="min-w-0 text-sm">
              {result.band ? (
                <p className={`font-semibold ${BAND_TONE[result.band.id]}`}>{result.band.label}</p>
              ) : (
                <p className="font-semibold text-gray-800">Not scored</p>
              )}
              {result.incompleteReason && <p className="text-gray-700 mt-1">{result.incompleteReason}</p>}
              <p className="text-gray-500 mt-1">
                Checked {formatDateTime(check.createdAt)} · {result.stats.wordCount} words · rules version {result.rulesVersion}
              </p>
              {scoring && (
                <p className="text-gray-500 mt-1">
                  Guidance bands for this app: {scoring.bands.map((b) => `${b.min}+ ${b.label.toLowerCase()}`).join('; ')}.
                </p>
              )}
            </div>
          </div>

          <div>
            <h3 className="font-semibold text-gray-900 mb-2">Score by category</h3>
            <ul className="space-y-2">
              {result.categories.map((c) => (
                <li key={c.id} className="text-sm">
                  <div className="flex justify-between gap-2">
                    <span className="text-gray-800">{c.name}</span>
                    <span className="text-gray-700 tabular-nums">{c.evaluated ? `${c.earned} / ${c.available}` : `Not evaluated (of ${c.available})`}</span>
                  </div>
                  <div className="h-2 bg-gray-100 rounded mt-1" aria-hidden="true">
                    {c.evaluated && <div className="h-2 bg-blue-600 rounded" style={{ width: `${(c.earned / c.available) * 100}%` }} />}
                  </div>
                </li>
              ))}
            </ul>
          </div>

          {result.strengths.length > 0 && (
            <div>
              <h3 className="font-semibold text-gray-900 mb-2">Strengths</h3>
              <ul className="space-y-1 text-sm text-gray-700">
                {result.strengths.map((s) => (
                  <li key={s}>
                    <span aria-hidden="true" className="text-green-700">✓ </span>
                    {s}
                  </li>
                ))}
              </ul>
            </div>
          )}

          <div>
            <h3 className="font-semibold text-gray-900 mb-2">Recommendations ({result.recommendations.length})</h3>
            {result.recommendations.length === 0 ? (
              <p className="text-sm text-gray-600">No issues found by these checks.</p>
            ) : (
              <ol className="space-y-3">
                {result.recommendations.map((r) => (
                  <li key={r.id} className="border border-gray-200 rounded-lg p-3 text-sm space-y-1 break-words">
                    <div className="flex flex-wrap items-center gap-2">
                      <StatusBadge {...SEVERITY[r.severity]} label={`${SEVERITY[r.severity].label} priority`} />
                      <span className="text-xs text-gray-500">{result.categories.find((c) => c.id === r.category)?.name}</span>
                    </div>
                    <p className="font-semibold text-gray-900">{r.title}</p>
                    <p className="text-gray-700">{r.explanation}</p>
                    <p className="text-gray-600">
                      <span className="font-medium">Why it matters: </span>
                      {r.whyItMatters}
                    </p>
                    <p className="text-gray-800">
                      <span className="font-medium">What to do: </span>
                      {r.action}
                    </p>
                    {r.example && (
                      <pre className="bg-gray-50 border border-gray-200 rounded p-2 text-xs whitespace-pre-wrap break-words font-mono">{r.example}</pre>
                    )}
                  </li>
                ))}
              </ol>
            )}
          </div>

          <details className="text-sm">
            <summary className="cursor-pointer font-medium text-blue-700">How the score was calculated</summary>
            <ul className="mt-2 divide-y divide-gray-100">
              {result.checks.map((c) => (
                <li key={c.id} className="py-2 flex flex-col sm:flex-row sm:justify-between gap-1">
                  <span className="min-w-0">
                    <span className="font-medium text-gray-800">{c.title}</span>
                    <span className="block text-gray-600 break-words">{c.detail}</span>
                  </span>
                  <span className="text-gray-700 shrink-0 tabular-nums">
                    {CHECK_STATUS[c.status]} · {c.earned}/{c.available}
                  </span>
                </li>
              ))}
            </ul>
          </details>

          {relevance && (
            <div className="border border-gray-200 rounded-lg p-3 space-y-2 text-sm">
              <h3 className="font-semibold text-gray-900">
                Job relevance{relevance.status === 'available' ? `: ${relevance.jobTitle}${relevance.companyName ? ` · ${relevance.companyName}` : ''}` : ''}
              </h3>
              <p className="text-gray-500">Separate from the ATS readiness score. Only add skills and experience you actually have.</p>
              {relevance.status === 'unavailable' ? (
                <p className="text-gray-700">{relevance.reason}</p>
              ) : (
                <>
                  <ul className="space-y-1">
                    {relevance.requirements.map((r) => (
                      <li key={`${r.type}:${r.requirement}`} className="break-words">
                        <span className="font-medium">{COVERAGE[r.status]}</span> — {r.requirement}
                        <span className="block text-gray-600">{r.detail}</span>
                      </li>
                    ))}
                  </ul>
                  <ul className="list-disc pl-5 text-gray-800 space-y-1">
                    {relevance.suggestions.map((s) => (
                      <li key={s}>{s}</li>
                    ))}
                  </ul>
                </>
              )}
            </div>
          )}

          {history.length > 1 && (
            <div className="text-sm">
              <h3 className="font-semibold text-gray-900 mb-1">Earlier checks of this version</h3>
              <ul className="text-gray-600 space-y-0.5">
                {history.slice(1, 6).map((h) => (
                  <li key={h.id}>
                    {formatDateTime(h.createdAt)}: {h.score === null ? 'not scored' : `${h.score} / 100`}
                    {h.stale ? ' (out of date)' : ''}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
