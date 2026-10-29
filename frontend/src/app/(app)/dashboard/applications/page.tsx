"use client";

import { Suspense, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useRequireAuth } from '@/hooks/useRequireAuth';
import {
  STATUSES,
  STATUS_INFO,
  deleteApplication,
  getApplicationMetrics,
  listApplications,
  type Application,
  type ApplicationMetrics,
  type ListFilters,
  type SortKey,
} from '@/lib/api/applications.api';
import { errorMessage, formatDateTime, formatDay } from '@/lib/format';
import StatusBadge from '@/components/StatusBadge';
import ApplicationStatusSelect from '@/components/ApplicationStatusSelect';
import ConfirmDialog from '@/components/ConfirmDialog';

type Status = 'loading' | 'ready' | 'error';
type View = 'list' | 'board';

const PAGE_SIZE = 20;
// The board shows up to this many applications (the API maximum).
const BOARD_LIMIT = 100;
const EMPTY_FILTERS: ListFilters = { status: '', company: '', title: '', appliedFrom: '', appliedTo: '', sort: 'updated' };
const SORT_LABELS: Record<SortKey, string> = {
  updated: 'Recently updated',
  applied: 'Application date (newest first)',
  company: 'Company (A–Z)',
  upcoming: 'Upcoming interview or follow-up',
};
const METRICS: { key: keyof Omit<ApplicationMetrics, 'asOf' | 'byStatus'>; label: string }[] = [
  { key: 'total', label: 'Tracked applications' },
  { key: 'submitted', label: 'Applications submitted' },
  { key: 'upcomingInterviews', label: 'Interviews scheduled' },
  { key: 'offers', label: 'Offers' },
  { key: 'rejections', label: 'Rejections' },
  { key: 'followUpsDue', label: 'Follow-ups due' },
];

const inputClass = 'w-full border border-gray-300 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500';

function NextAction({ app }: { app: Application }) {
  if (!app.nextAction) return null;
  return (
    <span>
      {app.nextAction.type === 'interview' ? `Interview ${formatDateTime(app.nextAction.at)}` : `Follow up ${formatDay(app.nextAction.at)}`}
    </span>
  );
}

function ApplicationsContent() {
  const { isAuthenticated, loading } = useRequireAuth();
  const deletedFromDetails = useSearchParams().get('deleted') === '1';
  const [view, setView] = useState<View>('list');
  const [draft, setDraft] = useState<ListFilters>(EMPTY_FILTERS);
  const [filters, setFilters] = useState<ListFilters>(EMPTY_FILTERS);
  const [page, setPage] = useState(1);
  const [items, setItems] = useState<Application[]>([]);
  const [total, setTotal] = useState(0);
  const [totalPages, setTotalPages] = useState(0);
  const [metrics, setMetrics] = useState<ApplicationMetrics | null>(null);
  const [definitions, setDefinitions] = useState<Record<string, string>>({});
  const [status, setStatus] = useState<Status>('loading');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState(deletedFromDetails ? 'Application deleted.' : '');
  const [reloadKey, setReloadKey] = useState(0);
  const [toDelete, setToDelete] = useState<Application | null>(null);
  const [deleting, setDeleting] = useState(false);
  const deletingRef = useRef(false);

  useEffect(() => {
    if (!isAuthenticated) return;
    let cancelled = false;
    const listFilters = view === 'board' ? { ...filters, status: '' as const } : filters;
    Promise.all([listApplications(listFilters, view === 'board' ? 1 : page, view === 'board' ? BOARD_LIMIT : PAGE_SIZE), getApplicationMetrics()])
      .then(([list, m]) => {
        if (cancelled) return;
        // A page emptied by deletions: go back to the last page with results.
        if (list.items.length === 0 && page > 1 && list.pagination.totalPages > 0) {
          setPage(list.pagination.totalPages);
          return;
        }
        setItems(list.items);
        setTotal(list.pagination.total);
        setTotalPages(list.pagination.totalPages);
        setMetrics(m.metrics);
        setDefinitions(m.definitions);
        setStatus('ready');
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setError(errorMessage(err, 'Failed to load your applications'));
        setStatus('error');
      });
    return () => {
      cancelled = true;
    };
  }, [isAuthenticated, filters, page, view, reloadKey]);

  const reload = () => setReloadKey((k) => k + 1);
  const applyFilters = (e: React.FormEvent) => {
    e.preventDefault();
    setPage(1);
    setFilters({ ...draft });
  };
  const clearFilters = () => {
    setDraft(EMPTY_FILTERS);
    setFilters(EMPTY_FILTERS);
    setPage(1);
  };
  const filtered = Object.entries(filters).some(([k, v]) => k !== 'sort' && v);

  const onStatusChanged = (updated: Application) => {
    setItems((current) => current.map((a) => (a.id === updated.id ? updated : a)));
    setNotice(`${updated.jobTitle} at ${updated.companyName} moved to ${STATUS_INFO[updated.status].label}.`);
    reload(); // metrics and filtered lists depend on the status
  };

  const confirmDelete = async () => {
    if (!toDelete || deletingRef.current) return;
    deletingRef.current = true;
    const target = toDelete;
    setDeleting(true);
    setError('');
    setNotice('');
    try {
      await deleteApplication(target.id);
      setNotice(`${target.jobTitle} at ${target.companyName} was deleted.`);
      reload();
    } catch (err: unknown) {
      setError(errorMessage(err, 'Failed to delete the application'));
    } finally {
      deletingRef.current = false;
      setDeleting(false);
      setToDelete(null);
    }
  };

  if (loading) return <div className="p-8 text-center text-gray-600">Loading...</div>;
  if (!isAuthenticated) return null;

  const actions = (app: Application) => (
    <div className="flex gap-4 text-sm font-medium">
      <Link href={`/dashboard/applications/${app.id}`} className="text-blue-600 hover:text-blue-800 py-1">
        View
      </Link>
      <Link href={`/dashboard/applications/${app.id}/edit`} className="text-blue-600 hover:text-blue-800 py-1">
        Edit
      </Link>
      <button onClick={() => setToDelete(app)} disabled={deleting} className="text-red-600 hover:text-red-800 disabled:opacity-50 py-1">
        Delete
      </button>
    </div>
  );

  return (
    <div className="page-container p-4 md:p-8 space-y-6">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h1 className="text-3xl font-bold mb-1">Applications</h1>
          <p className="text-gray-600">Track where you have applied and what comes next.</p>
        </div>
        <Link href="/dashboard/applications/new" className="bg-blue-600 text-white px-5 py-2.5 rounded-lg hover:bg-blue-700 transition font-medium text-center whitespace-nowrap">
          Add Application
        </Link>
      </div>

      {notice && (
        <p role="status" className="bg-green-50 text-green-700 p-3 rounded-lg text-sm font-medium border border-green-100 break-words">
          {notice}
        </p>
      )}
      {error && status === 'ready' && (
        <p role="alert" className="bg-red-50 text-red-600 p-3 rounded-lg text-sm font-medium border border-red-100 whitespace-pre-line">
          {error}
        </p>
      )}

      {status === 'error' && (
        <div role="alert" className="bg-white rounded-xl border border-gray-100 p-6 space-y-3">
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

      {status === 'loading' && !metrics && (
        <div className="animate-pulse space-y-4" role="status" aria-label="Loading applications">
          <div className="grid grid-cols-2 lg:grid-cols-6 gap-3">
            {[0, 1, 2, 3, 4, 5].map((i) => (
              <div key={i} className="h-20 bg-gray-100 rounded-lg" />
            ))}
          </div>
          <div className="h-64 bg-gray-100 rounded-xl" />
        </div>
      )}

      {metrics && (
        <section aria-labelledby="metrics-heading" className="space-y-2">
          <h2 id="metrics-heading" className="sr-only">
            Summary
          </h2>
          <dl className="grid grid-cols-2 lg:grid-cols-6 gap-3">
            {METRICS.map((m) => (
              <div key={m.key} className="bg-white border border-gray-200 rounded-lg p-3" title={definitions[m.key]}>
                <dt className="text-xs text-gray-600">{m.label}</dt>
                <dd className="text-2xl font-bold text-gray-900">{metrics[m.key]}</dd>
              </div>
            ))}
          </dl>
          <details className="text-sm text-gray-600">
            <summary className="cursor-pointer text-blue-700">How these are counted</summary>
            <ul className="mt-2 space-y-1">
              {METRICS.map((m) => (
                <li key={m.key}>
                  <span className="font-medium">{m.label}:</span> {definitions[m.key]}
                </li>
              ))}
            </ul>
          </details>
        </section>
      )}

      {status === 'ready' && metrics?.total === 0 ? (
        <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-8 text-center">
          <p className="text-gray-700 text-lg mb-2">You are not tracking any applications yet.</p>
          <p className="text-gray-500 mb-6">Add the jobs you are interested in or have applied to, and keep their status, interviews and follow-ups in one place.</p>
          <Link href="/dashboard/applications/new" className="bg-blue-600 text-white px-5 py-2.5 rounded-lg hover:bg-blue-700 transition font-medium">
            Add Your First Application
          </Link>
        </div>
      ) : (
        metrics && (
          <>
            <form onSubmit={applyFilters} className="bg-white rounded-xl shadow-sm border border-gray-100 p-4 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-6 gap-3 items-end" aria-label="Filter applications">
              <div>
                <label htmlFor="f-status" className="block text-xs font-medium text-gray-700 mb-1">
                  Status
                </label>
                <select id="f-status" value={draft.status} disabled={view === 'board'} onChange={(e) => setDraft({ ...draft, status: e.target.value as ListFilters['status'] })} className={inputClass}>
                  <option value="">All statuses</option>
                  {STATUSES.map((s) => (
                    <option key={s} value={s}>
                      {STATUS_INFO[s].label}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label htmlFor="f-company" className="block text-xs font-medium text-gray-700 mb-1">
                  Company
                </label>
                <input id="f-company" value={draft.company} onChange={(e) => setDraft({ ...draft, company: e.target.value })} className={inputClass} />
              </div>
              <div>
                <label htmlFor="f-title" className="block text-xs font-medium text-gray-700 mb-1">
                  Job title
                </label>
                <input id="f-title" value={draft.title} onChange={(e) => setDraft({ ...draft, title: e.target.value })} className={inputClass} />
              </div>
              <div>
                <label htmlFor="f-from" className="block text-xs font-medium text-gray-700 mb-1">
                  Applied from
                </label>
                <input id="f-from" type="date" value={draft.appliedFrom} onChange={(e) => setDraft({ ...draft, appliedFrom: e.target.value })} className={inputClass} />
              </div>
              <div>
                <label htmlFor="f-to" className="block text-xs font-medium text-gray-700 mb-1">
                  Applied to
                </label>
                <input id="f-to" type="date" value={draft.appliedTo} onChange={(e) => setDraft({ ...draft, appliedTo: e.target.value })} className={inputClass} />
              </div>
              <div>
                <label htmlFor="f-sort" className="block text-xs font-medium text-gray-700 mb-1">
                  Sort by
                </label>
                <select id="f-sort" value={draft.sort} onChange={(e) => setDraft({ ...draft, sort: e.target.value as SortKey })} className={inputClass}>
                  {Object.entries(SORT_LABELS).map(([k, l]) => (
                    <option key={k} value={k}>
                      {l}
                    </option>
                  ))}
                </select>
              </div>
              <div className="sm:col-span-2 lg:col-span-6 flex flex-wrap gap-2 items-center">
                <button type="submit" className="text-sm bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700">
                  Apply
                </button>
                <button type="button" onClick={clearFilters} className="text-sm px-4 py-2 rounded-lg border border-gray-300 hover:bg-gray-50">
                  Clear
                </button>
                <div className="ml-auto flex rounded-lg border border-gray-300 overflow-hidden text-sm" role="group" aria-label="View">
                  {(['list', 'board'] as View[]).map((v) => (
                    <button
                      key={v}
                      type="button"
                      aria-pressed={view === v}
                      onClick={() => {
                        setView(v);
                        setPage(1);
                      }}
                      className={`px-3 py-2 ${view === v ? 'bg-gray-800 text-white' : 'bg-white hover:bg-gray-50'}`}
                    >
                      {v === 'list' ? 'List' : 'Board'}
                    </button>
                  ))}
                </div>
              </div>
            </form>

            {items.length === 0 && status === 'ready' ? (
              <div className="bg-white rounded-xl border border-gray-100 p-8 text-center">
                <p className="text-gray-700 mb-3">No applications match these filters.</p>
                {filtered && (
                  <button onClick={clearFilters} className="text-sm font-medium text-blue-600 hover:text-blue-800">
                    Clear filters
                  </button>
                )}
              </div>
            ) : view === 'list' ? (
              <section aria-label="Applications list" className="bg-white rounded-xl shadow-sm border border-gray-100 p-4 md:p-6">
                <p className="text-sm text-gray-500 mb-2" role="status">
                  {total} application{total === 1 ? '' : 's'}
                </p>
                <ul className="divide-y divide-gray-100">
                  {items.map((app) => (
                    <li key={app.id} className="py-4 grid grid-cols-1 md:grid-cols-[1fr_auto_auto] gap-3 md:items-center">
                      <div className="min-w-0 space-y-1">
                        <Link href={`/dashboard/applications/${app.id}`} className="font-semibold text-gray-900 hover:text-blue-700 break-words">
                          {app.jobTitle}
                        </Link>
                        <p className="text-gray-600 break-words">{app.companyName}</p>
                        <div className="flex flex-wrap items-center gap-2 text-sm text-gray-500">
                          <StatusBadge {...STATUS_INFO[app.status]} />
                          <span>{app.appliedOn ? `Applied ${formatDay(app.appliedOn)}` : 'No application date'}</span>
                          <NextAction app={app} />
                          {app.followUpDue && <span className="text-amber-700 font-medium">⚑ Follow-up due</span>}
                        </div>
                      </div>
                      <ApplicationStatusSelect application={app} onChanged={onStatusChanged} />
                      {actions(app)}
                    </li>
                  ))}
                </ul>
                {totalPages > 1 && (
                  <nav aria-label="Pages" className="flex items-center justify-between gap-3 pt-4 mt-2 border-t border-gray-100">
                    <button onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page <= 1} className="text-sm px-3 py-1 rounded border border-gray-300 disabled:opacity-40">
                      Previous
                    </button>
                    <span className="text-sm text-gray-600">
                      Page {page} of {totalPages}
                    </span>
                    <button onClick={() => setPage((p) => Math.min(totalPages, p + 1))} disabled={page >= totalPages} className="text-sm px-3 py-1 rounded border border-gray-300 disabled:opacity-40">
                      Next
                    </button>
                  </nav>
                )}
              </section>
            ) : (
              <section aria-label="Applications board" className="space-y-2">
                {total > BOARD_LIMIT && (
                  <p className="text-sm text-amber-700">
                    Showing the first {BOARD_LIMIT} of {total} applications. Use the filters or the list view to see the rest.
                  </p>
                )}
                {/* The board scrolls sideways inside its own area on small screens; "relative" keeps
                    absolutely positioned content (screen-reader labels) inside that area. */}
                <div className="relative overflow-x-auto pb-2">
                  <div className="grid grid-flow-col auto-cols-[minmax(220px,1fr)] gap-3">
                    {STATUSES.map((s) => {
                      const column = items.filter((a) => a.status === s);
                      return (
                        <div key={s} className="bg-gray-100 rounded-xl p-2 min-h-[8rem]" aria-label={`${STATUS_INFO[s].label}: ${column.length}`}>
                          <h3 className="text-sm font-semibold text-gray-800 px-1 mb-2">
                            <span aria-hidden="true">{STATUS_INFO[s].symbol} </span>
                            {STATUS_INFO[s].label} ({column.length})
                          </h3>
                          <ul className="space-y-2">
                            {column.map((app) => (
                              <li key={app.id} className="bg-white rounded-lg border border-gray-200 p-3 text-sm space-y-2">
                                <Link href={`/dashboard/applications/${app.id}`} className="font-semibold text-gray-900 hover:text-blue-700 break-words block">
                                  {app.jobTitle}
                                </Link>
                                <p className="text-gray-600 break-words">{app.companyName}</p>
                                <p className="text-xs text-gray-500">
                                  <NextAction app={app} />
                                </p>
                                <ApplicationStatusSelect application={app} onChanged={onStatusChanged} compact />
                              </li>
                            ))}
                          </ul>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </section>
            )}
          </>
        )
      )}

      <ConfirmDialog
        open={toDelete !== null}
        title="Delete this application?"
        confirmLabel="Delete Application"
        busyLabel="Deleting..."
        busy={deleting}
        onConfirm={confirmDelete}
        onCancel={() => setToDelete(null)}
      >
        <p>
          <span className="font-semibold">
            {toDelete?.jobTitle} at {toDelete?.companyName}
          </span>{' '}
          and its history will be permanently deleted. Linked resumes, job descriptions and cover letters are not affected.
        </p>
      </ConfirmDialog>
    </div>
  );
}

// useSearchParams (for the "deleted" notice) must sit inside a Suspense boundary.
export default function Applications() {
  return (
    <Suspense fallback={<div className="p-8 text-center text-gray-600">Loading...</div>}>
      <ApplicationsContent />
    </Suspense>
  );
}
