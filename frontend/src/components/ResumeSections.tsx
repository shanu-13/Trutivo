"use client";

import { useState } from 'react';
import { extractResumeSections } from '@/lib/api/resume.api';

type Sections = Record<string, string | undefined> & {
  other_sections?: Record<string, string>;
};

type Status = 'idle' | 'processing' | 'completed' | 'failed';

// Canonical sections in display order.
const SECTION_LABELS: [string, string][] = [
  ['personal_information', 'Personal Information'],
  ['summary', 'Summary'],
  ['experience', 'Experience'],
  ['education', 'Education'],
  ['projects', 'Projects'],
  ['skills', 'Skills'],
  ['certifications', 'Certifications'],
  ['achievements', 'Achievements'],
  ['languages', 'Languages'],
  ['interests', 'Interests'],
  ['references', 'References'],
];

const titleCase = (heading: string) => heading.replace(/\b\w/g, (c) => c.toUpperCase());

const errorMessage = (err: unknown, fallback: string) =>
  err instanceof Error && err.message ? err.message : fallback;

export default function ResumeSections({ resumeId }: { resumeId: string }) {
  const [status, setStatus] = useState<Status>('idle');
  const [sections, setSections] = useState<Sections | null>(null);
  const [error, setError] = useState<string | null>(null);

  const runExtraction = async () => {
    setStatus('processing');
    setError(null);
    try {
      const data = await extractResumeSections(resumeId);
      setSections(data.data.sections);
      setStatus('completed');
    } catch (err: unknown) {
      setError(errorMessage(err, 'Section extraction failed'));
      setStatus('failed');
    }
  };

  if (status === 'idle') {
    return (
      <button onClick={runExtraction} className="text-sm bg-blue-600 text-white hover:bg-blue-700 px-3 py-1 rounded transition">
        Extract Sections
      </button>
    );
  }

  if (status === 'processing') {
    return <p className="text-sm text-blue-600 font-medium">Extracting resume sections...</p>;
  }

  if (status === 'failed') {
    return (
      <div className="space-y-2">
        <p className="text-red-600 font-medium text-sm">{error}</p>
        <button onClick={runExtraction} className="text-sm bg-gray-200 hover:bg-gray-300 px-3 py-1 rounded transition">
          Retry Section Extraction
        </button>
      </div>
    );
  }

  const entries: [string, string][] = [
    ...SECTION_LABELS.flatMap(([key, label]): [string, string][] => {
      const content = sections?.[key];
      return typeof content === 'string' ? [[label, content]] : [];
    }),
    ...Object.entries(sections?.other_sections ?? {}).map(([heading, content]): [string, string] => [titleCase(heading), content]),
  ];

  if (entries.length === 0) {
    return <p className="text-sm text-gray-500">No recognisable section headings were found in this resume.</p>;
  }

  return (
    <div className="space-y-3">
      {entries.map(([label, content]) => (
        <div key={label}>
          <p className="text-xs font-semibold uppercase tracking-wide text-gray-500 mb-1">{label}</p>
          <p className="text-sm text-gray-800 whitespace-pre-wrap break-words max-h-48 overflow-y-auto">{content}</p>
        </div>
      ))}
    </div>
  );
}
