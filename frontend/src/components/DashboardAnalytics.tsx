"use client";

import { useEffect, useState, type ReactNode } from 'react';
import Link from 'next/link';
import { getDashboardAnalytics, type DashboardAnalytics as Analytics, type ScoreBucket } from '@/lib/api/dashboard.api';
import type { MatchHistorySummary } from '@/lib/api/matchHistory.api';
import { formatDate } from '@/lib/format';

type Status = 'loading' | 'ready' | 'error';

// Same precision as the match history list; a missing score is never shown as 0%.
const formatScore = (score: number | null) => (score === null ? '—' : `${score.toFixed(2)}%`);

const analysesLabel = (count: number) => `${count} ${count === 1 ? 'analysis' : 'analyses'}`;

function SummaryCard({ label, value, note }: { label: string; value: string; note?: string }) {
  return (
    <div className="border border-gray-200 rounded-lg p-4 bg-gray-50">
      <dt className="text-sm text-gray-600">{label}</dt>
      <dd className="text-2xl font-bold text-gray-900 mt-1">
        {value}
        {value === '—' && <span className="sr-only">Not available</span>}
      </dd>
      {note && <dd className="text-xs text-gray-500 mt-1">{note}</dd>}
    </div>
  );
}

function ScoreDistribution({ buckets, scored, total }: { buckets: ScoreBucket[]; scored: number; total: number }) {
  if (scored === 0) {
    return (
      <p className="text-sm text-gray-500 py-6 text-center">
        {total === 0 ? 'No saved analyses yet.' : 'None of your saved analyses has a match score.'}
      </p>
    );
  }
  const largest = Math.max(...buckets.map((b) => b.count));
  return (
    <ul className="space-y-3" aria-label={`Match score distribution across ${analysesLabel(scored)} with a score`}>
      {buckets.map((bucket) => (
        <li key={bucket.label} className="grid grid-cols-[4.5rem_1fr_auto] items-center gap-3 text-sm">
          <span className="text-gray-700 font-medium">{bucket.label}</span>
          <div className="h-4 bg-gray-100 rounded" aria-hidden="true">
            {bucket.count > 0 && (
              <div className="h-4 bg-blue-600 rounded" style={{ width: `${(bucket.count / largest) * 100}%` }} />
            )}
          </div>
          <span className="text-gray-700 tabular-nums text-right min-w-[5.5rem]">
            {analysesLabel(bucket.count)}
          </span>
        </li>
      ))}
    </ul>
  );
}

function MatchItem({ item }: { item: MatchHistorySummary }) {
  return (
    <li className="py-3 flex flex-col sm:flex-row sm:items-center justify-between gap-2">
      <div className="min-w-0">
        <p className="font-semibold text-gray-900 break-words">
          {item.jobTitle}
          {item.companyName && <span className="font-normal text-gray-600"> · {item.companyName}</span>}
        </p>
        <p className="text-sm text-gray-500 break-all">Resume: {item.resumeFilename}</p>
        <p className="text-sm text-gray-500">
          Match Score:{' '}
          <span className="font-medium text-gray-800">{item.overallScore === null ? 'Not available' : formatScore(item.overallScore)}</span>
          {' · '}Analyzed: {formatDate(item.createdAt)}
        </p>
      </div>
      <Link href={`/dashboard/match-history/${item.id}`} className="text-sm font-medium text-blue-600 hover:text-blue-800 shrink-0">
        View Analysis
      </Link>
    </li>
  );
}

function Panel({ title, children, action }: { title: string; children: ReactNode; action?: ReactNode }) {
  return (
    <section className="border border-gray-200 rounded-lg p-4" aria-label={title}>
      <div className="flex items-center justify-between gap-3 mb-3">
        <h3 className="font-semibold text-gray-900">{title}</h3>
        {action}
      </div>
      {children}
    </section>
  );
}

// Overview of the user's saved analyses (Step 8B). The numbers come from saved
// match history only; nothing is recalculated here. `reloadKey` changes when
// the parent knows the history has changed (a new match was saved).
export default function DashboardAnalytics({ reloadKey = 0 }: { reloadKey?: number }) {
  const [analytics, setAnalytics] = useState<Analytics | null>(null);
  const [status, setStatus] = useState<Status>('loading');
  const [error, setError] = useState('');
  const [retryKey, setRetryKey] = useState(0);

  useEffect(() => {
    let cancelled = false;
    getDashboardAnalytics()
      .then((data) => {
        if (cancelled) return;
        setAnalytics(data);
        setStatus('ready');
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setError(err instanceof Error && err.message ? err.message : 'Failed to load your dashboard summary');
        setStatus('error');
      });
    return () => {
      cancelled = true;
    };
  }, [reloadKey, retryKey]);

  const retry = () => {
    setStatus('loading');
    setError('');
    setRetryKey((key) => key + 1);
  };

  return (
    <div className="rounded-xl border border-line bg-white p-5 md:p-6 mb-6">
      <div className="mb-6">
        <h2 className="text-lg font-semibold mb-1">Matching Overview</h2>
        <p className="text-sm text-gray-600">
          A summary of your saved resume-job analyses. Scores describe how a resume compares with a job description;
          they do not predict hiring outcomes.
        </p>
      </div>

      {status === 'loading' && !analytics && (
        <div className="animate-pulse space-y-6" role="status" aria-label="Loading dashboard summary">
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            {[0, 1, 2, 3].map((i) => (
              <div key={i} className="h-24 bg-gray-100 rounded-lg" />
            ))}
          </div>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <div className="h-48 bg-gray-100 rounded-lg" />
            <div className="h-48 bg-gray-100 rounded-lg" />
          </div>
          <span className="sr-only">Loading dashboard summary...</span>
        </div>
      )}

      {status === 'error' && (
        <div role="alert" className="space-y-3">
          <p className="text-red-600 font-medium whitespace-pre-line">{error}</p>
          <button onClick={retry} className="text-sm bg-gray-200 hover:bg-gray-300 px-3 py-1 rounded transition">
            Retry
          </button>
        </div>
      )}

      {status !== 'error' && analytics && (
        <div className="space-y-6">
          <dl className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            <SummaryCard label="Total Analyses" value={String(analytics.summary.totalAnalyses)} />
            <SummaryCard
              label="Average Match Score"
              value={formatScore(analytics.summary.averageMatchScore)}
              note={
                analytics.summary.scoredAnalyses < analytics.summary.totalAnalyses
                  ? `Based on ${analytics.summary.scoredAnalyses} scored of ${analytics.summary.totalAnalyses}`
                  : undefined
              }
            />
            <SummaryCard label="Highest Match Score" value={formatScore(analytics.summary.highestMatchScore)} />
            <SummaryCard
              label={`Analyses Scoring ${analytics.summary.scoreThreshold}%+`}
              value={String(analytics.summary.analysesAtOrAboveThreshold)}
            />
          </dl>

          {analytics.latestAnalysis ? (
            <p className="text-sm text-gray-600">
              Latest analysis:{' '}
              <Link href={`/dashboard/match-history/${analytics.latestAnalysis.id}`} className="font-medium text-blue-600 hover:text-blue-800">
                {analytics.latestAnalysis.jobTitle}
                {analytics.latestAnalysis.companyName ? ` · ${analytics.latestAnalysis.companyName}` : ''}
              </Link>{' '}
              ({formatScore(analytics.latestAnalysis.overallScore)}, {formatDate(analytics.latestAnalysis.createdAt)})
            </p>
          ) : (
            <div className="text-center py-4 border border-dashed border-gray-300 rounded-lg">
              <p className="text-gray-700 mb-1">You have no saved analyses yet.</p>
              <p className="text-sm text-gray-500 mb-3">Choose a job description under one of your resumes below and run a match.</p>
              <a href="#my-resumes" className="text-sm font-medium text-blue-600 hover:text-blue-800">
                Start a resume-job analysis
              </a>
            </div>
          )}

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <Panel title="Match Score Distribution">
              <ScoreDistribution
                buckets={analytics.scoreDistribution}
                scored={analytics.summary.scoredAnalyses}
                total={analytics.summary.totalAnalyses}
              />
            </Panel>
            <Panel title="Highest-Scoring Saved Matches">
              {analytics.strongestMatches.length === 0 ? (
                <p className="text-sm text-gray-500 py-6 text-center">No scored analyses yet.</p>
              ) : (
                <ol className="divide-y divide-gray-100">
                  {analytics.strongestMatches.map((item) => (
                    <MatchItem key={item.id} item={item} />
                  ))}
                </ol>
              )}
            </Panel>
          </div>

          <Panel
            title="Recent Activity"
            action={
              <Link href="/dashboard/match-history" className="text-sm font-medium text-blue-600 hover:text-blue-800 whitespace-nowrap">
                View all match history
              </Link>
            }
          >
            {analytics.recentActivity.length === 0 ? (
              <p className="text-sm text-gray-500 py-6 text-center">No recent activity.</p>
            ) : (
              <ul className="divide-y divide-gray-100">
                {analytics.recentActivity.map((item) => (
                  <MatchItem key={item.id} item={item} />
                ))}
              </ul>
            )}
          </Panel>
        </div>
      )}
    </div>
  );
}
