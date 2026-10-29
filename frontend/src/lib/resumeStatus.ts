import type { ExtractionStatus } from '@/lib/api/resume.api';

// Readable labels for the stored extraction status. The status values and their
// meaning are the backend's; this only names them. Each label carries a symbol
// and text, so the status is not conveyed by colour alone.
interface StatusInfo {
  label: string;
  description: string;
  symbol: string;
  tone: string;
}

const STATUS: Record<ExtractionStatus, StatusInfo> = {
  pending: {
    label: 'Uploaded',
    description: 'Waiting for text extraction to start.',
    symbol: '○',
    tone: 'bg-gray-50 text-gray-700 border-gray-200',
  },
  processing: {
    label: 'Processing',
    description: 'Extracting text from the PDF...',
    symbol: '◐',
    tone: 'bg-blue-50 text-blue-800 border-blue-200',
  },
  completed: {
    label: 'Completed',
    description: 'Text extracted. The resume is ready to analyze and match.',
    symbol: '✓',
    tone: 'bg-green-50 text-green-800 border-green-200',
  },
  no_text: {
    label: 'No readable text',
    description: 'No readable text was found in this PDF. OCR is not currently supported.',
    symbol: '!',
    tone: 'bg-amber-50 text-amber-800 border-amber-200',
  },
  failed: {
    label: 'Failed',
    description: 'Unable to extract text from this resume.',
    symbol: '✕',
    tone: 'bg-red-50 text-red-700 border-red-200',
  },
};

const UNKNOWN: StatusInfo = {
  label: 'Unknown',
  description: 'The processing status is not available.',
  symbol: '?',
  tone: 'bg-gray-50 text-gray-700 border-gray-200',
};

export const resumeStatusInfo = (status: string): StatusInfo => STATUS[status as ExtractionStatus] ?? UNKNOWN;

export const isExtractionInProgress = (status: string) => status === 'pending' || status === 'processing';

// Extraction can be retried with the existing endpoint after these outcomes.
export const canRetryExtraction = (status: string) => status === 'failed' || status === 'no_text';

// "Version 2" or "Version 2 · Backend focus".
export const versionName = (version: { versionNumber: number; versionLabel: string | null }) =>
  `Version ${version.versionNumber}${version.versionLabel ? ` · ${version.versionLabel}` : ''}`;

export const CURRENT_BADGE = { label: 'Current', symbol: '★', tone: 'bg-blue-50 text-blue-800 border-blue-200' };

export const TAILORED_BADGE = { label: 'Tailored copy', symbol: '✎', tone: 'bg-purple-50 text-purple-800 border-purple-200' };

export const fileTypeLabel = (mimeType: string) =>
  mimeType === 'application/pdf' ? 'PDF' : mimeType === 'text/plain' ? 'Text' : mimeType;

export const EXPORTED_BADGE = { label: 'Exported PDF', symbol: '⎙', tone: 'bg-slate-50 text-slate-700 border-slate-300' };

// The badge for a version that was not uploaded, if any.
export const sourceBadge = (sourceType: string) =>
  sourceType === 'tailored' ? TAILORED_BADGE : sourceType === 'exported' ? EXPORTED_BADGE : null;
