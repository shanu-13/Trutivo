"use client";

import type { ReactNode } from 'react';

// Shape of `data.analysis` from POST /api/resumes/:resumeId/match/:jobDescriptionId (Step 7A).

interface Observation<C extends string> {
  category: C;
  message: string;
}

interface SkillCoverage {
  status: 'calculated' | 'not_applicable';
  matched: string[];
  missing: string[];
  coverage: number | null;
  coverageLevel: 'complete' | 'strong' | 'partial' | 'limited' | 'none' | null;
}

export interface MatchAnalysis {
  overall: {
    matchScore: number | null;
    scoreAvailable: boolean;
    summary: string;
    highlights: Observation<'required_skills' | 'preferred_skills' | 'experience' | 'education' | 'semantic_similarity'>[];
  };
  skills: { required: SkillCoverage; preferred: SkillCoverage };
  experience: {
    status: 'satisfied' | 'below_requirement' | 'not_applicable' | 'insufficient_data';
    requiredYears: number | null;
    candidateYears: number | null;
    reason: string | null;
  };
  education: {
    status: 'satisfied' | 'not_satisfied' | 'not_applicable' | 'insufficient_data';
    requiredDegree: string | null;
    candidateDegree: string | null;
    reason: string | null;
  };
  semanticSimilarity: {
    status: 'calculated' | 'unavailable';
    signalComparison: { observation: string | null } | null;
  };
  dataQuality: {
    status: 'complete' | 'mostly_complete' | 'partial' | 'insufficient';
    issues: string[];
    notApplicable: string[];
  };
  strengths: Observation<string>[];
  gaps: Observation<'required_skill' | 'preferred_skill' | 'experience' | 'education' | 'insufficient_data'>[];
  additionalGapCount: number;
}

const HIGHLIGHT_LABELS: Record<MatchAnalysis['overall']['highlights'][number]['category'], string> = {
  required_skills: 'Required Skills',
  preferred_skills: 'Preferred Skills',
  experience: 'Experience',
  education: 'Education',
  semantic_similarity: 'Semantic Similarity',
};

const COVERAGE_WORDS: Record<NonNullable<SkillCoverage['coverageLevel']>, string> = {
  complete: 'complete',
  strong: 'strong',
  partial: 'partial',
  limited: 'limited',
  none: 'none',
};

const REQUIREMENT_STATUS: Record<string, { text: string; className: string }> = {
  satisfied: { text: 'Satisfied', className: 'text-green-700' },
  below_requirement: { text: 'Below requirement', className: 'text-red-600' },
  not_satisfied: { text: 'Not satisfied', className: 'text-red-600' },
  not_applicable: { text: 'Not applicable', className: 'text-gray-500' },
  insufficient_data: { text: 'Not enough data', className: 'text-gray-500' },
};

const DATA_QUALITY_LABELS: Record<MatchAnalysis['dataQuality']['status'], string> = {
  complete: 'Complete',
  mostly_complete: 'Mostly complete',
  partial: 'Partial',
  insufficient: 'Insufficient',
};

function Card({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="border border-gray-200 rounded-lg p-3 bg-white space-y-2 min-w-0">
      <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">{title}</p>
      <div className="text-sm text-gray-800 space-y-1.5">{children}</div>
    </div>
  );
}

function coverageText(skills: SkillCoverage) {
  if (skills.status === 'not_applicable' || skills.coverage === null) return 'Not applicable';
  return `${skills.coverage}%${skills.coverageLevel ? ` (${COVERAGE_WORDS[skills.coverageLevel]} coverage)` : ''}`;
}

function StatusText({ status }: { status: string }) {
  const label = REQUIREMENT_STATUS[status] ?? { text: status, className: 'text-gray-500' };
  return <span className={`font-medium ${label.className}`}>{label.text}</span>;
}

export function OverallAnalysisCard({ analysis }: { analysis: MatchAnalysis }) {
  return (
    <Card title="Overall Analysis">
      <p>{analysis.overall.summary}</p>
      {analysis.overall.highlights.length > 0 && (
        <dl className="space-y-1">
          {analysis.overall.highlights.map((item) => (
            <div key={item.category}>
              <dt className="text-xs font-medium text-gray-500">{HIGHLIGHT_LABELS[item.category]}</dt>
              <dd>{item.message}</dd>
            </div>
          ))}
        </dl>
      )}
    </Card>
  );
}

export function DeterministicAnalysisCard({ analysis }: { analysis: MatchAnalysis }) {
  return (
    <Card title="Deterministic Analysis">
      <p>Required Skills: <span className="font-medium">{coverageText(analysis.skills.required)}</span></p>
      <p>Preferred Skills: <span className="font-medium">{coverageText(analysis.skills.preferred)}</span></p>
      <p>Experience: <StatusText status={analysis.experience.status} /></p>
      <p>Education: <StatusText status={analysis.education.status} /></p>
    </Card>
  );
}

export function StrengthsAndGaps({ analysis }: { analysis: MatchAnalysis }) {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
      <Card title="Strengths">
        {analysis.strengths.length === 0 ? (
          <p className="text-gray-500">No strengths could be identified from the available evidence.</p>
        ) : (
          <ul className="space-y-1">
            {analysis.strengths.map((item, i) => (
              <li key={i} className="flex gap-2">
                <span className="text-green-700" aria-hidden="true">✓</span>
                <span>{item.message}</span>
              </li>
            ))}
          </ul>
        )}
      </Card>
      <Card title="Gaps">
        {analysis.gaps.length === 0 ? (
          <p className="text-gray-500">No gaps were identified.</p>
        ) : (
          <ul className="space-y-1">
            {analysis.gaps.map((item, i) => (
              <li key={i} className="flex gap-2">
                <span className={item.category === 'insufficient_data' ? 'text-gray-500' : 'text-red-600'} aria-hidden="true">•</span>
                <span className={item.category === 'insufficient_data' ? 'text-gray-600' : undefined}>{item.message}</span>
              </li>
            ))}
          </ul>
        )}
        {analysis.additionalGapCount > 0 && (
          <p className="text-xs text-gray-500">
            {analysis.additionalGapCount} more {analysis.additionalGapCount === 1 ? 'item is' : 'items are'} listed in the detailed comparison below.
          </p>
        )}
      </Card>
    </div>
  );
}

export function DataQualityCard({ analysis }: { analysis: MatchAnalysis }) {
  const { dataQuality, semanticSimilarity } = analysis;
  const signal = semanticSimilarity.signalComparison?.observation;
  return (
    <Card title="Data Quality">
      <p>
        Available information: <span className="font-medium">{DATA_QUALITY_LABELS[dataQuality.status]}</span>
      </p>
      {dataQuality.issues.map((issue) => (
        <p key={issue} className="text-gray-600">• {issue}</p>
      ))}
      {dataQuality.notApplicable.length > 0 && (
        <p className="text-xs text-gray-500">Not specified by the job (not counted as missing): {dataQuality.notApplicable.join(' ')}</p>
      )}
      {signal && <p className="text-xs text-gray-600">{signal}</p>}
      <p className="text-xs text-gray-500">
        This analysis describes requirement coverage and similarity based on the information found. It does not predict hiring outcomes.
      </p>
    </Card>
  );
}
