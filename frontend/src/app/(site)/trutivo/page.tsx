import Link from 'next/link';
import type { ReactNode } from 'react';
import AosInit from '@/components/site/AosInit';
import { ScrollToSectionOnLoad } from '@/components/site/SectionLink';

// Public landing page at /trutivo ("/" redirects here). Layout follows the Trutivo website design; every claim
// describes a feature that exists in the application. Mock-ups are decorative
// (hidden from assistive technology) and use example content only.

const primary = 'inline-flex items-center justify-center rounded-full bg-accent px-6 py-3 text-sm font-semibold text-ink hover:bg-blue-400 transition-colors duration-200';
const secondary = 'inline-flex items-center justify-center rounded-full border border-slate-300 bg-white px-6 py-3 text-sm font-semibold text-ink hover:bg-slate-50 transition-colors duration-200';

function Check({ className = 'text-accent-strong' }: { className?: string }) {
  return (
    <svg aria-hidden="true" viewBox="0 0 20 20" className={`h-4 w-4 shrink-0 ${className}`} fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4.5 10.5l3.5 3.5 7.5-8" />
    </svg>
  );
}

function DocGlyph() {
  return (
    <svg aria-hidden="true" viewBox="0 0 20 20" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round">
      <path d="M5 2.5h6.5L15 6v11.5H5z" />
      <path d="M11.5 2.5V6H15" />
    </svg>
  );
}

function Eyebrow({ children, dark = false }: { children: ReactNode; dark?: boolean }) {
  return <p className={`text-xs font-bold uppercase tracking-[0.16em] ${dark ? 'text-blue-300' : 'text-accent-strong'}`}>{children}</p>;
}

function Heading({ id, children, dark = false }: { id: string; children: ReactNode; dark?: boolean }) {
  return (
    <h2 id={id} className={`mt-3 font-display text-3xl font-extrabold leading-[1.1] tracking-tight md:text-[2.75rem] ${dark ? 'text-white' : 'text-ink'}`}>
      {children}
    </h2>
  );
}

function Lines({ rows = 3, tone = 'bg-slate-200' }: { rows?: number; tone?: string }) {
  return (
    <div className="space-y-2">
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className={`h-2 rounded-full ${tone} ${i === rows - 1 ? 'w-3/5' : i % 2 ? 'w-4/5' : 'w-full'}`} />
      ))}
    </div>
  );
}


// ---------- mock-ups ----------

function ResumeSheet({ role, className = '' }: { role: string; className?: string }) {
  return (
    <div className={`w-64 rounded-2xl border border-slate-200 bg-white p-6 shadow-[0_18px_40px_-20px_rgba(15,23,42,0.25)] sm:w-72 ${className}`}>
      <div className="flex items-center gap-3">
        <div className="h-10 w-10 rounded-full bg-blue-100" />
        <div className="flex-1 space-y-1.5">
          <div className="h-2 w-3/4 rounded-full bg-slate-300" />
          <div className="h-2 w-1/2 rounded-full bg-slate-200" />
        </div>
      </div>
      <span className="mt-4 inline-block rounded-full bg-ink px-3 py-1 text-xs font-semibold text-white">{role}</span>
      {[0, 1, 2].map((i) => (
        <div key={i} className="mt-4">
          <div className="mb-2 h-2 w-1/3 rounded-full bg-accent" />
          <Lines rows={3} />
        </div>
      ))}
    </div>
  );
}

const VERSIONS = [
  { title: 'Original upload', meta: 'Version 1', badge: 'Current', tone: 'bg-blue-100 text-blue-800' },
  { title: 'Tailored for Data Analyst', meta: 'Version 2', badge: 'Tailored', tone: 'bg-indigo-50 text-indigo-800' },
  { title: 'Frontend Developer PDF', meta: 'Version 3', badge: 'Exported PDF', tone: 'bg-slate-100 text-slate-700' },
];

const FAQS = [
  {
    q: 'Does Trutivo write things I have not done?',
    a: 'No. Tailoring suggestions and cover letters only use what your resume already says. If a job asks for a skill your resume does not list, Trutivo points that out instead of adding it, and nothing changes until you accept it.',
  },
  {
    q: 'What files can I upload?',
    a: 'PDF resumes up to 5 MB that contain selectable text. Scanned images of a resume cannot be read yet.',
  },
  {
    q: 'How are matches and ATS checks calculated?',
    a: 'By transparent rules plus a semantic model that runs on Trutivo’s own servers. Each score explains what it is based on. Scores are guidance about how well your resume covers a job, not a prediction of hiring decisions.',
  },
  {
    q: 'Can I keep several versions of my resume?',
    a: 'Yes. Every upload, tailored version and saved PDF is kept as a numbered version. You choose which one is current, compare versions side by side and go back at any time.',
  },
  {
    q: 'Which formats can I download?',
    a: 'PDF and editable Word (.docx), in the Classic, Modern or Compact template.',
  },
  {
    q: 'Who can see my resumes?',
    a: 'Only you. Files are stored privately and are only available to your account, which uses a secure, HTTP-only session.',
  },
];

const MORE = [
  { title: 'Cover letters', text: 'Draft a letter for a job from facts in your own resume, edit it and keep it with the application.' },
  { title: 'Application tracker', text: 'Track each application’s status, interview, contacts and full history in a list or board.' },
  { title: 'Reminders', text: 'Keep follow-ups, interviews and deadlines in one place, with suggestions from the dates you enter.' },
  { title: 'Mock interviews', text: 'Answer technical, behavioral and HR questions based on the job and get structured feedback.' },
  { title: 'Match history', text: 'Every saved resume-to-job analysis stays available, with scores and recommendations.' },
  { title: 'Insights', text: 'See applications over time, interview and offer counts, and what needs attention next.' },
];

export default function Home() {
  return (
    <>
      <AosInit />
      <ScrollToSectionOnLoad />

      {/* Hero */}
      <section className="mx-auto h-screen grid max-w-[90%] items-center gap-12 overflow-x-clip px-4 pb-20 pt-12 md:px-8 md:pt-16 lg:grid-cols-[1.05fr_1fr] lg:pb-28">
        <div>
          <div data-aos="fade-down" data-aos-duration="600">
            <p className="inline-flex items-center gap-2 rounded-full border border-slate-300 bg-white px-4 py-1.5 text-[11px] font-bold uppercase tracking-[0.16em] text-accent-strong shadow-xs">
              <span aria-hidden="true" className="h-2 w-2 rounded-full bg-accent" />
              One resume. Every role you target.
            </p>
          </div>
          <h1
            data-aos="fade-up"
            data-aos-duration="750"
            data-aos-delay="100"
            className="mt-6 font-display text-[2.75rem] font-extrabold leading-[1.04] tracking-tight text-ink sm:text-6xl lg:text-[4.25rem]"
          >
            Tailor your resume for every role you target.
          </h1>
          <p
            data-aos="fade-up"
            data-aos-duration="750"
            data-aos-delay="200"
            className="mt-6 max-w-xl text-lg leading-relaxed text-slate-600"
          >
            Stop rewriting your resume for each application. Upload it once, compare it with each job description, review the changes Trutivo suggests and keep every role-specific version in one place.
          </p>
          <div
            data-aos="fade-up"
            data-aos-duration="750"
            data-aos-delay="300"
            className="mt-8 flex flex-wrap gap-3"
          >
            <Link href="/signup" className={primary}>
              Get started
            </Link>
            <Link href="/login" className={secondary}>
              I already have an account
            </Link>
          </div>
          <ul
            data-aos="fade-up"
            data-aos-duration="750"
            data-aos-delay="400"
            className="mt-8 flex flex-wrap gap-x-6 gap-y-2 text-sm text-slate-600"
          >
            {['Version history', 'Job-specific tailoring', 'ATS readiness check'].map((t) => (
              <li key={t} className="flex items-center gap-2">
                <Check />
                {t}
              </li>
            ))}
          </ul>
        </div>
        <div aria-hidden="true" className="relative mx-auto h-[420px] w-full max-w-full sm:h-[460px]">
          <div data-aos="fade-right" data-aos-delay="250" data-aos-duration="850" className="absolute left-0 top-12 sm:left-2">
            <ResumeSheet role="Data Analyst" className="-rotate-6 opacity-95 transition-transform duration-300 hover:rotate-0 hover:scale-105" />
          </div>
          <div data-aos="fade-left" data-aos-delay="350" data-aos-duration="850" className="absolute right-0 top-16 sm:right-2">
            <ResumeSheet role="UX Designer" className="rotate-6 opacity-95 transition-transform duration-300 hover:rotate-0 hover:scale-105" />
          </div>
          <div data-aos="zoom-in" data-aos-delay="150" data-aos-duration="850" className="absolute left-1/2 top-0 -translate-x-1/2">
            <ResumeSheet role="Frontend Developer" className="transition-transform duration-300 hover:scale-105" />
          </div>
        </div>
      </section>

      {/* Multiple resume versions */}
      <section id="features" aria-labelledby="versions-title" className="scroll-mt-20 border-t border-line bg-canvas py-20 md:py-24">
        <div className="mx-auto max-w-[90%] px-4 md:px-8">
          <div data-aos="fade-up" data-aos-duration="700">
            <Eyebrow>Multiple resume versions</Eyebrow>
            <Heading id="versions-title">Keep all your role-specific resumes organised.</Heading>
            <p className="mt-4 max-w-xl text-lg text-slate-600">
              Each upload, tailored version and saved PDF becomes a numbered version of the same resume. Choose which one is current, compare two side by side and go back at any time.
            </p>
          </div>
          <div aria-hidden="true" className="mt-12 grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
            {VERSIONS.map((v, i) => (
              <div
                key={v.title}
                data-aos="fade-up"
                data-aos-delay={(i + 1) * 100}
                data-aos-duration="700"
                className="rounded-2xl border border-slate-200 bg-white p-6 shadow-xs transition-all duration-300 hover:-translate-y-1 hover:shadow-md"
              >
                <div className="flex items-start justify-between">
                  <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-ink text-accent">
                    <DocGlyph />
                  </span>
                  <span className={`rounded-full px-3 py-1 text-xs font-semibold ${v.tone}`}>{v.badge}</span>
                </div>
                <p className="mt-5 font-semibold text-ink">{v.title}</p>
                <p className="text-sm text-slate-500">{v.meta}</p>
                <div className="mt-5">
                  <Lines rows={2} />
                </div>
                <p className="mt-5 text-sm font-semibold text-accent-strong">Open version →</p>
              </div>
            ))}
            <div
              data-aos="fade-up"
              data-aos-delay="400"
              data-aos-duration="700"
              className="flex min-h-56 flex-col items-center justify-center rounded-2xl border-2 border-dashed border-slate-300 text-slate-600 transition-all duration-300 hover:border-accent hover:text-accent-strong hover:bg-teal-50/20"
            >
              <span className="text-3xl font-light">+</span>
              <span className="mt-1 text-sm font-semibold">Upload a new version</span>
            </div>
          </div>
          <div data-aos="fade-in" data-aos-delay="450">
          </div>
        </div>
      </section>

      {/* How it works / tailoring */}
      <section id="how-it-works" aria-labelledby="how-title" className="scroll-mt-20 bg-ink py-20 md:py-24">
        <div className="mx-auto grid max-w-[90%] items-center gap-14 px-4 md:px-8 lg:grid-cols-2 [&>*]:min-w-0">
          <div data-aos="fade-right" data-aos-duration="750">
            <Eyebrow dark>How it works</Eyebrow>
            <Heading id="how-title" dark>
              From one resume to a tailored version in three steps.
            </Heading>
            <ol className="mt-10 space-y-8">
              {[
                ['Upload your resume once', 'Trutivo reads the PDF and picks out your skills, experience, education and projects.'],
                ['Add the job you are going after', 'Paste the job description. Required and preferred skills, experience and responsibilities are extracted.'],
                ['Review a tailored draft', 'Accept, edit or reject each suggested change, preview the result and keep it as a new version.'],
              ].map(([title, text], i) => (
                <li
                  key={title}
                  data-aos="fade-right"
                  data-aos-delay={(i + 1) * 150}
                  data-aos-duration="700"
                  className="flex gap-5"
                >
                  <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-accent font-display text-base font-bold text-ink shadow-sm">{i + 1}</span>
                  <div>
                    <p className="text-lg font-semibold text-white">{title}</p>
                    <p className="mt-1 text-slate-300">{text}</p>
                  </div>
                </li>
              ))}
            </ol>
          </div>
          <div data-aos="fade-left" data-aos-delay="200" data-aos-duration="850">
            <div aria-hidden="true" className="rounded-3xl bg-white p-6 shadow-2xl md:p-8">
              <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">Target job</p>
              <div className="mt-2 rounded-xl border border-slate-300 px-4 py-3 font-semibold text-ink">Data Analyst</div>
              <p className="mt-6 text-xs font-semibold uppercase tracking-wider text-slate-500">From your resume</p>
              <div className="mt-2 flex flex-wrap gap-2">
                {['Experience', 'Education', 'Skills', 'Projects'].map((c) => (
                  <span key={c} className="rounded-full bg-blue-100 px-3 py-1 text-sm font-semibold text-blue-800">
                    {c}
                  </span>
                ))}
              </div>
              <div className="mt-6 rounded-full bg-accent py-3 text-center font-semibold text-ink shadow-xs">Suggest changes</div>
              <div className="mt-6 rounded-xl bg-slate-100 p-5">
                <p className="text-sm font-semibold text-ink">Suggested changes · 3 to review</p>
                <div className="mt-4">
                  <Lines rows={3} tone="bg-slate-300" />
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Job-specific customization */}
      <section aria-labelledby="match-title" className="py-20 md:py-24">
        <div className="mx-auto max-w-[90%] px-4 md:px-8">
          <div data-aos="fade-up" data-aos-duration="700">
            <Eyebrow>Job-specific matching</Eyebrow>
            <Heading id="match-title">Adapt your resume to a particular job description.</Heading>
            <p className="mt-4 max-w-xl text-lg text-slate-600">
              Paste a job description and Trutivo shows which requirements your resume already covers, which are missing and what to change, with a match score that explains itself.
            </p>
          </div>
          <div aria-hidden="true" className="mt-12 grid items-center gap-6 lg:grid-cols-[1fr_auto_1fr]">
            <div
              data-aos="fade-right"
              data-aos-delay="100"
              data-aos-duration="750"
              className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm md:p-7"
            >
              <p className="text-xs font-bold uppercase tracking-[0.14em] text-slate-500">Job description</p>
              <p className="mt-4 text-lg leading-9 text-slate-700">
                We are looking for an analyst with strong <mark className="rounded bg-blue-100 px-1.5 font-semibold text-blue-800">SQL</mark> and{' '}
                <mark className="rounded bg-blue-100 px-1.5 font-semibold text-blue-800">Python</mark> skills, who can build{' '}
                <mark className="rounded bg-blue-100 px-1.5 font-semibold text-blue-800">dashboards</mark> and explain results to{' '}
                <mark className="rounded bg-blue-100 px-1.5 font-semibold text-blue-800">stakeholders</mark>.
              </p>
              <div className="mt-5">
                <Lines rows={3} />
              </div>
            </div>
            <div data-aos="zoom-in" data-aos-delay="250" data-aos-duration="600" className="flex justify-center">
              <span className="flex h-14 w-14 rotate-90 items-center justify-center rounded-full bg-ink text-accent shadow-md transition-transform duration-300 hover:scale-110 lg:rotate-0">
                <svg viewBox="0 0 20 20" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M4 10h12M11 5l5 5-5 5" />
                </svg>
              </span>
            </div>
            <div
              data-aos="fade-left"
              data-aos-delay="350"
              data-aos-duration="750"
              className="rounded-2xl border-2 border-accent bg-white p-6 shadow-sm md:p-7"
            >
              <div className="flex items-center justify-between gap-3">
                <p className="text-xs font-bold uppercase tracking-[0.14em] text-accent-strong">Match analysis</p>
                <p className="text-sm font-semibold text-ink">Match score 72%</p>
              </div>
              <div className="mt-4 flex flex-wrap gap-2">
                {['SQL', 'Python', 'Stakeholders'].map((s) => (
                  <span key={s} className="rounded-full bg-blue-100 px-3 py-1 text-sm font-semibold text-blue-800">
                    ✓ {s}
                  </span>
                ))}
                <span className="rounded-full bg-amber-100 px-3 py-1 text-sm font-semibold text-amber-900">Missing: dashboards</span>
              </div>
              <p className="mt-6 text-sm font-semibold text-slate-600">Suggested changes</p>
              <ul className="mt-3 space-y-3 text-slate-700">
                {['Lead your skills section with SQL and Python', 'Describe dashboard work, if you have done it', 'Use the role title in your summary'].map((t) => (
                  <li key={t} className="flex items-start gap-3">
                    <Check className="mt-1 text-accent-strong" />
                    {t}
                  </li>
                ))}
              </ul>
            </div>
          </div>
          <div data-aos="fade-in" data-aos-delay="400">
          </div>
        </div>
      </section>

      {/* Editor and templates */}
      <section aria-labelledby="templates-title" className="border-t border-line py-20 md:py-24">
        <div className="mx-auto max-w-[90%] px-4 md:px-8">
          <div data-aos="fade-up" data-aos-duration="700">
            <Eyebrow>Review and templates</Eyebrow>
            <Heading id="templates-title">Review every change, then choose a template.</Heading>
            <p className="mt-4 max-w-xl text-lg text-slate-600">
              Accept, edit or reject each suggestion and see the result before you save. Switch between templates without losing a word.
            </p>
          </div>
          <div aria-hidden="true" className="mt-12 grid gap-8 lg:grid-cols-[1.4fr_1fr]">
            <div
              data-aos="fade-right"
              data-aos-delay="150"
              data-aos-duration="750"
              className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm"
            >
              <div className="flex gap-2 border-b border-slate-100 pb-4">
                {['Accept', 'Edit', 'Reject'].map((b, i) => (
                  <span key={b} className={`rounded-lg px-3 py-1.5 text-xs font-semibold ${i === 0 ? 'bg-blue-100 text-blue-800' : 'bg-slate-100 text-slate-600'}`}>
                    {b}
                  </span>
                ))}
              </div>
              {[0, 1, 2].map((i) => (
                <div key={i} className="mt-6">
                  <div className="mb-3 h-2.5 w-1/3 rounded-full bg-accent" />
                  <Lines rows={3} />
                </div>
              ))}
            </div>
            <div data-aos="fade-left" data-aos-delay="250" data-aos-duration="750">
              <p className="text-xs font-bold uppercase tracking-[0.14em] text-slate-500">Templates</p>
              <div className="mt-4 grid grid-cols-3 gap-3">
                {[
                  ['Classic', 'bg-ink', false],
                  ['Modern', 'bg-accent', true],
                  ['Compact', 'bg-slate-600', false],
                ].map(([name, bar, active], idx) => (
                  <div
                    key={name as string}
                    data-aos="zoom-in"
                    data-aos-delay={300 + idx * 100}
                    data-aos-duration="600"
                    className="text-center"
                  >
                    <div className={`rounded-xl border bg-white p-3 transition-transform duration-300 hover:scale-105 ${active ? 'border-2 border-accent shadow-md' : 'border-slate-200'}`}>
                      <div className={`mb-3 h-2.5 w-1/2 rounded ${bar}`} />
                      <Lines rows={4} />
                    </div>
                    <p className="mt-2 text-sm font-semibold text-ink">{name as string}</p>
                  </div>
                ))}
              </div>
            </div>
          </div>
          <div data-aos="fade-in" data-aos-delay="400">
          </div>
        </div>
      </section>

      {/* ATS readiness */}
      <section aria-labelledby="ats-title" className="bg-ink py-20 md:py-24">
        <div className="mx-auto grid max-w-[90%] items-center gap-14 px-4 md:px-8 lg:grid-cols-2 [&>*]:min-w-0">
          <div data-aos="fade-right" data-aos-duration="750">
            <Eyebrow dark>ATS readiness</Eyebrow>
            <Heading id="ats-title" dark>
              Check your resume and see what to improve.
            </Heading>
            <p className="mt-4 max-w-lg text-lg text-slate-300">Know how applicant tracking software is likely to read each version before you apply.</p>
            <ul className="mt-8 space-y-4 text-slate-200">
              {['Clear, standard section headings', 'Text that parses cleanly', 'Contact details that can be found'].map((t, idx) => (
                <li
                  key={t}
                  data-aos="fade-up"
                  data-aos-delay={150 + idx * 100}
                  data-aos-duration="600"
                  className="flex items-center gap-3"
                >
                  <Check className="text-blue-300" />
                  {t}
                </li>
              ))}
              <li
                data-aos="fade-up"
                data-aos-delay="450"
                data-aos-duration="600"
                className="flex items-center gap-3"
              >
                <span aria-hidden="true" className="w-4 text-center font-bold text-amber-300">!</span>
                Content issues, such as missing dates or very long bullet points
              </li>
            </ul>
          </div>
          <div data-aos="zoom-in" data-aos-delay="200" data-aos-duration="800">
            <div aria-hidden="true" className="flex flex-col items-center gap-8 rounded-3xl bg-white p-8 shadow-2xl sm:flex-row">
              <div className="relative h-36 w-36 shrink-0 rounded-full bg-[conic-gradient(var(--color-accent)_0_82%,var(--color-slate-200)_82%_100%)] p-3 shadow-inner">
                <div className="flex h-full w-full flex-col items-center justify-center rounded-full bg-white">
                  <span className="font-display text-4xl font-extrabold text-ink">82</span>
                  <span className="text-sm text-slate-500">of 100</span>
                </div>
              </div>
              <div className="w-full">
                <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">Improvements found</p>
                <p className="mt-3 rounded-full bg-amber-100 px-4 py-1.5 text-sm font-semibold text-amber-900">2 content issues</p>
                <p className="mt-2 rounded-full bg-amber-100 px-4 py-1.5 text-sm font-semibold text-amber-900">1 formatting issue</p>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Export and management */}
      <section aria-labelledby="export-title" className="py-20 md:py-24">
        <div className="mx-auto grid max-w-[90%] items-center gap-12 px-4 md:px-8 lg:grid-cols-2 [&>*]:min-w-0">
          <div data-aos="fade-right" data-aos-duration="750">
            <Eyebrow>Export and management</Eyebrow>
            <Heading id="export-title">Save versions and download finished resumes.</Heading>
            <p className="mt-4 max-w-lg text-lg text-slate-600">Download any version as a PDF or an editable Word document, and keep an exported PDF as a new version.</p>
          </div>
          <div data-aos="fade-left" data-aos-delay="200" data-aos-duration="750">
            <ul aria-hidden="true" className="space-y-3">
              {[
                ['Data Analyst resume', 'PDF'],
                ['UX Designer resume', 'DOCX'],
                ['Frontend Developer resume', 'PDF'],
              ].map(([name, type], idx) => (
                <li
                  key={name}
                  data-aos="fade-left"
                  data-aos-delay={200 + idx * 100}
                  data-aos-duration="600"
                  className="flex items-center gap-4 rounded-2xl border border-slate-200 bg-white px-5 py-4 shadow-xs transition-transform duration-300 hover:-translate-y-0.5 hover:shadow-sm"
                >
                  <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-blue-100 text-accent-strong">
                    <DocGlyph />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-semibold text-ink">{name}</span>
                    <span className="text-sm text-slate-500">Saved version</span>
                  </span>
                  <span className="hidden rounded-full bg-slate-100 px-3 py-1 text-xs font-bold text-slate-600 sm:inline">{type}</span>
                  <span className="rounded-full border border-slate-300 px-4 py-1.5 text-sm font-semibold text-ink transition-colors hover:bg-slate-50">Download</span>
                </li>
              ))}
            </ul>
            <div data-aos="fade-in" data-aos-delay="400">
            </div>
          </div>
        </div>
      </section>

      {/* The rest of the job search */}
      <section aria-labelledby="more-title" className="border-t border-line bg-white py-20 md:py-24">
        <div className="mx-auto max-w-[90%] px-4 md:px-8">
          <div data-aos="fade-up" data-aos-duration="700">
            <Eyebrow>Beyond the resume</Eyebrow>
            <Heading id="more-title">Everything for the rest of your application.</Heading>
          </div>
          <dl className="mt-12 grid gap-x-12 gap-y-10 sm:grid-cols-2 lg:grid-cols-3">
            {MORE.map((f, idx) => (
              <div
                key={f.title}
                data-aos="fade-up"
                data-aos-delay={((idx % 3) + 1) * 120}
                data-aos-duration="650"
                className="border-l-2 border-accent pl-5 transition-transform duration-300 hover:translate-x-1"
              >
                <dt className="font-semibold text-ink">{f.title}</dt>
                <dd className="mt-1.5 text-slate-600">{f.text}</dd>
              </div>
            ))}
          </dl>
        </div>
      </section>

      {/* FAQ */}
      <section id="faq" aria-labelledby="faq-title" className="scroll-mt-20 py-20 md:py-24">
        <div className="mx-auto grid max-w-[90%] gap-10 px-4 md:px-8 lg:grid-cols-[1fr_1.6fr]">
          <div data-aos="fade-right" data-aos-duration="700">
            <Eyebrow>FAQ</Eyebrow>
            <Heading id="faq-title">Questions, answered.</Heading>
          </div>
          <div className="divide-y divide-slate-200 border-y border-slate-200">
            {FAQS.map((f, idx) => (
              <details
                key={f.q}
                data-aos="fade-up"
                data-aos-delay={((idx % 4) + 1) * 80}
                data-aos-duration="600"
                className="group py-5"
              >
                <summary className="flex cursor-pointer list-none items-center justify-between gap-6 font-semibold text-ink [&::-webkit-details-marker]:hidden">
                  {f.q}
                  <span aria-hidden="true" className="text-xl font-light text-slate-500 transition-transform group-open:rotate-45">
                    +
                  </span>
                </summary>
                <p className="mt-3 max-w-2xl text-slate-600">{f.a}</p>
              </details>
            ))}
          </div>
        </div>
      </section>

      {/* Call to action */}
      <section aria-labelledby="cta-title" className="px-4 pb-20 md:px-8 md:pb-24">
        <div
          data-aos="zoom-in"
          data-aos-duration="800"
          className="mx-auto max-w-[90%] rounded-3xl bg-accent px-6 py-14 text-center shadow-xl md:py-16"
        >
          <h2
            id="cta-title"
            data-aos="fade-up"
            data-aos-delay="100"
            data-aos-duration="700"
            className="font-display text-3xl font-extrabold tracking-tight text-ink md:text-4xl"
          >
            Create your next resume version with Trutivo.
          </h2>
          <p
            data-aos="fade-up"
            data-aos-delay="200"
            data-aos-duration="700"
            className="mt-3 text-lg text-ink/80"
          >
            One resume. The right version for every role.
          </p>
          <div data-aos="fade-up" data-aos-delay="300" data-aos-duration="700">
            <Link
              href="/signup"
              className="mt-8 inline-flex items-center justify-center rounded-full bg-ink px-7 py-3 text-sm font-semibold text-white shadow-md transition-all duration-300 hover:bg-slate-800 hover:shadow-lg"
            >
              Get started
            </Link>
          </div>
        </div>
      </section>
    </>
  );
}
