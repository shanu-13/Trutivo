import Link from 'next/link';
import type { ResumeSummary } from '@/lib/api/resume.api';
import type { JobDescriptionSummary } from '@/lib/api/jobDescription.api';
import { formatDate } from '@/lib/format';
import { versionName } from '@/lib/resumeStatus';

const SOURCE: Record<string, string> = { upload: 'Upload', tailored: 'Tailored', exported: 'Exported PDF' };
const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

// Dashboard starting points (one row per feature that exists) and the most
// recent resume versions. All numbers come from the user's own records.
export default function DashboardWorkspace({ resumes, jobs, loading }: { resumes: ResumeSummary[]; jobs: JobDescriptionSummary[]; loading: boolean }) {
  const groups = new Set(resumes.map((r) => r.resumeGroupId)).size;
  const recent = [...resumes].sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 5);
  const latestReady = recent.find((r) => r.extractionStatus === 'completed') ?? null;
  const readyJobs = jobs.filter((j) => j.requirementsExtractedAt).length;
  const count = (text: string) => (loading ? '…' : text);

  const rows = [
    {
      title: 'My resumes',
      detail: count(groups ? `${plural(groups, 'resume', 'resumes')}, ${plural(resumes.length, 'version', 'versions')}` : 'No resumes yet'),
      href: '/dashboard/resumes',
      action: 'Open',
    },
    { title: 'Add a resume', detail: 'Upload a PDF, or a new version of an existing resume', href: '/resume/upload', action: 'Upload' },
    {
      title: 'Target roles',
      detail: count(jobs.length ? `${plural(jobs.length, 'job description', 'job descriptions')}, ${readyJobs} ready for matching` : 'No job descriptions yet'),
      href: '/job-descriptions',
      action: 'Open',
    },
    {
      title: 'Resume analysis',
      detail: latestReady ? `Skills, sections and recommendations for ${latestReady.originalFilename}` : 'Available once a resume has been processed',
      href: latestReady ? `/dashboard/resumes/${latestReady.id}` : '/resume/upload',
      action: latestReady ? 'Analyse' : 'Upload',
    },
    { title: 'Job matching', detail: 'Compare a resume with a job and see what is covered and missing', href: '/dashboard/match', action: 'Match' },
    {
      title: 'ATS checker',
      detail: latestReady ? 'Run the readiness check on your latest processed resume' : 'Available once a resume has been processed',
      href: latestReady ? `/dashboard/resumes/${latestReady.id}#ats-readiness` : '/resume/upload',
      action: latestReady ? 'Check' : 'Upload',
    },
  ];

  return (
    <div className="mb-6 grid gap-6 xl:grid-cols-[1fr_1.15fr] [&>*]:min-w-0">
      <section aria-labelledby="workspace-title" className="rounded-xl border border-line bg-white">
        <h2 id="workspace-title" className="border-b border-line px-5 py-4 text-base font-semibold">
          Workspace
        </h2>
        <ul className="divide-y divide-slate-100">
          {rows.map((r) => (
            <li key={r.title} className="flex items-center justify-between gap-4 px-5 py-3">
              <div className="min-w-0">
                <p className="text-sm font-medium text-ink">{r.title}</p>
                <p className="text-sm text-slate-500">{r.detail}</p>
              </div>
              <Link href={r.href} aria-label={`${r.action}: ${r.title}`} className="shrink-0 rounded-md border border-slate-200 px-3 py-1.5 text-sm font-medium text-ink hover:bg-slate-50">
                {r.action}
              </Link>
            </li>
          ))}
        </ul>
      </section>

      <section aria-labelledby="recent-title" className="rounded-xl border border-line bg-white">
        <div className="flex items-center justify-between gap-3 border-b border-line px-5 py-4">
          <h2 id="recent-title" className="text-base font-semibold">
            Recent resume versions
          </h2>
          <Link href="/dashboard/resumes" className="text-sm font-medium text-blue-600 hover:text-blue-700">
            All resumes
          </Link>
        </div>
        {loading ? (
          <div className="animate-pulse space-y-3 p-5" role="status" aria-label="Loading recent versions">
            {[0, 1, 2].map((i) => (
              <div key={i} className="h-8 rounded bg-slate-100" />
            ))}
          </div>
        ) : recent.length === 0 ? (
          <p className="px-5 py-8 text-center text-sm text-slate-600">
            No resumes yet.{' '}
            <Link href="/resume/upload" className="font-medium text-blue-600">
              Upload your first resume
            </Link>
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="text-xs uppercase tracking-wider text-slate-500">
                  <th scope="col" className="px-5 py-2.5 font-semibold">Resume</th>
                  <th scope="col" className="px-3 py-2.5 font-semibold">Version</th>
                  <th scope="col" className="hidden px-3 py-2.5 font-semibold sm:table-cell">Type</th>
                  <th scope="col" className="px-5 py-2.5 text-right font-semibold">Added</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {recent.map((r) => (
                  <tr key={r.id}>
                    <td className="px-5 py-3">
                      <Link href={`/dashboard/resumes/${r.id}`} className="font-medium text-ink no-underline [overflow-wrap:anywhere] hover:text-blue-700">
                        {r.originalFilename}
                      </Link>
                    </td>
                    <td className="whitespace-nowrap px-3 py-3 text-slate-600">
                      {versionName(r)}
                      {r.isCurrent && <span className="ml-2 rounded-full bg-blue-50 px-2 py-0.5 text-xs font-semibold text-blue-800">Current</span>}
                    </td>
                    <td className="hidden whitespace-nowrap px-3 py-3 text-slate-600 sm:table-cell">{SOURCE[r.sourceType ?? 'upload'] ?? 'Upload'}</td>
                    <td className="whitespace-nowrap px-5 py-3 text-right text-slate-600">{formatDate(r.createdAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
