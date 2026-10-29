"use client";

import { Suspense, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useRequireAuth } from '@/hooks/useRequireAuth';
import {
  ACCEPTED_RESUME_TYPES,
  MAX_RESUME_SIZE_BYTES,
  MAX_VERSION_LABEL_LENGTH,
  getResume,
  uploadResume,
  uploadResumeVersion,
  type ResumeSummary,
} from '@/lib/api/resume.api';
import { errorMessage, formatFileSize } from '@/lib/format';
import { isExtractionInProgress, resumeStatusInfo, versionName } from '@/lib/resumeStatus';
import StatusBadge from '@/components/StatusBadge';
import FileIcon from '@/components/FileIcon';

const POLL_INTERVAL_MS = 2000;
const MAX_SIZE_LABEL = `${MAX_RESUME_SIZE_BYTES / 1024 / 1024} MB`;

// A quick check for a better message; the server validates every upload again.
const validateFile = (file: File) => {
  if (file.type !== 'application/pdf' && !file.name.toLowerCase().endsWith('.pdf')) return 'Only PDF files are allowed.';
  if (file.size > MAX_RESUME_SIZE_BYTES) return `File size must be ${MAX_SIZE_LABEL} or less.`;
  if (file.size === 0) return 'The selected file is empty.';
  return '';
};

function UploadResumeContent() {
  const { isAuthenticated, loading: authLoading } = useRequireAuth();
  // With ?versionOf=<resume id>, the upload becomes a new version of that resume.
  const versionOf = useSearchParams().get('versionOf');
  const [base, setBase] = useState<ResumeSummary | null>(null);
  const [baseError, setBaseError] = useState('');
  const [versionLabel, setVersionLabel] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [error, setError] = useState('');
  const [uploading, setUploading] = useState(false);
  const [uploaded, setUploaded] = useState<ResumeSummary | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  // Guards against a second submission before React re-renders the disabled button.
  const submittingRef = useRef(false);

  useEffect(() => {
    if (!isAuthenticated || !versionOf) return;
    let cancelled = false;
    getResume(versionOf)
      .then((data) => {
        if (!cancelled) setBase(data.data.resume as ResumeSummary);
      })
      .catch((err: unknown) => {
        if (!cancelled) setBaseError(errorMessage(err, 'Failed to load the resume'));
      });
    return () => {
      cancelled = true;
    };
  }, [isAuthenticated, versionOf]);

  // After the server confirms the upload, follow its text extraction.
  const extracting = uploaded !== null && isExtractionInProgress(uploaded.extractionStatus);
  useEffect(() => {
    if (!extracting || !uploaded) return;
    let cancelled = false;
    const timer = setTimeout(() => {
      getResume(uploaded.id)
        .then((data) => {
          if (!cancelled) setUploaded(data.data.resume as ResumeSummary);
        })
        .catch(() => {
          // Stop following and keep the last known status; the details page shows the latest one.
        });
    }, POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [extracting, uploaded]);

  if (authLoading) return <div className="p-8 text-center text-gray-600">Loading...</div>;
  if (!isAuthenticated) return null;

  if (versionOf && baseError) {
    return (
      <div className="page-container p-4 md:p-8 text-center space-y-4" role="alert">
        <p className="text-gray-700 text-lg whitespace-pre-line">{baseError}</p>
        <Link href="/dashboard/resumes" className="text-blue-600 hover:text-blue-800 font-medium">
          Back to My Resumes
        </Link>
      </div>
    );
  }
  if (versionOf && !base) return <div className="p-8 text-center text-gray-600" role="status">Loading...</div>;

  const selectFile = (selected: File | undefined) => {
    setError('');
    if (!selected) return;
    const problem = validateFile(selected);
    if (problem) {
      setError(problem);
      setFile(null);
      if (inputRef.current) inputRef.current.value = '';
      return;
    }
    setFile(selected);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    if (!uploading) selectFile(e.dataTransfer.files?.[0]);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (submittingRef.current) return;
    if (!file) return setError('Please select a PDF file.');
    if (versionLabel.trim().length > MAX_VERSION_LABEL_LENGTH) {
      return setError(`Version label must be at most ${MAX_VERSION_LABEL_LENGTH} characters.`);
    }

    submittingRef.current = true;
    setUploading(true);
    setError('');
    try {
      const data = versionOf ? await uploadResumeVersion(versionOf, file, versionLabel) : await uploadResume(file);
      // Shown as uploaded only after the server has confirmed it.
      setUploaded(data.data.resume as ResumeSummary);
      setFile(null);
    } catch (err: unknown) {
      setError(errorMessage(err, 'An error occurred during upload.'));
    } finally {
      submittingRef.current = false;
      setUploading(false);
    }
  };

  const uploadAnother = () => {
    setUploaded(null);
    setError('');
    if (inputRef.current) inputRef.current.value = '';
  };

  if (uploaded) {
    const info = resumeStatusInfo(uploaded.extractionStatus);
    return (
      <div className="page-container p-4 md:p-8">
        <div className="bg-white p-6 md:p-10 rounded-xl shadow-sm border border-gray-100 space-y-6">
          <div role="status" className="bg-green-50 text-green-700 p-4 rounded-lg text-sm font-medium border border-green-100">
            {versionOf ? `${versionName(uploaded)} uploaded successfully.` : 'Resume uploaded successfully.'}
          </div>
          <div className="space-y-2">
            <p className="font-semibold text-gray-900 break-all">{uploaded.originalFilename}</p>
            <div className="flex flex-wrap items-center gap-2 text-sm text-gray-600" aria-live="polite">
              <StatusBadge {...info} />
              <span>{info.description}</span>
            </div>
            {versionOf && (
              <p className="text-sm text-gray-600">
                {uploaded.extractionStatus === 'completed'
                  ? 'This version is now the current version. Earlier versions are kept.'
                  : uploaded.extractionStatus === 'failed' || uploaded.extractionStatus === 'no_text'
                    ? 'This version could not be processed, so the previous current version stays current. Earlier versions are kept.'
                    : 'It becomes the current version once its text has been extracted. Earlier versions are kept.'}
              </p>
            )}
          </div>
          <div className="flex flex-col sm:flex-row gap-3">
            <Link
              href={`/dashboard/resumes/${uploaded.id}`}
              className="bg-blue-600 text-white px-5 py-2.5 rounded-lg hover:bg-blue-700 transition font-medium text-center"
            >
              View Resume Details
            </Link>
            {versionOf ? (
              <Link
                href={`/dashboard/resumes/${uploaded.id}/versions`}
                className="px-5 py-2.5 rounded-lg border border-gray-300 text-gray-800 hover:bg-gray-50 transition font-medium text-center"
              >
                View Version History
              </Link>
            ) : (
              <button
                onClick={uploadAnother}
                className="px-5 py-2.5 rounded-lg border border-gray-300 text-gray-800 hover:bg-gray-50 transition font-medium"
              >
                Upload Another Resume
              </button>
            )}
            <Link href="/dashboard/resumes" className="px-5 py-2.5 text-center text-gray-600 hover:text-gray-900 font-medium">
              Go to My Resumes
            </Link>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="page-container p-4 md:p-8 min-h-[calc(100vh-64px)] flex flex-col justify-center">
      <div className="bg-white p-6 md:p-10 rounded-xl shadow-sm border border-gray-100 w-full">
        <h1 className="text-3xl font-bold mb-2 text-center text-gray-900">
          {base ? 'Upload a New Version' : 'Upload Your Resume'}
        </h1>
        {base && (
          <p className="text-center text-gray-700 mb-2 break-all">
            of <span className="font-semibold">{base.originalFilename}</span> ({versionName(base)}
            {base.versionCount > 1 ? ` of ${base.versionCount}` : ''}). Earlier versions are kept.
          </p>
        )}
        <p id="upload-rules" className="text-center text-gray-500 mb-8">
          PDF files only, up to {MAX_SIZE_LABEL}. The PDF must contain selectable text: scanned images are not supported (no OCR).
        </p>

        {error && (
          <div role="alert" className="bg-red-50 text-red-600 p-4 rounded-lg mb-6 text-sm text-center font-medium border border-red-100 whitespace-pre-line">
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-6">
          <label
            htmlFor="fileUpload"
            onDrop={handleDrop}
            onDragOver={(e) => e.preventDefault()}
            className={`border-2 border-dashed rounded-xl p-10 md:p-16 text-center transition cursor-pointer flex flex-col items-center justify-center has-[input:focus-visible]:ring-2 has-[input:focus-visible]:ring-blue-500 ${file ? 'border-blue-400 bg-blue-50' : 'border-gray-300 hover:bg-gray-50 bg-white'}`}
          >
            <FileIcon className="h-12 w-10 mb-3" />
            {file ? (
              <>
                <span className="text-lg text-blue-700 font-semibold break-all max-w-full px-4">{file.name}</span>
                <span className="text-sm text-blue-700 mt-1">({formatFileSize(file.size)})</span>
                <span className="text-sm text-gray-500 mt-2">Choose a different file</span>
              </>
            ) : (
              <>
                <span className="text-lg font-medium text-gray-700 mb-1">Drop a PDF here</span>
                <span className="text-sm text-gray-500">or click to choose a file</span>
              </>
            )}
            <input
              ref={inputRef}
              type="file"
              id="fileUpload"
              accept={ACCEPTED_RESUME_TYPES}
              aria-describedby="upload-rules"
              disabled={uploading}
              className="sr-only"
              onChange={(e) => selectFile(e.target.files?.[0])}
            />
          </label>

          {base && (
            <div>
              <label htmlFor="versionLabel" className="block font-medium text-gray-800 mb-1">
                Version label <span className="font-normal text-gray-500">(optional)</span>
              </label>
              <input
                id="versionLabel"
                type="text"
                value={versionLabel}
                onChange={(e) => setVersionLabel(e.target.value)}
                disabled={uploading}
                placeholder="e.g. Tailored for backend roles"
                aria-describedby="versionLabel-help"
                className="w-full border border-gray-300 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
              <p id="versionLabel-help" className={`text-sm mt-1 ${versionLabel.trim().length > MAX_VERSION_LABEL_LENGTH ? 'text-red-600' : 'text-gray-500'}`}>
                {versionLabel.trim().length} / {MAX_VERSION_LABEL_LENGTH}
              </p>
            </div>
          )}

          {file && !uploading && (
            <button
              type="button"
              className="block mx-auto text-red-600 text-sm hover:underline"
              onClick={() => {
                setFile(null);
                if (inputRef.current) inputRef.current.value = '';
              }}
            >
              Remove selected file
            </button>
          )}

          <button
            type="submit"
            disabled={!file || uploading}
            aria-busy={uploading}
            className="w-full bg-blue-600 text-white p-4 rounded-xl font-bold text-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition shadow-sm"
          >
            {uploading ? 'Uploading...' : base ? 'Upload New Version' : 'Upload Resume'}
          </button>
        </form>

        <div className="mt-6 text-center">
          <Link
            href={base ? `/dashboard/resumes/${base.id}/versions` : '/dashboard/resumes'}
            className="text-gray-500 hover:text-gray-800 transition"
          >
            {base ? 'Cancel and return to Version History' : 'Cancel and return to My Resumes'}
          </Link>
        </div>
      </div>
    </div>
  );
}

// useSearchParams (for ?versionOf) must sit inside a Suspense boundary.
export default function UploadResume() {
  return (
    <Suspense fallback={<div className="p-8 text-center text-gray-600">Loading...</div>}>
      <UploadResumeContent />
    </Suspense>
  );
}
