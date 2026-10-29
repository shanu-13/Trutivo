"use client";

import { useEffect, useState, type ReactNode } from 'react';
import Link from 'next/link';
import { useRequireAuth } from '@/hooks/useRequireAuth';
import { INTERVIEW_TYPES, STATUSES, STATUS_INFO, getInsights, type Insights, type Recommendation } from '@/lib/api/applications.api';
import { errorMessage, formatDateTime, formatDay } from '@/lib/format';

const MONTH_OPTIONS = [3, 6, 12, 24];
const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
const monthLabel = (m: string) => {
  const [y, mo] = m.split('-').map(Number);
  return new Date(y, mo - 1, 1).toLocaleDateString(undefined, { month: 'short', year: 'numeric' });
};
const percent = (rate: number | null) => (rate === null ? '—' : `${rate}%`);

// A metric tile. With `href`, the value is a link stretched over the whole tile,
// so the tile is clickable while dt/dd stay direct children of the list.
function Stat({ label, value, note, href }: { label: string; value: string; note?: string; href?: string }) {
  const shown = (
    <>
      {value}
      {value === '—' && <span className="sr-only">Not available</span>}
    </>
  );
  return (
    <div className={`relative border border-gray-200 rounded-lg p-4 bg-gray-50 ${href ? 'hover:bg-gray-100 focus-within:ring-2 focus-within:ring-blue-500' : ''}`}>
      <dt className="text-sm text-gray-600">{label}</dt>
      <dd className="text-2xl font-bold text-gray-900 mt-1 tabular-nums">
        {href ? (
          <Link href={href} className="no-underline after:absolute after:inset-0 focus-visible:outline-none" aria-label={`${label}: ${value}`}>
            {shown}
          </Link>
        ) : (
          shown
        )}
      </dd>
      {note && <dd className="text-xs text-gray-500 mt-1">{note}</dd>}
    </div>
  );
}

function Panel({ title, description, children }: { title: string; description?: string; children: ReactNode }) {
  return (
    <section className="bg-white rounded-xl shadow-sm border border-gray-100 p-4 md:p-6" aria-label={title}>
      <h2 className="text-lg font-bold text-gray-900">{title}</h2>
      {description && <p className="text-sm text-gray-600 mt-1">{description}</p>}
      <div className="mt-4">{children}</div>
    </section>
  );
}

// A single-series horizontal bar list: every row is labelled and carries its number as text.
function Bars({ rows, unit, label }: { rows: { key: string; label: ReactNode; value: number; text?: string }[]; unit: [string, string]; label: string }) {
  const largest = Math.max(0, ...rows.map((r) => r.value));
  return (
    <ul className="space-y-2" aria-label={label}>
      {rows.map((r) => (
        <li key={r.key} className="grid grid-cols-[7.5rem_1fr_auto] items-center gap-3 text-sm" title={`${r.text ?? ''}: ${plural(r.value, unit[0], unit[1])}`}>
          <span className="text-gray-700 font-medium truncate">{r.label}</span>
          <div className="h-4 bg-gray-100 rounded" aria-hidden="true">
            {r.value > 0 && <div className="h-4 bg-blue-600 rounded" style={{ width: `${(r.value / largest) * 100}%` }} />}
          </div>
          <span className="text-gray-800 tabular-nums text-right min-w-[2.5rem]">{r.value}</span>
        </li>
      ))}
    </ul>
  );
}

function RecommendationItem({ rec }: { rec: Recommendation }) {
  const link = (href: string, text: string) => (
    <Link href={href} className="font-medium text-blue-600 hover:text-blue-800 whitespace-nowrap">
      {text}
    </Link>
  );
  let body: ReactNode;
  switch (rec.kind) {
    case 'no_applications':
      body = <>Insights appear once you track applications. {link('/dashboard/applications/new', 'Add an application')}</>;
      break;
    case 'overdue_reminders':
      body = <>{rec.count === 1 ? 'One reminder is' : `${rec.count} reminders are`} past due. {link('/dashboard/reminders?view=overdue', 'Review overdue reminders')}</>;
      break;
    case 'follow_ups_due':
      body = <>{rec.count === 1 ? 'One follow-up is' : `${rec.count} follow-ups are`} due today or earlier. {link('/dashboard/applications', 'See applications')}</>;
      break;
    case 'interview_soon':
      body = (
        <>
          Interview for {rec.application.jobTitle} at {rec.application.companyName} on {formatDateTime(rec.interviewAt)}. {link(`/dashboard/applications/${rec.application.id}`, 'Open application')}
        </>
      );
      break;
    case 'busy_day':
      body = <>{rec.count} reminders are due on {formatDay(rec.date)}. You may want to spread them out. {link('/dashboard/reminders', 'View reminders')}</>;
      break;
    case 'no_next_step':
      body = (
        <>
          {rec.count === 1 ? 'One active application has' : `${rec.count} active applications have`} no next step recorded (no upcoming interview, follow-up date or reminder):{' '}
          {rec.applications.map((a, i) => (
            <span key={a.id}>
              {i > 0 && ', '}
              <Link href={`/dashboard/applications/${a.id}`} className="text-blue-600 hover:text-blue-800">
                {a.jobTitle} · {a.companyName}
              </Link>
            </span>
          ))}
          {rec.count > rec.applications.length && ` and ${rec.count - rec.applications.length} more`}.
        </>
      );
      break;
    case 'outdated_reminders':
      body = <>{rec.count === 1 ? 'One reminder' : `${rec.count} reminders`} may no longer be relevant because the linked application changed. {link('/dashboard/reminders', 'Review reminders')}</>;
      break;
    case 'inactive':
      body = <>It has been {rec.days} days since you last added an application. If you are still looking, adding new ones keeps these insights current.</>;
      break;
  }
  return (
    <li className={`flex gap-2 p-3 rounded-lg border text-sm ${rec.tone === 'attention' ? 'bg-amber-50 border-amber-200 text-amber-900' : 'bg-blue-50 border-blue-100 text-gray-800'}`}>
      <span aria-hidden="true">{rec.tone === 'attention' ? '⚑' : 'ℹ'}</span>
      <span className="break-words">
        <span className="sr-only">{rec.tone === 'attention' ? 'Needs attention: ' : 'Note: '}</span>
        {body}
      </span>
    </li>
  );
}

export default function InsightsPage() {
  const { isAuthenticated, loading } = useRequireAuth();
  const [months, setMonths] = useState(6);
  const [data, setData] = useState<{ insights: Insights; definitions: Record<string, string> } | null>(null);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [error, setError] = useState('');
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    if (!isAuthenticated) return;
    let cancelled = false;
    getInsights(months)
      .then((d) => {
        if (cancelled) return;
        setData(d);
        setStatus('ready');
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setError(errorMessage(err, 'Failed to load your insights'));
        setStatus('error');
      });
    return () => {
      cancelled = true;
    };
  }, [isAuthenticated, months, reloadKey]);

  if (loading) return <div className="p-8 text-center text-gray-600">Loading...</div>;
  if (!isAuthenticated) return null;

  const header = (
    <div>
      <h1 className="text-3xl font-bold">Application Insights</h1>
      <p className="text-gray-600">Counts from the applications and reminders you have saved. Nothing here is a prediction.</p>
    </div>
  );

  if (status === 'error') {
    return (
      <div className="page-container p-4 md:p-8 space-y-6">
        {header}
        <div role="alert" className="space-y-3">
          <p className="text-red-600 whitespace-pre-line">{error}</p>
          <button onClick={() => { setStatus('loading'); setReloadKey((k) => k + 1); }} className="text-sm bg-gray-200 hover:bg-gray-300 px-3 py-1.5 rounded">
            Retry
          </button>
        </div>
      </div>
    );
  }
  if (!data) {
    return (
      <div className="page-container p-4 md:p-8 space-y-6">
        {header}
        <div className="animate-pulse space-y-4" role="status" aria-label="Loading insights">
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            {[0, 1, 2, 3].map((i) => (
              <div key={i} className="h-24 bg-gray-100 rounded-lg" />
            ))}
          </div>
          <div className="h-48 bg-gray-100 rounded-xl" />
        </div>
      </div>
    );
  }

  const { insights: i, definitions: d } = data;
  const a = i.applications;
  const empty = a.total === 0;
  // Short enough for the bar labels; the panel description says these are stages reached.
  const stageLabel = { submitted: 'Submitted', interview: 'Interview', offer: 'Offer' } as const;

  return (
    <div className="page-container p-4 md:p-8 space-y-6" aria-busy={status === 'loading'}>
      {header}

      {i.recommendations.length > 0 && (
        <section aria-label="Suggestions" className="space-y-2">
          <h2 className="text-lg font-bold text-gray-900">Worth a look</h2>
          <ul className="space-y-2">
            {i.recommendations.map((rec, n) => (
              <RecommendationItem key={`${rec.kind}-${n}`} rec={rec} />
            ))}
          </ul>
        </section>
      )}

      <Panel title="Applications">
        <dl className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <Stat label="Tracked" value={String(a.total)} href="/dashboard/applications" />
          <Stat label="Submitted" value={String(a.submitted)} />
          <Stat label="In assessment or interview" value={String(a.inInterviewStages)} />
          <Stat label="Upcoming interviews" value={String(a.upcomingInterviews)} />
          <Stat label="Offers" value={String(a.offers)} />
          <Stat label="Rejections" value={String(a.rejections)} />
          <Stat label="Follow-ups due" value={String(a.followUpsDue)} note="Today or earlier" />
          <Stat label="Follow-ups scheduled" value={String(a.followUpsScheduled)} note="After today" />
        </dl>
      </Panel>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Panel title="Status distribution" description="Every application counted once, under its current status.">
          {empty ? (
            <p className="text-sm text-gray-500 py-6 text-center">No applications yet.</p>
          ) : (
            <Bars
              label={`Applications by status, ${plural(a.total, 'application', 'applications')} in total`}
              unit={['application', 'applications']}
              rows={STATUSES.map((s) => ({
                key: s,
                text: STATUS_INFO[s].label,
                value: a.byStatus[s],
                label: (
                  <span>
                    <span aria-hidden="true">{STATUS_INFO[s].symbol} </span>
                    {STATUS_INFO[s].label}
                  </span>
                ),
              }))}
            />
          )}
        </Panel>

        <Panel title="Application funnel" description="Of the submitted applications, how many reached each stage (now or earlier).">
          {i.funnel.stages[0].count === 0 ? (
            <p className="text-sm text-gray-500 py-6 text-center">No submitted applications yet.</p>
          ) : (
            <>
              <Bars
                label="Submitted applications by furthest stage reached"
                unit={['application', 'applications']}
                rows={i.funnel.stages.map((s) => ({ key: s.key, text: stageLabel[s.key], label: stageLabel[s.key], value: s.count }))}
              />
              <dl className="grid grid-cols-2 gap-3 mt-4 text-sm">
                <div>
                  <dt className="text-gray-600">Reached interview</dt>
                  <dd className="font-semibold tabular-nums">{percent(i.funnel.stages[1].rate)}</dd>
                </div>
                <div>
                  <dt className="text-gray-600">Reached offer</dt>
                  <dd className="font-semibold tabular-nums">{percent(i.funnel.stages[2].rate)}</dd>
                </div>
              </dl>
              {!i.funnel.enoughData && (
                <p className="text-xs text-gray-500 mt-2">Percentages appear once at least {i.funnel.minimumSample} applications have been submitted; with fewer, they would say little.</p>
              )}
            </>
          )}
        </Panel>
      </div>

      <section className="bg-white rounded-xl shadow-sm border border-gray-100 p-4 md:p-6 space-y-4" aria-label="Monthly activity">
        <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-3">
          <div>
            <h2 className="text-lg font-bold text-gray-900">Monthly activity</h2>
            <p className="text-sm text-gray-600">Applications by month, for the last {months} months.</p>
          </div>
          <div>
            <label htmlFor="months" className="block text-xs text-gray-600 mb-1">
              Period
            </label>
            <select id="months" value={months} onChange={(e) => { setMonths(Number(e.target.value)); setStatus('loading'); }} className="border border-gray-300 rounded-lg px-3 py-2 text-sm bg-white">
              {MONTH_OPTIONS.map((m) => (
                <option key={m} value={m}>
                  Last {m} months
                </option>
              ))}
            </select>
          </div>
        </div>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <div>
            <h3 className="font-semibold text-gray-900 mb-1">Applications submitted</h3>
            <p className="text-xs text-gray-500 mb-3">By the application date you entered.</p>
            {i.monthly.every((m) => m.applied === 0) ? (
              <p className="text-sm text-gray-500 py-4 text-center">No application dates in this period.</p>
            ) : (
              <Bars label="Applications submitted per month" unit={['application', 'applications']} rows={i.monthly.map((m) => ({ key: m.month, text: monthLabel(m.month), label: monthLabel(m.month), value: m.applied }))} />
            )}
          </div>
          <div>
            <h3 className="font-semibold text-gray-900 mb-1">Added to the tracker</h3>
            <p className="text-xs text-gray-500 mb-3">By the date each application was added.</p>
            {i.monthly.every((m) => m.added === 0) ? (
              <p className="text-sm text-gray-500 py-4 text-center">No applications added in this period.</p>
            ) : (
              <Bars label="Applications added per month" unit={['application', 'applications']} rows={i.monthly.map((m) => ({ key: m.month, text: monthLabel(m.month), label: monthLabel(m.month), value: m.added }))} />
            )}
          </div>
        </div>
      </section>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Panel title="Upcoming interviews">
          {i.upcomingInterviews.length === 0 ? (
            <p className="text-sm text-gray-500 py-4 text-center">No interviews scheduled.</p>
          ) : (
            <ul className="divide-y divide-gray-100">
              {i.upcomingInterviews.map((x) => (
                <li key={x.id} className="py-2 flex flex-col sm:flex-row sm:items-center justify-between gap-1">
                  <Link href={`/dashboard/applications/${x.id}`} className="text-blue-600 hover:text-blue-800 font-medium break-words">
                    {x.jobTitle} · {x.companyName}
                  </Link>
                  <span className="text-sm text-gray-600 shrink-0">
                    {formatDateTime(x.interviewAt)}
                    {x.interviewType && ` · ${INTERVIEW_TYPES[x.interviewType]}`}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Panel>

        <Panel title="Reminders">
          <dl className="grid grid-cols-2 gap-4">
            <Stat label="Pending" value={String(i.reminders.pending)} href="/dashboard/reminders" />
            <Stat label="Overdue" value={String(i.reminders.overdue)} href="/dashboard/reminders?view=overdue" />
            <Stat label="Completed" value={String(i.reminders.completed)} href="/dashboard/reminders?view=completed" />
            <Stat label="Completed of completed + pending" value={percent(i.reminders.completionRate)} note={i.reminders.completionRate === null ? 'No reminders yet' : undefined} />
          </dl>
        </Panel>
      </div>

      <details className="bg-white rounded-xl shadow-sm border border-gray-100 p-4 md:p-6">
        <summary className="font-semibold text-gray-900 cursor-pointer">How these numbers are calculated</summary>
        <dl className="mt-3 grid grid-cols-1 md:grid-cols-[14rem_1fr] gap-x-4 gap-y-2 text-sm">
          {Object.entries(d).map(([key, text]) => (
            <div key={key} className="contents">
              <dt className="font-medium text-gray-800">{DEFINITION_LABELS[key] ?? key}</dt>
              <dd className="text-gray-600">{text}</dd>
            </div>
          ))}
        </dl>
        <p className="text-xs text-gray-500 mt-3">Figures as of {formatDay(i.asOf)}.</p>
      </details>
    </div>
  );
}

const DEFINITION_LABELS: Record<string, string> = {
  total: 'Tracked',
  submitted: 'Submitted',
  inInterviewStages: 'In assessment or interview',
  offers: 'Offers',
  rejections: 'Rejections',
  upcomingInterviews: 'Upcoming interviews',
  followUpsDue: 'Follow-ups due',
  followUpsScheduled: 'Follow-ups scheduled',
  byStatus: 'Status distribution',
  remindersPending: 'Pending reminders',
  remindersOverdue: 'Overdue reminders',
  remindersCompleted: 'Completed reminders',
  completionRate: 'Completion rate',
  monthlyApplied: 'Applications submitted (monthly)',
  monthlyAdded: 'Added to the tracker (monthly)',
  funnel: 'Application funnel',
};
