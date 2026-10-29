"use client";

import { useEffect, useState } from 'react';
import { extractResumeSkills, getResumeSkills } from '@/lib/api/resume.api';
import { skillCategoryLabel } from '@/lib/skillCategories';

type SkillsByCategory = Record<string, string[]>;

interface SkillsResult {
  skills: SkillsByCategory;
  totalSkills: number;
}

type Status = 'idle' | 'loading' | 'extracting' | 'done' | 'error';

const errorMessage = (err: unknown, fallback: string) =>
  err instanceof Error && err.message ? err.message : fallback;

interface Props {
  resumeId: string;
  // Set once skills have been extracted at least once, even if none were found.
  skillsExtractedAt: string | null;
}

export default function ResumeSkills({ resumeId, skillsExtractedAt }: Props) {
  const [status, setStatus] = useState<Status>(skillsExtractedAt ? 'loading' : 'idle');
  const [result, setResult] = useState<SkillsResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const hasExtracted = Boolean(skillsExtractedAt);

  useEffect(() => {
    if (!hasExtracted) return;
    let cancelled = false;
    getResumeSkills(resumeId)
      .then((data) => {
        if (cancelled) return;
        setResult({ skills: data.data.skills, totalSkills: data.data.totalSkills });
        setStatus('done');
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setError(errorMessage(err, 'Failed to load skills'));
        setStatus('error');
      });
    return () => {
      cancelled = true;
    };
  }, [resumeId, hasExtracted]);

  const runExtraction = async () => {
    setStatus('extracting');
    setError(null);
    try {
      const data = await extractResumeSkills(resumeId);
      setResult({ skills: data.data.skills, totalSkills: data.data.totalSkills });
      setStatus('done');
    } catch (err: unknown) {
      setError(errorMessage(err, 'Skill extraction failed'));
      setStatus('error');
    }
  };

  if (status === 'idle') {
    return (
      <button onClick={runExtraction} className="text-sm bg-blue-600 text-white hover:bg-blue-700 px-3 py-1 rounded transition">
        Extract Skills
      </button>
    );
  }

  if (status === 'loading') {
    return <p className="text-sm text-gray-500">Loading skills...</p>;
  }

  if (status === 'extracting') {
    return <p className="text-sm text-blue-600 font-medium">Extracting skills...</p>;
  }

  if (status === 'error') {
    return (
      <div className="space-y-2">
        <p className="text-red-600 font-medium text-sm">{error}</p>
        <button onClick={runExtraction} className="text-sm bg-gray-200 hover:bg-gray-300 px-3 py-1 rounded transition">
          Retry Skill Extraction
        </button>
      </div>
    );
  }

  const categories = Object.entries(result?.skills ?? {});

  return (
    <div className="space-y-3">
      <p className="text-sm font-medium text-gray-800">Skills detected: {result?.totalSkills ?? 0}</p>
      {categories.length === 0 ? (
        <p className="text-sm text-gray-500">No known skills were found in this resume.</p>
      ) : (
        <div className="space-y-2">
          {categories.map(([category, names]) => (
            <div key={category}>
              <p className="text-xs font-semibold uppercase tracking-wide text-gray-500 mb-1">{skillCategoryLabel(category)}</p>
              <div className="flex flex-wrap gap-1.5">
                {names.map((name) => (
                  <span key={name} className="text-xs bg-blue-50 text-blue-800 border border-blue-100 px-2 py-0.5 rounded">
                    {name}
                  </span>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
