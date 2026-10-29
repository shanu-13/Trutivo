"use client";

import { useEffect, useState, type ReactNode } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useRequireAuth } from '@/hooks/useRequireAuth';
import { ApiError } from '@/lib/api/client';
import { compareResumeVersions, type ListComparison, type VersionComparison, type VersionInfo } from '@/lib/api/resume.api';
import { errorMessage, formatDate } from '@/lib/format';
import { CURRENT_BADGE, versionName } from '@/lib/resumeStatus';
import StatusBadge from '@/components/StatusBadge';

type Status = 'loading' | 'ready' | 'not_found' | 'error';

const formatScore = (score: number) => `${score.toFixed(2)}%`;
// The sign is written out, so the direction does not depend on colour.
const formatDifference = (d: number) => (d > 0 ? `+${d.toFixed(2)}` : d < 0 ? `−${Math.abs(d).toFixed(2)}` : '0.00');

function Panel({ title, children }: { title: string; children: ReactNode }) {
  const headingId = `cmp-${title.replace(/\W+/g, '-').toLowerCase()}`;
  return (
    <section className="bg-white rounded-xl shadow-sm border border-gray-100 p-4 md:p-6" aria-labelledby={headingId}>
      <h2 id={headingId} className="text-lg font-bold text-gray-900 mb-3">
        {title}
      </h2>
      {children}
    </section>
  );
}

function ChangeList({ label, symbol, items, tone }: { label: string; symbol: string; items: string[]; tone: string }) {
  return (
    <div>
      <h3 className="text-sm font-semibold text-gray-800 mb-1">
        <span aria-hidden="true">{symbol} </span>
        {label} ({items.length})
      </h3>
      {items.length === 0 ? (
        <p className="text-sm text-gray-500">None</p>
      ) : (
        <ul className="flex flex-wrap gap-1.5">
          {items.map((item) => (
            <li key={item} className={`text-xs border px-2 py-0.5 rounded break-words max-w-full ${tone}`}>
              {item}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function Changes({ comparison, showUnchanged = true }: { comparison: ListComparison; showUnchanged?: boolean }) {
  if (comparison.status === 'unavailable') {
    return <p className="text-sm text-gray-600">Comparison not available: {comparison.reason}</p>;
  }
  return (
    <div className="space-y-3">
      <ChangeList label="Added" symbol="+" items={comparison.added} tone="bg-green-50 text-green-800 border-green-200" />
      <ChangeList label="Removed" symbol="−" items={comparison.removed} tone="bg-red-50 text-red-800 border-red-200" />
      {showUnchanged && <ChangeList label="Unchanged" symbol="=" items={comparison.unchanged} tone="bg-gray-50 text-gray-700 border-gray-200" />}
    </div>
  );
}

function VersionCard({ role, version }: { role: string; version: VersionInfo }) {
  return (
    <div className="border border-gray-200 rounded-lg p-4 min-w-0">
      <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">{role}</p>
      <p className="font-semibold text-gray-900 mt-1 break-words">{versionName(version)}</p>
      <p className="text-sm text-gray-700 break-all">{version.filename}</p>
      <div className="flex flex-wrap items-center gap-2 mt-1 text-sm text-gray-500">
        <span>Uploaded {formatDate(version.createdAt)}</span>
        {version.isCurrent && <StatusBadge {...CURRENT_BADGE} />}
      </div>
      <Link href={`/dashboard/resumes/${version.resumeId}`} className="text-sm font-medium text-blue-600 hover:text-blue-800">
        View version
      </Link>
    </div>
  );
}

const SECTIONS = [
  ['experience', 'Work Experience'],
  ['education', 'Education'],
  ['projects', 'Projects'],
  ['certifications', 'Certifications'],
] as const;

export default function CompareVersions() {
  const { isAuthenticated, loading } = useRequireAuth();
  const { id, otherId } = useParams<{ id: string; otherId: string }>();
  const [comparison, setComparison] = useState<VersionComparison | null>(null);
  const [status, setStatus] = useState<Status>('loading');
  const [error, setError] = useState('');
  const [reloadKey, setReloadKey] = useState(0);

  // Reads saved data only; nothing is rerun or saved by opening this page.
  useEffect(() => {
    if (!isAuthenticated || !id || !otherId) return;
    let cancelled = false;
    compareResumeVersions(id, otherId)
      .then((data) => {
        if (cancelled) return;
        setComparison(data);
        setStatus('ready');
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        if (err instanceof ApiError && (err.status === 404 || err.status === 400)) setStatus('not_found');
        else {
          setError(errorMessage(err, 'Failed to compare the versions'));
          setStatus('error');
        }
      });
    return () => {
      cancelled = true;
    };
  }, [isAuthenticated, id, otherId, reloadKey]);

  if (loading) return <div className="p-8 text-center text-gray-600">Loading...</div>;
  if (!isAuthenticated) return null;

  const back = (
    <Link href={`/dashboard/resumes/${id}/versions`} className="text-gray-500 hover:text-gray-800 text-sm">
      ← Back to Version History
    </Link>
  );

  if (status === 'loading') {
    return (
      <div className="page-container p-4 md:p-8 space-y-4">
        {back}
        <div className="animate-pulse space-y-4" role="status" aria-label="Comparing versions">
          <div className="h-28 bg-gray-100 rounded-xl" />
          <div className="h-40 bg-gray-100 rounded-xl" />
        </div>
      </div>
    );
  }
  if (status === 'not_found') {
    return (
      <div className="page-container p-4 md:p-8 text-center space-y-4" role="alert">
        <p className="text-gray-700 text-lg">These versions cannot be compared.</p>
        <p className="text-gray-500">Both must be different versions of the same resume.</p>
        <Link href="/dashboard/resumes" className="text-blue-600 hover:text-blue-800 font-medium">
          Back to My Resumes
        </Link>
      </div>
    );
  }
  if (status === 'error' || !comparison) {
    return (
      <div className="page-container p-4 md:p-8 space-y-4">
        {back}
        <div role="alert" className="space-y-3">
          <p className="text-red-600 font-medium whitespace-pre-line">{error}</p>
          <button
            onClick={() => {
              setStatus('loading');
              setReloadKey((key) => key + 1);
            }}
            className="text-sm bg-gray-200 hover:bg-gray-300 px-3 py-1.5 rounded transition"
          >
            Retry
          </button>
        </div>
      </div>
    );
  }

  const { olderVersion, newerVersion, skills, sections, text, matchScoreComparison } = comparison;

  return (
    <div className="page-container p-4 md:p-8 space-y-6">
      {back}
      <div>
        <h1 className="text-3xl font-bold mb-1">Compare Versions</h1>
        <p className="text-gray-600">
          Changes from {versionName(olderVersion)} to {versionName(newerVersion)}, based on the data extracted from each file.
        </p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <VersionCard role="Older version" version={olderVersion} />
        <VersionCard role="Newer version" version={newerVersion} />
      </div>

      <Panel title="Skills">
        {skills.source && (
          <p className="text-sm text-gray-500 mb-3">
            {skills.source === 'stored'
              ? 'From the skills extracted for each version.'
              : 'From the structured analysis of each version (skills were not extracted for both).'}
          </p>
        )}
        <Changes comparison={skills} />
      </Panel>

      <Panel title="Resume Sections">
        <p className="text-sm text-gray-500 mb-4">
          Entries are matched by their title, company, degree, project or certificate name. Edits within an entry are not shown.
          {!sections.analysisAvailable && ' The structured analysis is not available for both versions right now.'}
        </p>
        <div className="space-y-6">
          {SECTIONS.map(([key, label]) => (
            <div key={key}>
              <h3 className="font-semibold text-gray-900 mb-2">{label}</h3>
              <Changes comparison={sections[key]} />
            </div>
          ))}
        </div>
      </Panel>

      <Panel title="Extracted Text">
        {text.status === 'unavailable' ? (
          <p className="text-sm text-gray-600">Not available: the text of one of the versions has not been extracted.</p>
        ) : text.changed ? (
          <p className="text-sm text-gray-700">
            The text changed: {text.linesAdded} line(s) added and {text.linesRemoved} line(s) removed ({text.olderWordCount} →{' '}
            {text.newerWordCount} words).
          </p>
        ) : (
          <p className="text-sm text-gray-700">The extracted text is the same (ignoring spacing).</p>
        )}
      </Panel>

      <Panel title="Saved Match Scores">
        <p className="text-sm text-gray-500 mb-3">
          The official match score of saved analyses, for job descriptions analyzed with both versions (latest analysis of each).
          A higher score is a change in this application&apos;s score only; it does not predict hiring outcomes.
        </p>
        {matchScoreComparison.length === 0 ? (
          <p className="text-sm text-gray-600">{comparison.matchScoreMessage}</p>
        ) : (
          <ul className="divide-y divide-gray-100">
            {matchScoreComparison.map((row) => (
              <li key={row.jobDescriptionId} className="py-3 flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                <div className="min-w-0">
                  <p className="font-semibold text-gray-900 break-words">
                    {row.jobTitle}
                    {row.companyName && <span className="font-normal text-gray-600"> · {row.companyName}</span>}
                  </p>
                  <p className="text-sm text-gray-600">
                    {formatScore(row.olderScore)} → {formatScore(row.newerScore)}{' '}
                    <span className="font-semibold text-gray-900">({formatDifference(row.difference)} points)</span>
                  </p>
                </div>
                <div className="flex gap-4 text-sm font-medium shrink-0">
                  <Link href={`/dashboard/match-history/${row.olderMatchId}`} className="text-blue-600 hover:text-blue-800">
                    Older analysis
                  </Link>
                  <Link href={`/dashboard/match-history/${row.newerMatchId}`} className="text-blue-600 hover:text-blue-800">
                    Newer analysis
                  </Link>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Panel>
    </div>
  );
}
