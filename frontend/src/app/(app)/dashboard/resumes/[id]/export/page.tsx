"use client";

import { Suspense, useEffect, useRef, useState, type CSSProperties } from 'react';
import Link from 'next/link';
import { useParams, useSearchParams } from 'next/navigation';
import { useRequireAuth } from '@/hooks/useRequireAuth';
import { ApiError } from '@/lib/api/client';
import {
  DOCX_CONTENT_TYPE,
  downloadExportDocx,
  downloadExportPdf,
  getExportPreview,
  saveBlob,
  saveExportVersion,
  type ExportDocument,
  type ExportPreview,
  type TemplateId,
} from '@/lib/api/export.api';
import type { ResumeSummary } from '@/lib/api/resume.api';
import { errorMessage } from '@/lib/format';
import { versionName } from '@/lib/resumeStatus';

type Status = 'loading' | 'ready' | 'not_found' | 'error';

// On-screen approximation of the PDF templates (presentation only; the PDF is
// drawn by the server with the same text). 1pt is about 1.33px.
const STYLE: Record<TemplateId, { font: string; accent: string; name: number; body: number; heading: number; center: boolean; upper: boolean; rule: boolean; pad: string; gap: number }> = {
  classic: { font: '"DejaVu Serif", Georgia, "Times New Roman", serif', accent: '#111111', name: 27, body: 13.3, heading: 15.3, center: true, upper: true, rule: false, pad: 'clamp(16px, 9vw, 75px)', gap: 16 },
  modern: { font: '"DejaVu Sans", "Helvetica Neue", Arial, sans-serif', accent: '#1d4ed8', name: 29, body: 12.7, heading: 16, center: false, upper: false, rule: true, pad: 'clamp(16px, 8vw, 67px)', gap: 16 },
  compact: { font: '"DejaVu Sans Condensed", "Arial Narrow", Arial, sans-serif', accent: '#111111', name: 21, body: 11.7, heading: 13.3, center: false, upper: true, rule: true, pad: 'clamp(14px, 6vw, 51px)', gap: 10 },
};

function ResumePreview({ document: doc, template }: { document: ExportDocument; template: TemplateId }) {
  const s = STYLE[template];
  const text: CSSProperties = { fontSize: s.body, lineHeight: 1.4, color: '#333333' };
  return (
    <div
      className="bg-white shadow-md border border-gray-200 mx-auto w-full max-w-[794px] overflow-hidden"
      style={{ fontFamily: s.font, padding: s.pad, color: '#111111' }}
      aria-label={`Preview in the ${template} template`}
    >
      {doc.name && (
        <p style={{ fontSize: s.name, fontWeight: 700, color: template === 'modern' ? s.accent : '#111111', textAlign: s.center ? 'center' : 'left' }} className="break-words">
          {doc.name}
        </p>
      )}
      {doc.details.map((d, i) => (
        <p key={i} style={{ ...text, fontSize: s.body * 0.92, textAlign: s.center ? 'center' : 'left' }} className="break-words">
          {d}
        </p>
      ))}
      {doc.sections.map((section, i) => (
        <section key={i} style={{ marginTop: s.gap }}>
          <h3
            style={{
              fontSize: s.heading,
              fontWeight: 700,
              color: s.accent,
              textTransform: s.upper ? 'uppercase' : 'none',
              borderBottom: s.rule ? `1px solid ${template === 'modern' ? s.accent : '#666666'}` : 'none',
              marginBottom: 4,
            }}
            className="break-words"
          >
            {section.title}
          </h3>
          {section.blocks.map((b, j) =>
            b.type === 'bullet' ? (
              <p key={j} style={{ ...text, color: '#111111', paddingLeft: 15, textIndent: -11 }} className="break-words">
                • {b.text}
              </p>
            ) : (
              <p
                key={j}
                style={{ ...text, fontWeight: b.type === 'entry' ? 700 : 400, color: b.type === 'entry' ? '#111111' : '#333333', marginTop: b.type === 'entry' && j > 0 ? 6 : 0 }}
                className="break-words"
              >
                {b.text}
              </p>
            )
          )}
        </section>
      ))}
    </div>
  );
}

function ExportContent() {
  const { isAuthenticated, loading } = useRequireAuth();
  const { id } = useParams<{ id: string }>();
  const sessionId = useSearchParams().get('session');
  const [preview, setPreview] = useState<ExportPreview | null>(null);
  const [status, setStatus] = useState<Status>('loading');
  const [error, setError] = useState('');
  const [reloadKey, setReloadKey] = useState(0);
  const [template, setTemplate] = useState<TemplateId>('classic');
  const [downloading, setDownloading] = useState(false);
  const [downloadingDocx, setDownloadingDocx] = useState(false);
  const [notice, setNotice] = useState('');
  const [saving, setSaving] = useState(false);
  const [actionError, setActionError] = useState('');
  const [saved, setSaved] = useState<{ resume: ResumeSummary | null; created: boolean } | null>(null);
  // Blocks a second click that arrives before the disabled button has rendered.
  const busyRef = useRef(false);

  useEffect(() => {
    if (!isAuthenticated || !id) return;
    let cancelled = false;
    getExportPreview(id, sessionId)
      .then((data) => {
        if (cancelled) return;
        setPreview(data);
        setStatus('ready');
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        if (err instanceof ApiError && (err.status === 404 || err.status === 400)) setStatus('not_found');
        else {
          setError(errorMessage(err, 'Failed to prepare the export'));
          setStatus('error');
        }
      });
    return () => {
      cancelled = true;
    };
  }, [isAuthenticated, id, sessionId, reloadKey]);

  const runOnce = async (setBusy: (b: boolean) => void, action: () => Promise<void>) => {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    setActionError('');
    setNotice('');
    try {
      await action();
    } catch (err: unknown) {
      setActionError(errorMessage(err, 'The document could not be generated'));
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  };

  const download = () =>
    runOnce(setDownloading, async () => {
      const { blob, filename } = await downloadExportPdf(id, template, sessionId);
      if (blob.type !== 'application/pdf') throw new Error('The server did not return a PDF.');
      const name = filename ?? `resume-${template}.pdf`;
      saveBlob(blob, name);
      setNotice(`Downloaded ${name}.`);
    });

  const downloadDocx = () =>
    runOnce(setDownloadingDocx, async () => {
      const { blob, filename } = await downloadExportDocx(id, template, sessionId);
      if (blob.type !== DOCX_CONTENT_TYPE) throw new Error('The server did not return a Word document.');
      const name = filename ?? `resume-${template}.docx`;
      saveBlob(blob, name);
      setNotice(`Downloaded ${name}. It opens in Word, LibreOffice or Google Docs for editing.`);
    });

  const saveVersion = () =>
    runOnce(setSaving, async () => {
      setSaved(await saveExportVersion(id, template, sessionId));
    });

  if (loading) return <div className="p-8 text-center text-gray-600">Loading...</div>;
  if (!isAuthenticated) return null;

  const back = sessionId ? (
    <Link href={`/dashboard/resumes/${id}/tailoring/${sessionId}`} className="text-gray-500 hover:text-gray-800 text-sm">
      ← Back to Tailoring
    </Link>
  ) : (
    <Link href={`/dashboard/resumes/${id}`} className="text-gray-500 hover:text-gray-800 text-sm">
      ← Back to Resume
    </Link>
  );

  if (status === 'loading') {
    return (
      <div className="page-container p-4 md:p-8 space-y-4">
        {back}
        <div className="animate-pulse space-y-4" role="status" aria-label="Preparing export">
          <div className="h-24 bg-gray-100 rounded-xl" />
          <div className="h-96 bg-gray-100 rounded-xl" />
        </div>
      </div>
    );
  }
  if (status === 'not_found') {
    return (
      <div className="page-container p-4 md:p-8 text-center space-y-4" role="alert">
        <p className="text-gray-700 text-lg">Resume or tailoring session not found.</p>
        <Link href="/dashboard/resumes" className="text-blue-600 hover:text-blue-800 font-medium">
          Back to My Resumes
        </Link>
      </div>
    );
  }
  if (status === 'error' || !preview) {
    return (
      <div className="page-container p-4 md:p-8 space-y-4">
        {back}
        <div role="alert" className="space-y-3">
          <p className="text-red-600 font-medium whitespace-pre-line">{error}</p>
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
      </div>
    );
  }

  const busy = downloading || downloadingDocx || saving;

  return (
    <div className="page-container p-4 md:p-8 space-y-6">
      {back}
      <div>
        <h1 className="text-3xl font-bold mb-1">Export Resume</h1>
        <p className="text-gray-600 break-words">
          {preview.resume.originalFilename} ({versionName(preview.resume)})
          {preview.session && (
            <>
              {' '}
              · tailored for {preview.session.jobTitle}
              {preview.session.companyName ? ` at ${preview.session.companyName}` : ''}
            </>
          )}
        </p>
      </div>

      <div className="bg-blue-50 border border-blue-100 text-blue-900 rounded-lg p-4 text-sm space-y-1">
        <p className="font-semibold">Draft until you export</p>
        <p>
          {preview.session
            ? 'Contains your resume text with only the suggestions you accepted or edited and accepted. Pending and rejected suggestions are left out.'
            : 'Contains the text of this resume version as stored.'}{' '}
          Templates change only the layout, never the content. Your original resume is not changed.
        </p>
      </div>

      {preview.staleSuggestionCount > 0 && (
        <p role="alert" className="text-sm text-amber-700">
          {preview.staleSuggestionCount} accepted suggestion(s) no longer match the resume text and are not included.
        </p>
      )}
      {preview.unsupportedCharacters.length > 0 && (
        <p role="alert" className="text-sm text-amber-700 break-words">
          These characters cannot be shown by the PDF fonts and will appear as boxes: {preview.unsupportedCharacters.join(' ')}
        </p>
      )}

      <fieldset className="bg-white rounded-xl shadow-sm border border-gray-100 p-4 md:p-6">
        <legend className="sr-only">Template</legend>
        <h2 className="text-lg font-bold text-gray-900 mb-3" aria-hidden="true">
          Template
        </h2>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          {preview.templates.map((t) => (
            <label
              key={t.id}
              className={`border rounded-lg p-3 cursor-pointer has-[input:focus-visible]:ring-2 has-[input:focus-visible]:ring-blue-500 ${
                template === t.id ? 'border-blue-500 bg-blue-50' : 'border-gray-200 hover:bg-gray-50'
              }`}
            >
              <span className="flex items-center gap-2">
                <input
                  type="radio"
                  name="template"
                  value={t.id}
                  checked={template === t.id}
                  onChange={() => setTemplate(t.id)}
                  className="accent-blue-600"
                />
                <span className="font-semibold text-gray-900">{t.name}</span>
              </span>
              <span className="block text-sm text-gray-600 mt-1">{t.description}</span>
            </label>
          ))}
        </div>
      </fieldset>

      <section className="space-y-3" aria-labelledby="preview-heading">
        <h2 id="preview-heading" className="text-lg font-bold text-gray-900">
          Preview: {preview.templates.find((t) => t.id === template)?.name} <span className="text-sm font-normal text-gray-500">(draft)</span>
        </h2>
        <p className="text-sm text-gray-500">An on-screen approximation; page breaks are decided when the PDF is generated.</p>
        <div className="bg-gray-100 rounded-xl p-2 sm:p-4">
          <ResumePreview document={preview.document} template={template} />
        </div>
      </section>

      <section className="bg-white rounded-xl shadow-sm border border-gray-100 p-4 md:p-6 space-y-3" aria-labelledby="export-heading">
        <h2 id="export-heading" className="text-lg font-bold text-gray-900">
          Export
        </h2>
        <p className="text-sm text-gray-600">
          Download a PDF, or an editable Word document (.docx) with the same content. You can also keep the PDF as a new
          version of this resume (it does not become the current version). Word may lay out pages slightly differently.
        </p>
        {actionError && (
          <p role="alert" className="text-sm text-red-600 whitespace-pre-line">
            {actionError}
          </p>
        )}
        {notice && (
          <p role="status" className="text-sm text-green-700 break-words">
            {notice}
          </p>
        )}
        <div className="flex flex-col sm:flex-row gap-3">
          <button
            onClick={download}
            disabled={busy}
            aria-busy={downloading}
            className="bg-blue-600 text-white px-5 py-2.5 rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition font-medium"
          >
            {downloading ? 'Generating PDF...' : 'Download PDF'}
          </button>
          <button
            onClick={downloadDocx}
            disabled={busy}
            aria-busy={downloadingDocx}
            className="px-5 py-2.5 rounded-lg border border-blue-600 text-blue-700 hover:bg-blue-50 disabled:opacity-50 disabled:cursor-not-allowed transition font-medium"
          >
            {downloadingDocx ? 'Generating DOCX...' : 'Download DOCX'}
          </button>
          <button
            onClick={saveVersion}
            disabled={busy}
            aria-busy={saving}
            className="px-5 py-2.5 rounded-lg border border-gray-300 text-gray-800 hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed transition font-medium"
          >
            {saving ? 'Saving...' : 'Save as Version'}
          </button>
        </div>
        {saved?.resume && (
          <p role="status" className="text-sm text-green-700">
            {saved.created ? 'Saved as ' : 'Already saved as '}
            <Link href={`/dashboard/resumes/${saved.resume.id}`} className="underline font-medium">
              {versionName(saved.resume)}
            </Link>
            . It is not the current version unless you choose it in the version history.
          </p>
        )}
      </section>
    </div>
  );
}

// useSearchParams (for ?session=) must sit inside a Suspense boundary.
export default function ExportResume() {
  return (
    <Suspense fallback={<div className="p-8 text-center text-gray-600">Loading...</div>}>
      <ExportContent />
    </Suspense>
  );
}
