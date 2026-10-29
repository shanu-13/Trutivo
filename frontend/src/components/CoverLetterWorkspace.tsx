"use client";

import { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { getResumeList, type ResumeSummary } from '@/lib/api/resume.api';
import { getJobDescriptionList, type JobDescriptionSummary } from '@/lib/api/jobDescription.api';
import {
  LENGTHS,
  MAX_COVER_LETTER_LENGTH,
  MAX_COVER_LETTER_TITLE,
  TONES,
  createCoverLetter,
  deleteCoverLetter,
  generateCoverLetter,
  updateCoverLetter,
  type CoverLetterLength,
  type CoverLetterTone,
  type GeneratedCoverLetter,
  type SavedCoverLetter,
} from '@/lib/api/coverLetter.api';
import { errorMessage, formatDateTime } from '@/lib/format';
import { versionName } from '@/lib/resumeStatus';
import ConfirmDialog from '@/components/ConfirmDialog';

const selectClass = 'w-full border border-gray-300 rounded-lg px-3 py-2 bg-white text-sm focus:outline-none focus:ring-2 focus:ring-blue-500';
const countWords = (text: string) => (text.match(/\S+/g) ?? []).length;

interface Props {
  // A saved letter to edit, or null to start a new one.
  saved: SavedCoverLetter | null;
  preselectResumeId?: string | null;
  preselectJobDescriptionId?: string | null;
}

interface Snapshot {
  title: string;
  content: string;
  tone: CoverLetterTone;
  length: CoverLetterLength;
}

// Generate, edit, save and copy a cover letter (Step 12). The text is plain
// text in a textarea (never rendered as HTML), and unsaved work is protected:
// regenerating over edited text asks first and keeps the old text restorable,
// and leaving the page with unsaved changes asks for confirmation.
export default function CoverLetterWorkspace({ saved, preselectResumeId, preselectJobDescriptionId }: Props) {
  const router = useRouter();
  const [resumes, setResumes] = useState<ResumeSummary[] | null>(null);
  const [jobs, setJobs] = useState<JobDescriptionSummary[] | null>(null);
  const [sourcesError, setSourcesError] = useState('');
  const [resumeId, setResumeId] = useState(saved?.resume?.id ?? preselectResumeId ?? '');
  const [jobId, setJobId] = useState(saved?.jobDescription?.id ?? preselectJobDescriptionId ?? '');
  const [tone, setTone] = useState<CoverLetterTone>(saved?.tone ?? 'professional');
  const [length, setLength] = useState<CoverLetterLength>(saved?.length ?? 'standard');
  const [title, setTitle] = useState(saved?.title ?? '');
  const [content, setContent] = useState(saved?.content ?? '');
  const [savedId, setSavedId] = useState<string | null>(saved?.id ?? null);
  const [savedAt, setSavedAt] = useState<string | null>(saved?.updatedAt ?? null);
  // What the text was when last saved (or null if never saved).
  const [baseline, setBaseline] = useState<Snapshot | null>(saved ? { title: saved.title, content: saved.content, tone: saved.tone, length: saved.length } : null);
  // Text as last generated, to tell whether the user has edited it since.
  const [generatedText, setGeneratedText] = useState<string | null>(null);
  const [generated, setGenerated] = useState<GeneratedCoverLetter | null>(null);
  const [meta, setMeta] = useState({ roleTitle: saved?.roleTitle ?? null, companyName: saved?.companyName ?? null, resumeId: saved?.resume?.id ?? null, jobDescriptionId: saved?.jobDescription?.id ?? null });
  const [previousContent, setPreviousContent] = useState<string | null>(null);
  const [busy, setBusy] = useState<'generate' | 'save' | 'delete' | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [confirmReplace, setConfirmReplace] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const busyRef = useRef(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    let cancelled = false;
    Promise.all([getResumeList(), getJobDescriptionList()])
      .then(([r, j]) => {
        if (cancelled) return;
        setResumes(r.filter((x) => x.extractionStatus === 'completed'));
        setJobs(j);
      })
      .catch((err: unknown) => {
        if (!cancelled) setSourcesError(errorMessage(err, 'Failed to load your resumes and job descriptions'));
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const dirty = useMemo(() => {
    if (!content.trim() && !baseline) return false;
    if (!baseline) return true;
    return baseline.title !== title || baseline.content !== content || baseline.tone !== tone || baseline.length !== length;
  }, [baseline, title, content, tone, length]);

  // Leaving the page (reload, close, typed address) with unsaved changes asks first.
  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener('beforeunload', warn);
    // In-app links are confirmed too.
    const onClick = (e: MouseEvent) => {
      const link = (e.target as HTMLElement | null)?.closest?.('a[href]') as HTMLAnchorElement | null;
      if (!link || link.target === '_blank' || link.hasAttribute('download')) return;
      if (!window.confirm('You have unsaved changes to this cover letter. Leave without saving?')) {
        e.preventDefault();
        e.stopPropagation();
      }
    };
    document.addEventListener('click', onClick, true);
    return () => {
      window.removeEventListener('beforeunload', warn);
      document.removeEventListener('click', onClick, true);
    };
  }, [dirty]);

  const usableJobs = (jobs ?? []).filter((j) => j.requirementsExtractedAt);
  const canGenerate = Boolean(resumeId && jobId && resumes?.some((r) => r.id === resumeId) && usableJobs.some((j) => j.id === jobId));
  // Editing after generation or after loading a saved letter means regenerating would replace the user's own text.
  const hasOwnEdits = content.trim() !== '' && content !== generatedText && content !== (baseline?.content ?? null);

  const runOnce = async (kind: 'generate' | 'save' | 'delete', action: () => Promise<void>) => {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(kind);
    setError('');
    setNotice('');
    try {
      await action();
    } catch (err: unknown) {
      setError(errorMessage(err, kind === 'generate' ? 'The cover letter could not be generated' : 'The cover letter could not be saved'));
    } finally {
      busyRef.current = false;
      setBusy(null);
    }
  };

  const generate = () =>
    runOnce('generate', async () => {
      const result = await generateCoverLetter({ resumeId, jobDescriptionId: jobId, tone, length });
      // The text being replaced stays restorable.
      if (content.trim() && content !== result.text) setPreviousContent(content);
      setContent(result.text);
      setGeneratedText(result.text);
      setGenerated(result);
      if (!title.trim()) setTitle(result.title);
      setMeta({ roleTitle: result.roleTitle, companyName: result.companyName, resumeId: result.resumeId, jobDescriptionId: result.jobDescriptionId });
      setNotice('Draft generated. Review it, fill in any [bracketed] parts and save.');
    });

  const requestGenerate = () => {
    if (hasOwnEdits) setConfirmReplace(true);
    else generate();
  };

  const save = () =>
    runOnce('save', async () => {
      const finalTitle = title.trim() || meta.roleTitle || 'Cover letter';
      if (savedId) {
        const updated = await updateCoverLetter(savedId, { title: finalTitle, content, tone, length });
        setTitle(updated.title);
        setBaseline({ title: updated.title, content: updated.content, tone: updated.tone, length: updated.length });
        setSavedAt(updated.updatedAt);
        setNotice('Saved.');
      } else {
        const created = await createCoverLetter({ title: finalTitle, content, tone, length, ...meta });
        setTitle(created.title);
        setBaseline({ title: created.title, content: created.content, tone: created.tone, length: created.length });
        setSavedId(created.id);
        setSavedAt(created.updatedAt);
        setNotice('Saved.');
        router.replace(`/dashboard/cover-letters/${created.id}`);
      }
    });

  const remove = () =>
    runOnce('delete', async () => {
      if (!savedId) return;
      await deleteCoverLetter(savedId);
      setBaseline({ title, content, tone, length }); // nothing left to protect
      router.push('/dashboard/cover-letters?deleted=1');
    });

  const copy = async () => {
    setError('');
    try {
      await navigator.clipboard.writeText(content);
      setNotice('Copied to the clipboard.');
    } catch {
      // Clipboard access can be blocked; select the text so it can be copied by hand.
      textareaRef.current?.select();
      setNotice('Select-all done: press Ctrl+C (or ⌘C) to copy.');
    }
  };

  const contentTooLong = content.length > MAX_COVER_LETTER_LENGTH;
  const words = countWords(content);
  const heading = meta.roleTitle ? `${meta.roleTitle}${meta.companyName ? ` at ${meta.companyName}` : ''}` : 'New cover letter';

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold mb-1 break-words">{savedId ? title || heading : 'New Cover Letter'}</h1>
        <p className="text-gray-600 break-words">{savedId || meta.roleTitle ? heading : 'Choose a resume and a job, then generate a draft.'}</p>
      </div>

      <div className="bg-blue-50 border border-blue-100 text-blue-900 rounded-lg p-4 text-sm space-y-1">
        <p className="font-semibold">Template-based drafts</p>
        <p>
          Drafts are written from fixed sentence templates using only facts in your resume and the job&apos;s requirements. No AI
          writing is used and nothing is invented. Review the draft, fill in any [bracketed] parts in your own words, and
          personalise it before sending.
        </p>
      </div>

      <section className="bg-white rounded-xl shadow-sm border border-gray-100 p-4 md:p-6 space-y-4" aria-labelledby="cl-setup">
        <h2 id="cl-setup" className="text-lg font-bold text-gray-900">
          Source and style
        </h2>
        {sourcesError && (
          <p role="alert" className="text-sm text-red-600 whitespace-pre-line">
            {sourcesError}
          </p>
        )}
        {resumes === null || jobs === null ? (
          !sourcesError && (
            <div className="animate-pulse space-y-3" role="status" aria-label="Loading resumes and job descriptions">
              <div className="h-10 bg-gray-100 rounded-lg" />
              <div className="h-10 bg-gray-100 rounded-lg" />
            </div>
          )
        ) : (
          <>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label htmlFor="cl-resume" className="block text-sm font-medium text-gray-800 mb-1">
                  Resume
                </label>
                {resumes.length === 0 ? (
                  <p className="text-sm text-gray-600">
                    No processed resumes yet.{' '}
                    <Link href="/resume/upload" className="text-blue-600 hover:text-blue-800 font-medium">
                      Upload a resume
                    </Link>
                  </p>
                ) : (
                  <select id="cl-resume" value={resumeId} onChange={(e) => setResumeId(e.target.value)} className={selectClass}>
                    <option value="">Select a resume</option>
                    {resumes.map((r) => (
                      <option key={r.id} value={r.id}>
                        {r.originalFilename} ({versionName(r)}
                        {r.isCurrent ? ', current' : ''})
                      </option>
                    ))}
                  </select>
                )}
              </div>
              <div>
                <label htmlFor="cl-job" className="block text-sm font-medium text-gray-800 mb-1">
                  Job description
                </label>
                {jobs.length === 0 ? (
                  <p className="text-sm text-gray-600">
                    No job descriptions yet.{' '}
                    <Link href="/job-descriptions/create" className="text-blue-600 hover:text-blue-800 font-medium">
                      Add a job description
                    </Link>
                  </p>
                ) : (
                  <>
                    <select id="cl-job" value={jobId} onChange={(e) => setJobId(e.target.value)} className={selectClass}>
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
                      <p className="text-xs text-gray-500 mt-1">Extract a job&apos;s requirements on its page before using it here.</p>
                    )}
                  </>
                )}
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <fieldset>
                <legend className="block text-sm font-medium text-gray-800 mb-1">Tone</legend>
                <div className="grid grid-cols-2 gap-2">
                  {TONES.map((t) => (
                    <label key={t.id} className={`border rounded-lg px-3 py-2 text-sm cursor-pointer has-[input:focus-visible]:ring-2 has-[input:focus-visible]:ring-blue-500 ${tone === t.id ? 'border-blue-500 bg-blue-50' : 'border-gray-200'}`}>
                      <input type="radio" name="cl-tone" value={t.id} checked={tone === t.id} onChange={() => setTone(t.id)} className="mr-2 accent-blue-600" />
                      <span className="font-medium">{t.label}</span>
                      <span className="block text-xs text-gray-500">{t.description}</span>
                    </label>
                  ))}
                </div>
              </fieldset>
              <fieldset>
                <legend className="block text-sm font-medium text-gray-800 mb-1">Length</legend>
                <div className="grid grid-cols-1 gap-2">
                  {LENGTHS.map((l) => (
                    <label key={l.id} className={`border rounded-lg px-3 py-2 text-sm cursor-pointer has-[input:focus-visible]:ring-2 has-[input:focus-visible]:ring-blue-500 ${length === l.id ? 'border-blue-500 bg-blue-50' : 'border-gray-200'}`}>
                      <input type="radio" name="cl-length" value={l.id} checked={length === l.id} onChange={() => setLength(l.id)} className="mr-2 accent-blue-600" />
                      <span className="font-medium">{l.label}</span>
                      <span className="block text-xs text-gray-500">{l.description}</span>
                    </label>
                  ))}
                </div>
              </fieldset>
            </div>

            <button
              onClick={requestGenerate}
              disabled={!canGenerate || busy !== null}
              aria-busy={busy === 'generate'}
              className="bg-blue-600 text-white px-5 py-2.5 rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition font-medium"
            >
              {busy === 'generate' ? 'Generating...' : content.trim() ? 'Regenerate' : 'Generate'}
            </button>
            {!canGenerate && <p className="text-xs text-gray-500">Choose a processed resume and a job description with extracted requirements.</p>}
          </>
        )}
      </section>

      {error && (
        <div role="alert" className="bg-red-50 text-red-600 p-3 rounded-lg text-sm border border-red-100 space-y-2">
          <p className="whitespace-pre-line">{error}</p>
          {busy === null && canGenerate && !content.trim() && (
            <button onClick={generate} className="text-sm bg-white border border-red-200 hover:bg-red-50 px-3 py-1 rounded">
              Try again
            </button>
          )}
        </div>
      )}
      {notice && (
        <p role="status" className="bg-green-50 text-green-700 p-3 rounded-lg text-sm border border-green-100">
          {notice}
        </p>
      )}

      <section className="bg-white rounded-xl shadow-sm border border-gray-100 p-4 md:p-6 space-y-3" aria-labelledby="cl-editor">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 id="cl-editor" className="text-lg font-bold text-gray-900">
            Cover letter
          </h2>
          <p className={`text-sm ${dirty ? 'text-amber-700' : 'text-gray-500'}`} role="status">
            {dirty ? '● Unsaved changes' : savedAt ? `✓ Saved ${formatDateTime(savedAt)}` : ''}
          </p>
        </div>

        {!content.trim() && !generated && !savedId ? (
          <p className="text-sm text-gray-500 border border-dashed border-gray-300 rounded-lg p-6 text-center">
            No draft yet. Choose a resume and a job above, then select Generate.
          </p>
        ) : (
          <>
            <div>
              <label htmlFor="cl-title" className="block text-sm font-medium text-gray-800 mb-1">
                Title
              </label>
              <input
                id="cl-title"
                value={title}
                maxLength={MAX_COVER_LETTER_TITLE}
                onChange={(e) => setTitle(e.target.value)}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
            <div>
              <label htmlFor="cl-content" className="block text-sm font-medium text-gray-800 mb-1">
                Letter text
              </label>
              <textarea
                id="cl-content"
                ref={textareaRef}
                value={content}
                onChange={(e) => setContent(e.target.value)}
                rows={18}
                aria-describedby="cl-count"
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm leading-relaxed focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
              <p id="cl-count" className={`text-xs mt-1 ${contentTooLong ? 'text-red-600' : 'text-gray-500'}`}>
                {words} words · {content.length.toLocaleString()} / {MAX_COVER_LETTER_LENGTH.toLocaleString()} characters
              </p>
            </div>

            {previousContent !== null && (
              <p className="text-sm text-gray-600">
                The previous text was replaced.{' '}
                <button
                  onClick={() => {
                    setContent(previousContent);
                    setPreviousContent(null);
                  }}
                  className="font-medium text-blue-600 hover:text-blue-800"
                >
                  Restore previous text
                </button>
              </p>
            )}

            {generated && (generated.placeholders.length > 0 || generated.notes.length > 0) && (
              <div className="bg-amber-50 border border-amber-100 rounded-lg p-3 text-sm space-y-1">
                {generated.placeholders.length > 0 && <p className="font-medium text-amber-900">Fill in before sending: {generated.placeholders.length} [bracketed] part(s).</p>}
                {generated.notes.map((n) => (
                  <p key={n} className="text-amber-900 break-words">
                    {n}
                  </p>
                ))}
              </div>
            )}

            <div className="flex flex-col sm:flex-row gap-2">
              <button
                onClick={save}
                disabled={busy !== null || !content.trim() || contentTooLong || (!dirty && savedId !== null)}
                aria-busy={busy === 'save'}
                className="bg-blue-600 text-white px-5 py-2.5 rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition font-medium"
              >
                {busy === 'save' ? 'Saving...' : 'Save'}
              </button>
              <button
                onClick={copy}
                disabled={!content.trim()}
                className="px-5 py-2.5 rounded-lg border border-gray-300 text-gray-800 hover:bg-gray-50 disabled:opacity-50 transition font-medium"
              >
                Copy to Clipboard
              </button>
              {savedId && (
                <button
                  onClick={() => setConfirmDelete(true)}
                  disabled={busy !== null}
                  className="px-5 py-2.5 rounded-lg border border-red-200 text-red-600 hover:bg-red-50 disabled:opacity-50 transition font-medium sm:ml-auto"
                >
                  Delete
                </button>
              )}
            </div>
          </>
        )}
      </section>

      <ConfirmDialog
        open={confirmReplace}
        title="Replace your edited text?"
        confirmLabel="Generate New Draft"
        busyLabel="Generating..."
        busy={busy === 'generate'}
        tone="primary"
        onConfirm={async () => {
          setConfirmReplace(false);
          await generate();
        }}
        onCancel={() => setConfirmReplace(false)}
      >
        <p>You have edited this letter. A new draft will replace the text in the editor.</p>
        <p>Your current text is kept, and you can restore it with &ldquo;Restore previous text&rdquo; until you leave the page.</p>
      </ConfirmDialog>
      <ConfirmDialog
        open={confirmDelete}
        title="Delete this cover letter?"
        confirmLabel="Delete Cover Letter"
        busyLabel="Deleting..."
        busy={busy === 'delete'}
        onConfirm={remove}
        onCancel={() => setConfirmDelete(false)}
      >
        <p>
          <span className="font-semibold">{title || 'This cover letter'}</span> will be permanently deleted. Your resume and job
          description are not affected.
        </p>
      </ConfirmDialog>
    </div>
  );
}
