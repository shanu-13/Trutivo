"use client";

import { useEffect, useState, type ReactNode } from 'react';
import {
  extractJobRequirements,
  getJobRequirements,
  type EducationRequirement,
  type ExperienceRequirement,
  type JobRequirements as Requirements,
} from '@/lib/api/jobDescription.api';
import { formatDateTime } from '@/lib/format';

type Status = 'loading' | 'idle' | 'extracting' | 'completed' | 'failed';

const errorMessage = (err: unknown, fallback: string) =>
  err instanceof Error && err.message ? err.message : fallback;

const yearsLabel = ({ minimumYears: min, maximumYears: max }: ExperienceRequirement) => {
  if (min !== null && max !== null) return `${min}–${max} years`;
  if (min !== null) return `${min}+ years`;
  if (max !== null) return `Up to ${max} years`;
  return 'Experience';
};

const educationLabel = ({ degree, fields }: EducationRequirement) =>
  [degree ?? 'Degree', fields.length > 0 ? `in ${fields.join(', ')}` : null].filter(Boolean).join(' ');

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div>
      <h3 className="text-xs font-semibold uppercase tracking-wide text-gray-500 mb-2">{title}</h3>
      <div className="text-sm text-gray-800">{children}</div>
    </div>
  );
}

function SkillList({ skills, tone }: { skills: string[]; tone: 'required' | 'preferred' | 'mentioned' }) {
  const styles = {
    required: 'bg-blue-50 text-blue-800 border-blue-100',
    preferred: 'bg-green-50 text-green-800 border-green-100',
    mentioned: 'bg-gray-50 text-gray-700 border-gray-200',
  }[tone];
  return (
    <div className="flex flex-wrap gap-1.5">
      {skills.map((skill) => (
        <span key={skill} className={`text-xs border px-2 py-0.5 rounded ${styles}`}>
          {skill}
        </span>
      ))}
    </div>
  );
}

const OptionalTag = () => <span className="ml-2 text-xs text-green-700">(preferred)</span>;

function RequirementsView({ requirements }: { requirements: Requirements }) {
  const details = [requirements.location, requirements.employmentType, requirements.workMode].filter(Boolean);
  const isEmpty =
    requirements.requiredSkills.length +
      requirements.preferredSkills.length +
      requirements.mentionedSkills.length +
      requirements.experienceRequirements.length +
      requirements.educationRequirements.length +
      requirements.responsibilities.length ===
    0;

  return (
    <div className="space-y-5">
      {details.length > 0 && <p className="text-sm text-gray-600">{details.join(' · ')}</p>}
      {isEmpty && <p className="text-sm text-gray-500">No explicit requirements were found in this job description.</p>}

      {requirements.requiredSkills.length > 0 && (
        <Section title="Required Skills">
          <SkillList skills={requirements.requiredSkills} tone="required" />
        </Section>
      )}
      {requirements.preferredSkills.length > 0 && (
        <Section title="Preferred Skills">
          <SkillList skills={requirements.preferredSkills} tone="preferred" />
        </Section>
      )}
      {requirements.mentionedSkills.length > 0 && (
        <Section title="Also Mentioned">
          <SkillList skills={requirements.mentionedSkills} tone="mentioned" />
        </Section>
      )}

      {requirements.experienceRequirements.length > 0 && (
        <Section title="Experience">
          <ul className="space-y-1">
            {requirements.experienceRequirements.map((item, i) => (
              <li key={i}>
                <span className="font-medium">{yearsLabel(item)}</span>
                {item.areas.length > 0 && <span className="text-gray-600"> · {item.areas.join(', ')}</span>}
                {item.preferred && <OptionalTag />}
              </li>
            ))}
          </ul>
        </Section>
      )}

      {requirements.educationRequirements.length > 0 && (
        <Section title="Education">
          <ul className="space-y-1">
            {requirements.educationRequirements.map((item, i) => (
              <li key={i}>
                {educationLabel(item)}
                {item.preferred && <OptionalTag />}
              </li>
            ))}
          </ul>
        </Section>
      )}

      {requirements.responsibilities.length > 0 && (
        <Section title="Responsibilities">
          <ul className="list-disc pl-5 space-y-0.5">
            {requirements.responsibilities.map((item, i) => (
              <li key={i} className="break-words">{item}</li>
            ))}
          </ul>
        </Section>
      )}
    </div>
  );
}

export default function JobRequirements({ jobDescriptionId }: { jobDescriptionId: string }) {
  const [status, setStatus] = useState<Status>('loading');
  const [requirements, setRequirements] = useState<Requirements | null>(null);
  const [extractedAt, setExtractedAt] = useState<string | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    getJobRequirements(jobDescriptionId)
      .then((data) => {
        if (cancelled) return;
        setRequirements(data.data.requirements);
        setExtractedAt(data.data.extractedAt);
        setStatus(data.data.requirements ? 'completed' : 'idle');
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setError(errorMessage(err, 'Failed to load job requirements'));
        setStatus('failed');
      });
    return () => {
      cancelled = true;
    };
  }, [jobDescriptionId]);

  const runExtraction = async () => {
    setStatus('extracting');
    setError('');
    try {
      const data = await extractJobRequirements(jobDescriptionId);
      setRequirements(data.data.requirements);
      setExtractedAt(data.data.extractedAt);
      setStatus('completed');
    } catch (err: unknown) {
      setError(errorMessage(err, 'Requirement extraction failed'));
      setStatus('failed');
    }
  };

  return (
    <div className="bg-white p-6 md:p-8 rounded-xl shadow-sm border border-gray-100 mt-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-4">
        <div>
          <h2 className="text-xl font-bold text-gray-900">Job Requirements</h2>
          {status === 'completed' && extractedAt && (
            <p className="text-xs text-gray-500">Extracted {formatDateTime(extractedAt)}</p>
          )}
        </div>
        {(status === 'idle' || status === 'completed') && (
          <button
            onClick={runExtraction}
            className={
              status === 'idle'
                ? 'px-4 py-2 rounded-lg bg-blue-600 text-white hover:bg-blue-700 transition text-sm font-medium'
                : 'px-4 py-2 rounded-lg border border-gray-300 text-gray-800 hover:bg-gray-50 transition text-sm font-medium'
            }
          >
            {status === 'idle' ? 'Extract Requirements' : 'Re-extract Requirements'}
          </button>
        )}
      </div>

      {status === 'loading' && <p className="text-sm text-gray-500">Loading requirements...</p>}
      {status === 'idle' && (
        <p className="text-sm text-gray-500">Requirements have not been extracted from this job description yet.</p>
      )}
      {status === 'extracting' && <p className="text-sm text-blue-600 font-medium">Extracting requirements...</p>}
      {status === 'failed' && (
        <div className="space-y-2">
          <p className="text-red-600 font-medium text-sm whitespace-pre-line">{error}</p>
          <button onClick={runExtraction} className="text-sm bg-gray-200 hover:bg-gray-300 px-3 py-1 rounded transition">
            Retry Requirement Extraction
          </button>
        </div>
      )}
      {status === 'completed' && requirements && <RequirementsView requirements={requirements} />}
    </div>
  );
}
