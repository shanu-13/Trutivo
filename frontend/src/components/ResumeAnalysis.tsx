"use client";

import { useState, type ReactNode } from 'react';
import { analyzeResume } from '@/lib/api/resume.api';
import { skillCategoryLabel } from '@/lib/skillCategories';

type Text = string | null;

interface PersonalInformation {
  name: Text;
  email: Text;
  phone: Text;
  location: Text;
  linkedin: Text;
  github: Text;
  portfolio: Text;
}

interface ExperienceEntry {
  title: Text;
  company: Text;
  location: Text;
  startDate: Text;
  endDate: Text;
  isCurrent: boolean;
  description: string[];
  rawText: string;
}

interface EducationEntry {
  degree: Text;
  field: Text;
  institution: Text;
  startDate: Text;
  endDate: Text;
  isCurrent: boolean;
  grade: Text;
  rawText: string;
}

interface ProjectEntry {
  name: Text;
  description: string[];
  technologies: string[];
  url: Text;
  rawText: string;
}

interface CertificationEntry {
  name: string;
  issuer: Text;
  date: Text;
}

interface StructuredResume {
  personalInformation: PersonalInformation;
  summary: Text;
  experience: ExperienceEntry[];
  education: EducationEntry[];
  projects: ProjectEntry[];
  skills: Record<string, string[]>;
  certifications: CertificationEntry[];
  achievements: string[];
  languages: string[];
  interests: string[];
  otherSections: Record<string, string>;
}

interface ResumeMetadata {
  totalSkills: number;
  totalExperienceEntries: number;
  totalEducationEntries: number;
  totalProjects: number;
  totalCertifications: number;
}

interface Analysis {
  resume: StructuredResume;
  metadata: ResumeMetadata;
}

type Status = 'idle' | 'processing' | 'completed' | 'failed';

const errorMessage = (err: unknown, fallback: string) =>
  err instanceof Error && err.message ? err.message : fallback;

const dateRange = (start: Text, end: Text, isCurrent: boolean) => {
  const finish = isCurrent ? 'Present' : end;
  if (start && finish) return `${start} – ${finish}`;
  return start ?? finish ?? null;
};

const joinPresent = (values: Text[], separator: string) => values.filter(Boolean).join(separator);

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div>
      <p className="text-xs font-semibold uppercase tracking-wide text-gray-500 mb-1">{title}</p>
      <div className="text-sm text-gray-800 space-y-2">{children}</div>
    </div>
  );
}

// Shown when an entry's fields could not be identified reliably.
function RawText({ text }: { text: string }) {
  return <p className="whitespace-pre-wrap break-words text-gray-700">{text}</p>;
}

function Bullets({ items }: { items: string[] }) {
  if (items.length === 0) return null;
  return (
    <ul className="list-disc pl-5 space-y-0.5">
      {items.map((item, i) => (
        <li key={i} className="break-words">{item}</li>
      ))}
    </ul>
  );
}

function AnalysisView({ resume, metadata }: Analysis) {
  const info = resume.personalInformation;
  const contact = [info.email, info.phone, info.location, info.linkedin, info.github, info.portfolio].filter(Boolean);
  const skillCategories = Object.entries(resume.skills);
  const other = Object.entries(resume.otherSections);

  return (
    <div className="space-y-4">
      <p className="text-xs text-gray-500">
        {metadata.totalSkills} skills · {metadata.totalExperienceEntries} experience · {metadata.totalEducationEntries} education ·{' '}
        {metadata.totalProjects} projects · {metadata.totalCertifications} certifications
      </p>

      {(info.name || contact.length > 0) && (
        <Section title="Personal Information">
          {info.name && <p className="font-medium">{info.name}</p>}
          {contact.map((value) => (
            <p key={value} className="break-all">{value}</p>
          ))}
        </Section>
      )}

      {resume.summary && (
        <Section title="Summary">
          <p className="whitespace-pre-wrap break-words">{resume.summary}</p>
        </Section>
      )}

      {skillCategories.length > 0 && (
        <Section title="Skills">
          {skillCategories.map(([category, names]) => (
            <p key={category}>
              <span className="text-gray-500">{skillCategoryLabel(category)}:</span> {names.join(', ')}
            </p>
          ))}
        </Section>
      )}

      {resume.experience.length > 0 && (
        <Section title="Experience">
          {resume.experience.map((job, i) => {
            const dates = dateRange(job.startDate, job.endDate, job.isCurrent);
            if (!job.title && !job.company) return <RawText key={i} text={job.rawText} />;
            return (
              <div key={i}>
                {job.title && <p className="font-medium">{job.title}</p>}
                {(job.company || job.location) && <p>{joinPresent([job.company, job.location], ' · ')}</p>}
                {dates && <p className="text-gray-500">{dates}</p>}
                <Bullets items={job.description} />
              </div>
            );
          })}
        </Section>
      )}

      {resume.education.length > 0 && (
        <Section title="Education">
          {resume.education.map((entry, i) => {
            const dates = dateRange(entry.startDate, entry.endDate, entry.isCurrent);
            if (!entry.degree && !entry.institution) return <RawText key={i} text={entry.rawText} />;
            return (
              <div key={i}>
                {entry.degree && <p className="font-medium">{joinPresent([entry.degree, entry.field], ' ')}</p>}
                {entry.institution && <p>{entry.institution}</p>}
                {(dates || entry.grade) && <p className="text-gray-500">{joinPresent([dates, entry.grade], ' · ')}</p>}
              </div>
            );
          })}
        </Section>
      )}

      {resume.projects.length > 0 && (
        <Section title="Projects">
          {resume.projects.map((project, i) => {
            if (!project.name) return <RawText key={i} text={project.rawText} />;
            return (
              <div key={i}>
                <p className="font-medium">{project.name}</p>
                {project.technologies.length > 0 && <p className="text-gray-500">{project.technologies.join(', ')}</p>}
                <Bullets items={project.description} />
                {project.url && <p className="break-all text-gray-500">{project.url}</p>}
              </div>
            );
          })}
        </Section>
      )}

      {resume.certifications.length > 0 && (
        <Section title="Certifications">
          {resume.certifications.map((cert, i) => (
            <p key={i}>
              {cert.name}
              {(cert.issuer || cert.date) && (
                <span className="text-gray-500"> — {joinPresent([cert.issuer, cert.date], ', ')}</span>
              )}
            </p>
          ))}
        </Section>
      )}

      {resume.achievements.length > 0 && (
        <Section title="Achievements">
          <Bullets items={resume.achievements} />
        </Section>
      )}

      {resume.languages.length > 0 && (
        <Section title="Languages">
          <p>{resume.languages.join(', ')}</p>
        </Section>
      )}

      {resume.interests.length > 0 && (
        <Section title="Interests">
          <p>{resume.interests.join(', ')}</p>
        </Section>
      )}

      {other.map(([heading, content]) => (
        <Section key={heading} title={heading.replace(/\b\w/g, (c) => c.toUpperCase())}>
          <p className="whitespace-pre-wrap break-words">{content}</p>
        </Section>
      ))}
    </div>
  );
}

export default function ResumeAnalysis({ resumeId }: { resumeId: string }) {
  const [status, setStatus] = useState<Status>('idle');
  const [analysis, setAnalysis] = useState<Analysis | null>(null);
  const [error, setError] = useState<string | null>(null);

  const runAnalysis = async () => {
    setStatus('processing');
    setError(null);
    try {
      const data = await analyzeResume(resumeId);
      setAnalysis({ resume: data.data.resume, metadata: data.data.metadata });
      setStatus('completed');
    } catch (err: unknown) {
      setError(errorMessage(err, 'Resume analysis failed'));
      setStatus('failed');
    }
  };

  if (status === 'idle') {
    return (
      <button onClick={runAnalysis} className="text-sm bg-blue-600 text-white hover:bg-blue-700 px-3 py-1 rounded transition">
        Analyze Resume
      </button>
    );
  }

  if (status === 'processing') {
    return <p className="text-sm text-blue-600 font-medium">Analyzing resume...</p>;
  }

  if (status === 'failed' || !analysis) {
    return (
      <div className="space-y-2">
        <p className="text-red-600 font-medium text-sm">{error}</p>
        <button onClick={runAnalysis} className="text-sm bg-gray-200 hover:bg-gray-300 px-3 py-1 rounded transition">
          Retry Analysis
        </button>
      </div>
    );
  }

  return <AnalysisView resume={analysis.resume} metadata={analysis.metadata} />;
}
