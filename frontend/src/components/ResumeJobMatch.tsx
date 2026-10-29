"use client";

import { useRef, useState, type ReactNode } from 'react';
import Link from 'next/link';
import { ApiError } from '@/lib/api/client';
import type { JobDescriptionSummary } from '@/lib/api/jobDescription.api';
import { matchResumeToJob } from '@/lib/api/resume.api';
import { skillCategoryLabel } from '@/lib/skillCategories';
import {
  DataQualityCard,
  DeterministicAnalysisCard,
  OverallAnalysisCard,
  StrengthsAndGaps,
  type MatchAnalysis,
} from '@/components/MatchAnalysisView';
import RecommendationsView, { type ResumeRecommendations } from '@/components/RecommendationsView';

type Outcome = boolean | null;

interface SkillComparison {
  matched: string[];
  missing: string[];
  coverage: number | null;
  byCategory: Record<string, { matched: string[]; missing: string[] }>;
}

interface AreaComparison {
  area: string;
  requiredYears: number | null;
  candidateYears: number | null;
  meetsRequirement: Outcome;
}

interface ExperienceRequirementComparison {
  minimumYears: number | null;
  maximumYears: number | null;
  preferred: boolean;
  text: string;
  candidateYears: number | null;
  meetsRequirement: Outcome;
  areas: AreaComparison[];
}

interface EducationComparison {
  requirement: string | null;
  requiredFields: string[];
  preferred: boolean;
  candidateEducation: string | null;
  meetsRequirement: Outcome;
  fieldMatch: Outcome;
}

type ComponentName = 'requiredSkills' | 'preferredSkills' | 'experience' | 'education';

interface ScoreComponent {
  score: number | null;
  weight: number;
  effectiveWeight: number | null;
  contribution: number | null;
  status: 'calculated' | 'not_applicable' | 'insufficient_data';
  reason: string | null;
}

interface Matching {
  overallScore: number | null;
  scoreStatus: 'calculated' | 'insufficient_data';
  components: Record<ComponentName, ScoreComponent>;
  scoreMetadata: { scoringMethod: string; version: string; weights: Record<ComponentName, number> };
  skills: { required: SkillComparison; preferred: SkillComparison };
  experience: {
    status: 'compared' | 'not_applicable';
    requiredYears: number | null;
    candidateYears: number | null;
    candidateYearsReason: string | null;
    meetsRequirement: Outcome;
    requirements: ExperienceRequirementComparison[];
  };
  education: { status: 'compared' | 'not_applicable'; requirements: EducationComparison[] };
}

interface SemanticComponent {
  similarity: number | null;
  status: 'calculated' | 'not_available';
  reason: string | null;
  truncated: boolean;
}

interface SemanticMatch {
  overallSemanticSimilarity: SemanticComponent;
  experienceSemanticSimilarity: SemanticComponent;
  projectSemanticSimilarity: SemanticComponent;
  skillsSemanticSimilarity: SemanticComponent;
  metadata: { model: string; method: 'cosine_similarity' };
}

interface SemanticError {
  code: string;
  message: string;
}

type Status = 'idle' | 'processing' | 'completed' | 'failed';

const years = (value: number | null) => (value === null ? 'Unknown' : `${value} ${value === 1 ? 'year' : 'years'}`);

// Factual outcome labels; the candidate is never given a rating such as "strong" or "weak".
function OutcomeLabel({ value }: { value: Outcome }) {
  if (value === true) return <span className="text-green-700 font-medium">Met</span>;
  if (value === false) return <span className="text-red-600 font-medium">Not met</span>;
  return <span className="text-gray-500 font-medium">Unknown</span>;
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div>
      <p className="text-xs font-semibold uppercase tracking-wide text-gray-500 mb-1">{title}</p>
      <div className="text-sm text-gray-800 space-y-1.5">{children}</div>
    </div>
  );
}

function SkillsBlock({ title, comparison }: { title: string; comparison: SkillComparison }) {
  if (comparison.matched.length + comparison.missing.length === 0) {
    return (
      <Section title={title}>
        <p className="text-gray-500">The job lists none.</p>
      </Section>
    );
  }
  return (
    <Section title={title}>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        <div>
          <p className="text-gray-500">Matched</p>
          {comparison.matched.length === 0 && <p className="text-gray-500">None</p>}
          {comparison.matched.map((skill) => (
            <p key={skill} className="text-green-700">✓ {skill}</p>
          ))}
        </div>
        <div>
          <p className="text-gray-500">Missing</p>
          {comparison.missing.length === 0 && <p className="text-gray-500">None</p>}
          {comparison.missing.map((skill) => (
            <p key={skill} className="text-red-600">• {skill}</p>
          ))}
        </div>
      </div>
      <p>
        Coverage: <span className="font-medium">{comparison.coverage === null ? 'Not applicable' : `${comparison.coverage}%`}</span>
      </p>
      <details className="text-xs text-gray-600">
        <summary className="cursor-pointer">By category</summary>
        {Object.entries(comparison.byCategory).map(([category, group]) => (
          <p key={category} className="mt-1">
            <span className="font-medium">{skillCategoryLabel(category)}:</span>{' '}
            {[...group.matched.map((s) => `✓ ${s}`), ...group.missing.map((s) => `• ${s}`)].join(', ')}
          </p>
        ))}
      </details>
    </Section>
  );
}

const COMPONENT_LABELS: [ComponentName, string][] = [
  ['requiredSkills', 'Required Skills'],
  ['preferredSkills', 'Preferred Skills'],
  ['experience', 'Experience'],
  ['education', 'Education'],
];

const STATUS_LABELS: Record<ScoreComponent['status'], string> = {
  calculated: '',
  not_applicable: 'Not applicable',
  insufficient_data: 'Not enough data',
};

function ScoreBar({ value, label }: { value: number; label: string }) {
  return (
    <div
      className="h-2 w-full bg-gray-200 rounded"
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={value}
    >
      <div className="h-2 bg-blue-600 rounded" style={{ width: `${Math.min(Math.max(value, 0), 100)}%` }} />
    </div>
  );
}

function ScoreView({ matching }: { matching: Matching }) {
  const counted = COMPONENT_LABELS.filter(([name]) => matching.components[name].status === 'calculated');
  const normalised = counted.some(([name]) => matching.components[name].effectiveWeight !== matching.components[name].weight);
  return (
    <div className="border border-gray-200 rounded-lg p-3 bg-white space-y-3">
      <div className="text-center">
        <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">Deterministic Match Score</p>
        <p className="text-3xl font-bold text-gray-900">
          {matching.overallScore === null ? 'Not available' : `${matching.overallScore}%`}
        </p>
        {matching.scoreStatus === 'insufficient_data' && (
          <p className="text-xs text-gray-500">None of the score components could be calculated for this job.</p>
        )}
      </div>

      <div className="space-y-2">
        {COMPONENT_LABELS.map(([name, label]) => {
          const component = matching.components[name];
          const calculated = component.status === 'calculated' && component.score !== null;
          return (
            <div key={name} className="text-sm">
              <div className="flex justify-between gap-2">
                <span className="font-medium text-gray-800">{label}</span>
                <span className={calculated ? 'text-gray-900' : 'text-gray-500'}>
                  {calculated ? `${component.score}%` : STATUS_LABELS[component.status]}
                </span>
              </div>
              {calculated && <ScoreBar value={component.score as number} label={`${label} score`} />}
              <p className="text-xs text-gray-500">
                Weight {component.weight}%
                {calculated && component.effectiveWeight !== component.weight && ` (${component.effectiveWeight}% after rescaling)`}
                {calculated && ` · adds ${component.contribution} points`}
                {!calculated && component.reason && ` · ${component.reason}`}
              </p>
            </div>
          );
        })}
      </div>

      <p className="text-xs text-gray-500">
        Score calculated using weighted deterministic matching (version {matching.scoreMetadata.version}) from required skills,
        preferred skills, experience and education.
        {normalised && ' Components that do not apply to this job are left out and the remaining weights are rescaled.'} It reflects
        only these criteria, not a prediction of hiring success.
      </p>
    </div>
  );
}

const SEMANTIC_LABELS: [keyof Omit<SemanticMatch, 'metadata'>, string][] = [
  ['overallSemanticSimilarity', 'Overall Semantic Similarity'],
  ['experienceSemanticSimilarity', 'Experience Similarity'],
  ['projectSemanticSimilarity', 'Project Similarity'],
  ['skillsSemanticSimilarity', 'Skills Similarity'],
];

// "sentence-transformers/all-MiniLM-L6-v2" -> "all-MiniLM-L6-v2"
const shortModelName = (model: string) => model.split('/').pop() || model;

function SemanticView({ semantic, error }: { semantic: SemanticMatch | null; error: SemanticError | null }) {
  return (
    <div className="border border-gray-200 rounded-lg p-3 bg-white space-y-3">
      <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">Semantic Analysis</p>
      {!semantic ? (
        <p className="text-sm text-gray-500">{error?.message || 'Semantic analysis is not available.'}</p>
      ) : (
        <>
          <div className="space-y-2">
            {SEMANTIC_LABELS.map(([key, label]) => {
              const component = semantic[key];
              const calculated = component.status === 'calculated' && component.similarity !== null;
              return (
                <div key={key} className="text-sm">
                  <div className="flex justify-between gap-2">
                    <span className="font-medium text-gray-800">{label}</span>
                    <span className={calculated ? 'text-gray-900' : 'text-gray-500'}>
                      {calculated ? `${component.similarity}%` : 'Not available'}
                    </span>
                  </div>
                  {calculated && <ScoreBar value={component.similarity as number} label={label} />}
                  {!calculated && component.reason && <p className="text-xs text-gray-500">{component.reason}</p>}
                  {component.truncated && <p className="text-xs text-gray-500">Very long content: only the first part was compared.</p>}
                </div>
              );
            })}
          </div>
          <p className="text-xs text-gray-500">
            Embedding model: {shortModelName(semantic.metadata.model)} · Similarity: Cosine similarity
          </p>
        </>
      )}
      <p className="text-xs text-gray-500">
        Semantic similarity measures how closely the resume and job-description content are related in meaning based on the
        selected embedding model. It complements exact keyword-based matching and does not change the match score above. It is
        not a measure of hiring likelihood.
      </p>
    </div>
  );
}

// The Step 6A comparison in full, under the analysis summary.
function MatchingView({ matching }: { matching: Matching }) {
  const { experience, education } = matching;
  return (
    <div className="space-y-4">
      <SkillsBlock title="Required Skills" comparison={matching.skills.required} />
      <SkillsBlock title="Preferred Skills" comparison={matching.skills.preferred} />

      <Section title="Experience">
        {experience.status === 'not_applicable' ? (
          <p className="text-gray-500">The job states no years of experience.</p>
        ) : (
          <>
            {experience.requiredYears !== null && (
              <p>
                Required: {years(experience.requiredYears)} · Resume: {years(experience.candidateYears)} · Requirement:{' '}
                <OutcomeLabel value={experience.meetsRequirement} />
              </p>
            )}
            {experience.candidateYears === null && experience.candidateYearsReason && (
              <p className="text-xs text-gray-500">Resume experience not calculated: {experience.candidateYearsReason}.</p>
            )}
            {experience.requirements.flatMap((requirement, i) =>
              requirement.areas.map((area) => (
                <p key={`${i}-${area.area}`}>
                  {area.area}: {years(area.requiredYears)} required · Evidence in dated jobs: {years(area.candidateYears)} ·{' '}
                  <OutcomeLabel value={area.meetsRequirement} />
                  {requirement.preferred && <span className="text-xs text-gray-500"> (preferred)</span>}
                </p>
              ))
            )}
          </>
        )}
      </Section>

      <Section title="Education">
        {education.status === 'not_applicable' ? (
          <p className="text-gray-500">The job states no education requirement.</p>
        ) : (
          education.requirements.map((item, i) => (
            <div key={i}>
              <p className="font-medium">
                {item.requirement ?? 'Degree'}
                {item.requiredFields.length > 0 && ` in ${item.requiredFields.join(', ')}`}
                {item.preferred && <span className="text-xs text-gray-500 font-normal"> (preferred)</span>}
              </p>
              <p>
                Resume: {item.candidateEducation ?? 'No degree found'} · Requirement: <OutcomeLabel value={item.meetsRequirement} />
                {item.fieldMatch !== null && <> · Field: {item.fieldMatch ? 'Matches' : 'Different'}</>}
              </p>
            </div>
          ))
        )}
      </Section>
    </div>
  );
}

// The match result as returned by the matching endpoint and as stored in match history.
export interface MatchResultData {
  matching: Matching;
  semanticMatch: SemanticMatch | null;
  semanticError: SemanticError | null;
  analysis: MatchAnalysis | null;
  analysisError?: SemanticError | null;
  recommendations: ResumeRecommendations | null;
  recommendationsError?: SemanticError | null;
}

// Renders a match result. Used for a fresh match and for a saved one, which is
// shown exactly as stored.
export function MatchResultView({ result }: { result: MatchResultData }) {
  const { matching, analysis } = result;
  return (
    <div className="space-y-3">
      <ScoreView matching={matching} />
      <p className="text-xs font-semibold uppercase tracking-wide text-gray-500 pt-1">Match Analysis</p>
      {analysis ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <OverallAnalysisCard analysis={analysis} />
          <DeterministicAnalysisCard analysis={analysis} />
        </div>
      ) : (
        <p className="text-sm text-gray-500">{result.analysisError?.message || 'Match analysis is not available.'}</p>
      )}
      <SemanticView semantic={result.semanticMatch} error={result.semanticError} />
      {analysis && (
        <>
          <StrengthsAndGaps analysis={analysis} />
          <DataQualityCard analysis={analysis} />
        </>
      )}
      <RecommendationsView recommendations={result.recommendations} error={result.recommendationsError ?? null} />
      <details open className="border border-gray-200 rounded-lg p-3 bg-white">
        <summary className="cursor-pointer text-sm font-medium text-gray-800">Detailed comparison</summary>
        <div className="mt-3">
          <MatchingView matching={matching} />
        </div>
      </details>
    </div>
  );
}

interface Props {
  resumeId: string;
  jobDescriptions: JobDescriptionSummary[];
  // Called after a result has been saved to match history.
  onMatchSaved?: () => void;
  // Preselects a job description; must be one of `jobDescriptions`.
  initialJobDescriptionId?: string;
}

export default function ResumeJobMatch({ resumeId, jobDescriptions, onMatchSaved, initialJobDescriptionId }: Props) {
  const [selectedId, setSelectedId] = useState(initialJobDescriptionId ?? '');
  const [status, setStatus] = useState<Status>('idle');
  const [result, setResult] = useState<MatchResultData | null>(null);
  const [matchId, setMatchId] = useState<string | null>(null);
  const [historyError, setHistoryError] = useState<SemanticError | null>(null);
  const [error, setError] = useState<{ message: string; code: string | null } | null>(null);
  // Blocks a second click that arrives before the disabled button has rendered.
  const runningRef = useRef(false);

  if (jobDescriptions.length === 0) {
    return (
      <p className="text-sm text-gray-500">
        <Link href="/job-descriptions/create" className="text-blue-600 hover:text-blue-800">Add a job description</Link> to compare it with this resume.
      </p>
    );
  }

  const jobId = selectedId || jobDescriptions[0].id;

  const runMatch = async () => {
    if (runningRef.current) return;
    runningRef.current = true;
    setStatus('processing');
    setError(null);
    try {
      const data = await matchResumeToJob(resumeId, jobId);
      setResult(data.data);
      setMatchId(data.data.matchId ?? null);
      setHistoryError(data.data.historyError ?? null);
      setStatus('completed');
      if (data.data.matchId) onMatchSaved?.();
    } catch (err: unknown) {
      setError({
        message: err instanceof Error && err.message ? err.message : 'Matching failed',
        code: err instanceof ApiError ? err.code : null,
      });
      setStatus('failed');
    } finally {
      runningRef.current = false;
    }
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-col sm:flex-row gap-2">
        <label htmlFor={`match-${resumeId}`} className="sr-only">Select Job Description</label>
        <select
          id={`match-${resumeId}`}
          value={jobId}
          onChange={(e) => {
            setSelectedId(e.target.value);
            setStatus('idle');
            setResult(null);
          }}
          disabled={status === 'processing'}
          className="flex-1 min-w-0 border border-gray-300 rounded px-2 py-1 text-sm bg-white"
        >
          {jobDescriptions.map((jd) => (
            <option key={jd.id} value={jd.id}>
              {jd.title}{jd.companyName ? ` — ${jd.companyName}` : ''}
            </option>
          ))}
        </select>
        <button
          onClick={runMatch}
          disabled={status === 'processing'}
          className="text-sm bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50 px-3 py-1 rounded transition whitespace-nowrap"
        >
          Analyze Match
        </button>
      </div>

      {status === 'processing' && <p className="text-sm text-blue-600 font-medium">Analyzing resume against job...</p>}
      {status === 'failed' && error && (
        <div className="text-sm space-y-1">
          <p className="text-red-600 font-medium whitespace-pre-line">{error.message}</p>
          {error.code === 'JOB_REQUIREMENTS_NOT_AVAILABLE' && (
            <Link href={`/job-descriptions/${jobId}`} className="text-blue-600 hover:text-blue-800">
              Open the job description to extract its requirements
            </Link>
          )}
        </div>
      )}
      {status === 'completed' && result && (
        <div className="space-y-3">
          {matchId ? (
            <p className="text-sm text-green-700" role="status">
              Saved to{' '}
              <Link href={`/dashboard/match-history/${matchId}`} className="underline hover:text-green-900">
                match history
              </Link>
              .
            </p>
          ) : (
            historyError && <p className="text-sm text-gray-500" role="status">{historyError.message}</p>
          )}
          <MatchResultView result={result} />
        </div>
      )}
    </div>
  );
}
