import { z } from 'zod';

// Client for the Python/FastAPI AI service. Config is read on each call so it
// always reflects the loaded environment.

const DEFAULT_AI_SERVICE_URL = 'http://localhost:8000';
const DEFAULT_TIMEOUT_MS = 10000;
// Semantic matching may wait for the embedding model to finish loading after a restart.
const DEFAULT_SEMANTIC_TIMEOUT_MS = 30000;

export class AiServiceError extends Error {
  constructor(
    public readonly statusCode: number,
    public readonly code: string,
    message: string
  ) {
    super(message);
    this.name = 'AiServiceError';
  }
}

// Errors from the AI service that are safe and meaningful to pass on to API clients.
const PASSTHROUGH_ERRORS: Record<string, number> = {
  EMPTY_RESUME_TEXT: 422,
  RESUME_TEXT_TOO_LARGE: 413,
  RESUME_ANALYSIS_FAILED: 500,
  EMPTY_JOB_DESCRIPTION_TEXT: 422,
  JOB_DESCRIPTION_TEXT_TOO_LARGE: 413,
  JOB_REQUIREMENT_EXTRACTION_FAILED: 500,
  MATCHING_FAILED: 500,
  EMBEDDING_MODEL_UNAVAILABLE: 503,
  EMPTY_RESUME_CONTENT: 422,
  EMPTY_JOB_CONTENT: 422,
  SEMANTIC_MATCHING_FAILED: 500,
  MATCH_ANALYSIS_FAILED: 500,
  RECOMMENDATIONS_FAILED: 500,
};

const positiveInt = (value: string | undefined, fallback: number) => {
  const parsed = parseInt(value || '', 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
};

const getConfig = () => {
  return {
    baseUrl: (process.env.AI_SERVICE_URL || DEFAULT_AI_SERVICE_URL).replace(/\/+$/, ''),
    timeoutMs: positiveInt(process.env.AI_SERVICE_TIMEOUT_MS, DEFAULT_TIMEOUT_MS),
    semanticTimeoutMs: positiveInt(process.env.AI_SEMANTIC_TIMEOUT_MS, DEFAULT_SEMANTIC_TIMEOUT_MS),
    apiKey: process.env.INTERNAL_API_KEY || '',
  };
};

const request = async (path: string, init: { method: string; body?: unknown; timeoutMs?: number }) => {
  const { baseUrl, apiKey } = getConfig();
  const timeoutMs = init.timeoutMs ?? getConfig().timeoutMs;
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (init.body !== undefined) headers['Content-Type'] = 'application/json';
  if (apiKey) headers['X-Internal-API-Key'] = apiKey;

  let response: Response;
  try {
    response = await fetch(`${baseUrl}${path}`, {
      method: init.method,
      headers,
      body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (error: any) {
    if (error?.name === 'TimeoutError') {
      throw new AiServiceError(504, 'AI_SERVICE_TIMEOUT', 'AI service did not respond in time');
    }
    throw new AiServiceError(503, 'AI_SERVICE_UNAVAILABLE', 'AI service is unavailable');
  }

  let body: any = null;
  try {
    body = await response.json();
  } catch {
    // Non-JSON body; handled below.
  }

  if (!response.ok || !body?.success) {
    const code = body?.error?.code;
    if (code && PASSTHROUGH_ERRORS[code]) {
      throw new AiServiceError(PASSTHROUGH_ERRORS[code], code, body.message);
    }
    // Log only status and error code, never the payload, which may contain resume text.
    console.error(`AI service request to ${path} failed: status=${response.status} code=${code ?? 'unknown'}`);
    throw new AiServiceError(502, 'AI_SERVICE_ERROR', 'AI service returned an error');
  }

  return body.data;
};

export const checkAiServiceHealth = async (): Promise<boolean> => {
  try {
    const data = await request('/api/health', { method: 'GET' });
    return data?.status === 'healthy';
  } catch {
    return false;
  }
};

export interface PreprocessedResumeText {
  resumeId: string;
  text: string;
}

export const preprocessResumeText = async (
  resumeId: string,
  text: string
): Promise<PreprocessedResumeText> => {
  const data = await request('/api/resume/preprocess', {
    method: 'POST',
    body: { resume_id: resumeId, text },
  });

  if (typeof data?.resumeId !== 'string' || typeof data?.text !== 'string') {
    throw new AiServiceError(502, 'AI_SERVICE_ERROR', 'AI service returned an invalid response');
  }
  return { resumeId: data.resumeId, text: data.text };
};

// Category key -> canonical skill names, e.g. { frontend: ['React', 'Next.js'] }.
export type SkillsByCategory = Record<string, string[]>;

export interface ExtractedResumeSkills {
  resumeId: string;
  skills: SkillsByCategory;
  totalSkills: number;
}

// Must stay within the resume_skills column sizes.
const MAX_SKILL_NAME_LENGTH = 100;
const MAX_SKILL_CATEGORY_LENGTH = 50;

const isValidLabel = (value: unknown, maxLength: number): value is string =>
  typeof value === 'string' && value.length > 0 && value.length <= maxLength;

const isValidSkills = (skills: unknown): skills is SkillsByCategory =>
  typeof skills === 'object' &&
  skills !== null &&
  !Array.isArray(skills) &&
  Object.entries(skills).every(
    ([category, names]) =>
      isValidLabel(category, MAX_SKILL_CATEGORY_LENGTH) &&
      Array.isArray(names) &&
      names.every((name) => isValidLabel(name, MAX_SKILL_NAME_LENGTH))
  );

export const extractResumeSkills = async (
  resumeId: string,
  text: string
): Promise<ExtractedResumeSkills> => {
  const data = await request('/api/resume/extract-skills', {
    method: 'POST',
    body: { resume_id: resumeId, text },
  });

  if (typeof data?.resumeId !== 'string' || !isValidSkills(data?.skills)) {
    throw new AiServiceError(502, 'AI_SERVICE_ERROR', 'AI service returned an invalid response');
  }
  const skills: SkillsByCategory = data.skills;
  return {
    resumeId: data.resumeId,
    skills,
    totalSkills: Object.values(skills).reduce((sum, names) => sum + names.length, 0),
  };
};

// Canonical sections the AI service can return, in display order.
export const RESUME_SECTION_KEYS = [
  'personal_information',
  'summary',
  'experience',
  'education',
  'projects',
  'skills',
  'certifications',
  'achievements',
  'languages',
  'interests',
  'references',
] as const;

export type ResumeSectionKey = (typeof RESUME_SECTION_KEYS)[number];

// Sections that were not found are omitted. other_sections holds recognised
// headings without a canonical section, keyed by the heading as written.
export type ResumeSections = Partial<Record<ResumeSectionKey, string>> & {
  other_sections: Record<string, string>;
};

export interface ExtractedResumeSections {
  resumeId: string;
  sections: ResumeSections;
}

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const isStringMap = (value: unknown): value is Record<string, string> =>
  isPlainObject(value) && Object.values(value).every((v) => typeof v === 'string');

export const extractResumeSections = async (
  resumeId: string,
  text: string
): Promise<ExtractedResumeSections> => {
  const data = await request('/api/resume/extract-sections', {
    method: 'POST',
    body: { resume_id: resumeId, text },
  });

  const raw = data?.sections;
  const otherSections = raw?.other_sections ?? {};
  if (typeof data?.resumeId !== 'string' || !isPlainObject(raw) || !isStringMap(otherSections)) {
    throw new AiServiceError(502, 'AI_SERVICE_ERROR', 'AI service returned an invalid response');
  }

  // Copy only the known sections, so the response contract stays fixed.
  const known: Partial<Record<ResumeSectionKey, string>> = {};
  for (const key of RESUME_SECTION_KEYS) {
    const value = raw[key];
    if (value === undefined || value === null) continue;
    if (typeof value !== 'string') {
      throw new AiServiceError(502, 'AI_SERVICE_ERROR', 'AI service returned an invalid response');
    }
    known[key] = value;
  }
  return { resumeId: data.resumeId, sections: { ...known, other_sections: otherSections } };
};

// Structured resume analysis. Unknown keys are stripped, so the response
// contract passed to the frontend stays fixed even if the AI service adds fields.
const nullableText = z.string().nullable();
const textList = z.array(z.string());

const structuredResumeSchema = z.object({
  personalInformation: z.object({
    name: nullableText,
    email: nullableText,
    phone: nullableText,
    location: nullableText,
    linkedin: nullableText,
    github: nullableText,
    portfolio: nullableText,
  }),
  summary: nullableText,
  experience: z.array(
    z.object({
      title: nullableText,
      company: nullableText,
      location: nullableText,
      startDate: nullableText,
      endDate: nullableText,
      isCurrent: z.boolean(),
      description: textList,
      rawText: z.string(),
    })
  ),
  education: z.array(
    z.object({
      degree: nullableText,
      field: nullableText,
      institution: nullableText,
      startDate: nullableText,
      endDate: nullableText,
      isCurrent: z.boolean(),
      grade: nullableText,
      rawText: z.string(),
    })
  ),
  projects: z.array(
    z.object({
      name: nullableText,
      description: textList,
      technologies: textList,
      url: nullableText,
      rawText: z.string(),
    })
  ),
  skills: z.record(z.string(), textList),
  certifications: z.array(z.object({ name: z.string(), issuer: nullableText, date: nullableText })),
  achievements: textList,
  languages: textList,
  interests: textList,
  otherSections: z.record(z.string(), z.string()),
});

const count = z.number().int().nonnegative();

const resumeAnalysisSchema = z.object({
  resumeId: z.string(),
  resume: structuredResumeSchema,
  metadata: z.object({
    totalSkills: count,
    totalExperienceEntries: count,
    totalEducationEntries: count,
    totalProjects: count,
    totalCertifications: count,
  }),
});

export type StructuredResume = z.infer<typeof structuredResumeSchema>;
export type ResumeAnalysis = z.infer<typeof resumeAnalysisSchema>;

export const analyzeResume = async (resumeId: string, text: string): Promise<ResumeAnalysis> => {
  const data = await request('/api/resume/analyze', {
    method: 'POST',
    body: { resume_id: resumeId, text },
  });

  const parsed = resumeAnalysisSchema.safeParse(data);
  if (!parsed.success) {
    // Log only where the payload is malformed, never its values (they are resume contents).
    const paths = parsed.error.issues.map((issue) => issue.path.join('.')).slice(0, 5);
    console.error(`AI service returned a malformed analysis: ${paths.join(', ')}`);
    throw new AiServiceError(502, 'AI_SERVICE_ERROR', 'AI service returned an invalid response');
  }
  return parsed.data;
};

export interface ProcessedJobDescription {
  jobDescriptionId: string;
  processedText: string;
}

// AI-side text validation errors for job descriptions. The backend validates text
// before saving it, so these only occur for text that is empty once cleaned
// (e.g. only invisible characters) or a misconfigured AI service limit.
const JOB_DESCRIPTION_TEXT_ERRORS = new Set(['EMPTY_JOB_DESCRIPTION_TEXT', 'JOB_DESCRIPTION_TEXT_TOO_LARGE']);

export const preprocessJobDescription = async (
  jobDescriptionId: string,
  text: string
): Promise<ProcessedJobDescription> => {
  let data: any;
  try {
    data = await request('/api/job-description/preprocess', {
      method: 'POST',
      body: { job_description_id: jobDescriptionId, text },
    });
  } catch (error) {
    if (error instanceof AiServiceError && JOB_DESCRIPTION_TEXT_ERRORS.has(error.code)) {
      throw new AiServiceError(422, 'JOB_DESCRIPTION_PROCESSING_ERROR', 'Job description text could not be processed');
    }
    throw error;
  }

  if (typeof data?.jobDescriptionId !== 'string' || typeof data?.processedText !== 'string') {
    throw new AiServiceError(502, 'AI_SERVICE_ERROR', 'AI service returned an invalid response');
  }
  return { jobDescriptionId: data.jobDescriptionId, processedText: data.processedText };
};

// Structured job requirements (Step 5B). Unknown keys are stripped so the
// contract passed to the frontend and stored in MySQL stays fixed.
const yearsCount = z.number().nonnegative().max(60).nullable();

const jobRequirementsSchema = z.object({
  jobTitle: nullableText,
  location: nullableText,
  employmentType: nullableText,
  workMode: nullableText,
  requiredSkills: textList,
  preferredSkills: textList,
  mentionedSkills: textList,
  experienceRequirements: z.array(
    z.object({
      minimumYears: yearsCount,
      maximumYears: yearsCount,
      areas: textList,
      preferred: z.boolean(),
      text: z.string(),
    })
  ),
  educationRequirements: z.array(
    z.object({
      degree: nullableText,
      fields: textList,
      preferred: z.boolean(),
      text: z.string(),
    })
  ),
  responsibilities: textList,
});

const extractedJobRequirementsSchema = z.object({
  jobDescriptionId: z.string(),
  requirements: jobRequirementsSchema,
});

export type JobRequirements = z.infer<typeof jobRequirementsSchema>;

export const extractJobRequirements = async (
  jobDescriptionId: string,
  text: string,
  jobTitle: string | null
): Promise<JobRequirements> => {
  let data: unknown;
  try {
    data = await request('/api/job-description/extract-requirements', {
      method: 'POST',
      body: { job_description_id: jobDescriptionId, text, job_title: jobTitle },
    });
  } catch (error) {
    if (error instanceof AiServiceError && JOB_DESCRIPTION_TEXT_ERRORS.has(error.code)) {
      throw new AiServiceError(422, 'JOB_DESCRIPTION_PROCESSING_ERROR', 'Job description text could not be processed');
    }
    if (error instanceof AiServiceError && error.code === 'JOB_REQUIREMENT_EXTRACTION_FAILED') {
      throw new AiServiceError(500, 'JOB_DESCRIPTION_PROCESSING_ERROR', 'Job requirement extraction failed');
    }
    throw error;
  }

  const parsed = extractedJobRequirementsSchema.safeParse(data);
  if (!parsed.success) {
    // Log only where the payload is malformed, never its values.
    const paths = parsed.error.issues.map((issue) => issue.path.join('.')).slice(0, 5);
    console.error(`AI service returned malformed job requirements: ${paths.join(', ')}`);
    throw new AiServiceError(502, 'AI_SERVICE_ERROR', 'AI service returned an invalid response');
  }
  return parsed.data.requirements;
};

// Resume <-> job matching (Step 6A). Only the structured data matching needs is
// sent: skills, dated jobs with their text, degrees, and the job requirements.
export interface MatchResumeInput {
  skills: Record<string, string[]>;
  experience: { startDate: string | null; endDate: string | null; isCurrent: boolean; text: string }[];
  education: { degree: string | null; field: string | null }[];
}

export type MatchJobRequirementsInput = Pick<
  JobRequirements,
  'requiredSkills' | 'preferredSkills' | 'experienceRequirements' | 'educationRequirements'
>;

// The parts of a structured resume (Step 4D) and of stored job requirements
// that the matcher takes; shared by matching and tailoring.
export const toMatchResumeInput = (structured: StructuredResume): MatchResumeInput => ({
  skills: structured.skills,
  experience: structured.experience.map((job) => ({
    startDate: job.startDate,
    endDate: job.endDate,
    isCurrent: job.isCurrent,
    text: job.rawText,
  })),
  education: structured.education.map((entry) => ({ degree: entry.degree, field: entry.field })),
});

export const toMatchJobRequirementsInput = (requirements: MatchJobRequirementsInput): MatchJobRequirementsInput => ({
  requiredSkills: requirements.requiredSkills,
  preferredSkills: requirements.preferredSkills,
  experienceRequirements: requirements.experienceRequirements,
  educationRequirements: requirements.educationRequirements,
});

const percentage = z.number().min(0).max(100).nullable();
const nullableYears = z.number().nonnegative().max(60).nullable();
const nullableBoolean = z.boolean().nullable();

const skillComparisonSchema = z.object({
  matched: textList,
  missing: textList,
  coverage: percentage,
  byCategory: z.record(z.string(), z.object({ matched: textList, missing: textList })),
});

// Match score (Step 6B). Every component is reported, including the ones that
// did not count, so the overall score can be explained.
const scoreComponentSchema = z.object({
  score: percentage,
  weight: z.number().min(0).max(100),
  effectiveWeight: percentage,
  contribution: percentage,
  status: z.enum(['calculated', 'not_applicable', 'insufficient_data']),
  reason: nullableText,
});

const scoreComponentsSchema = z.object({
  requiredSkills: scoreComponentSchema,
  preferredSkills: scoreComponentSchema,
  experience: scoreComponentSchema,
  education: scoreComponentSchema,
});

const scoreMetadataSchema = z.object({
  scoringMethod: z.string(),
  version: z.string(),
  weights: z.object({
    requiredSkills: z.number().min(0).max(100),
    preferredSkills: z.number().min(0).max(100),
    experience: z.number().min(0).max(100),
    education: z.number().min(0).max(100),
  }),
});

const matchingResultSchema = z.object({
  resumeId: z.string(),
  overallScore: percentage,
  scoreStatus: z.enum(['calculated', 'insufficient_data']),
  components: scoreComponentsSchema,
  scoreMetadata: scoreMetadataSchema,
  jobDescriptionId: z.string(),
  skills: z.object({ required: skillComparisonSchema, preferred: skillComparisonSchema }),
  experience: z.object({
    status: z.enum(['compared', 'not_applicable']),
    requiredYears: nullableYears,
    candidateYears: nullableYears,
    candidateYearsReason: nullableText,
    meetsRequirement: nullableBoolean,
    requirements: z.array(
      z.object({
        minimumYears: nullableYears,
        maximumYears: nullableYears,
        preferred: z.boolean(),
        text: z.string(),
        candidateYears: nullableYears,
        meetsRequirement: nullableBoolean,
        areas: z.array(
          z.object({
            area: z.string(),
            requiredYears: nullableYears,
            candidateYears: nullableYears,
            meetsRequirement: nullableBoolean,
          })
        ),
      })
    ),
  }),
  education: z.object({
    status: z.enum(['compared', 'not_applicable']),
    requirements: z.array(
      z.object({
        requirement: nullableText,
        requiredFields: textList,
        preferred: z.boolean(),
        text: z.string(),
        requiredLevel: nullableText,
        candidateEducation: nullableText,
        candidateLevel: nullableText,
        meetsRequirement: nullableBoolean,
        fieldMatch: nullableBoolean,
      })
    ),
  }),
  summary: z.object({
    requiredSkillCount: count,
    matchedRequiredSkillCount: count,
    missingRequiredSkillCount: count,
    preferredSkillCount: count,
    matchedPreferredSkillCount: count,
    missingPreferredSkillCount: count,
  }),
});

export type MatchingResult = z.infer<typeof matchingResultSchema>;

export const analyzeResumeJobMatch = async (
  resumeId: string,
  jobDescriptionId: string,
  resume: MatchResumeInput,
  jobRequirements: MatchJobRequirementsInput
): Promise<MatchingResult> => {
  let data: any;
  try {
    data = await request('/api/matching/analyze', {
      method: 'POST',
      body: { resume_id: resumeId, job_description_id: jobDescriptionId, resume, job_requirements: jobRequirements },
    });
  } catch (error) {
    if (error instanceof AiServiceError && error.code === 'MATCHING_FAILED') {
      throw new AiServiceError(500, 'MATCHING_ERROR', 'Resume and job matching failed');
    }
    throw error;
  }

  const parsed = matchingResultSchema.safeParse(data?.matching);
  if (!parsed.success) {
    // Log only where the payload is malformed, never its values.
    const paths = parsed.error.issues.map((issue) => issue.path.join('.')).slice(0, 5);
    console.error(`AI service returned a malformed matching result: ${paths.join(', ')}`);
    throw new AiServiceError(502, 'AI_SERVICE_ERROR', 'AI service returned an invalid response');
  }
  return parsed.data;
};

// Semantic matching (Step 6C). Only professional content is sent: no personal
// details, ids or file paths. Embeddings stay inside the AI service.
export interface SemanticResumeInput {
  summary: string | null;
  experience: { title: string | null; company: string | null; description: string[]; rawText: string }[];
  projects: { name: string | null; description: string[]; technologies: string[] }[];
  skills: Record<string, string[]>;
  education: { degree: string | null; field: string | null; institution: string | null }[];
}

export interface SemanticJobInput {
  title: string;
  description: string;
  responsibilities: string[];
  requiredSkills: string[];
  preferredSkills: string[];
  experienceRequirements: { text: string }[];
  educationRequirements: { text: string }[];
}

const semanticComponentSchema = z.object({
  similarity: percentage,
  status: z.enum(['calculated', 'not_available']),
  reason: nullableText,
  truncated: z.boolean(),
});

const semanticMatchSchema = z.object({
  resumeId: z.string(),
  jobDescriptionId: z.string(),
  overallSemanticSimilarity: semanticComponentSchema,
  experienceSemanticSimilarity: semanticComponentSchema,
  projectSemanticSimilarity: semanticComponentSchema,
  skillsSemanticSimilarity: semanticComponentSchema,
  metadata: z.object({ model: z.string(), method: z.literal('cosine_similarity') }),
});

export type SemanticMatch = z.infer<typeof semanticMatchSchema>;

export const analyzeSemanticMatch = async (
  resumeId: string,
  jobDescriptionId: string,
  resume: SemanticResumeInput,
  job: SemanticJobInput
): Promise<SemanticMatch> => {
  const data = await request('/api/matching/semantic', {
    method: 'POST',
    body: { resume_id: resumeId, job_description_id: jobDescriptionId, resume, job },
    timeoutMs: getConfig().semanticTimeoutMs,
  });

  const parsed = semanticMatchSchema.safeParse(data?.semanticMatch);
  if (!parsed.success) {
    const paths = parsed.error.issues.map((issue) => issue.path.join('.')).slice(0, 5);
    console.error(`AI service returned a malformed semantic match: ${paths.join(', ')}`);
    throw new AiServiceError(502, 'AI_SERVICE_ERROR', 'AI service returned an invalid response');
  }
  return parsed.data;
};

// Match analysis (Step 7A): a rule-based explanation of the results above.
const observation = <T extends [string, ...string[]]>(categories: T) =>
  z.object({ category: z.enum(categories), message: z.string() });

const skillCoverageSchema = z.object({
  status: z.enum(['calculated', 'not_applicable']),
  matched: textList,
  missing: textList,
  coverage: percentage,
  coverageLevel: z.enum(['complete', 'strong', 'partial', 'limited', 'none']).nullable(),
});

const semanticAspectSchema = z
  .object({
    similarity: percentage,
    level: z.enum(['very_high', 'high', 'moderate', 'low', 'very_low']).nullable(),
    status: z.enum(['calculated', 'not_available']),
  })
  .nullable();

const matchAnalysisSchema = z.object({
  overall: z.object({
    matchScore: percentage,
    scoreAvailable: z.boolean(),
    summary: z.string(),
    highlights: z.array(observation(['required_skills', 'preferred_skills', 'experience', 'education', 'semantic_similarity'])),
  }),
  skills: z.object({ required: skillCoverageSchema, preferred: skillCoverageSchema }),
  experience: z.object({
    status: z.enum(['satisfied', 'below_requirement', 'not_applicable', 'insufficient_data']),
    requiredYears: nullableYears,
    candidateYears: nullableYears,
    score: percentage,
    reason: nullableText,
    skillSpecific: z.array(
      z.object({
        area: z.string(),
        requiredYears: nullableYears,
        evidenceYears: nullableYears,
        status: z.enum(['satisfied', 'skill_not_found', 'insufficient_evidence']),
        preferred: z.boolean(),
      })
    ),
  }),
  education: z.object({
    status: z.enum(['satisfied', 'not_satisfied', 'not_applicable', 'insufficient_data']),
    requiredDegree: nullableText,
    requiredFields: textList,
    candidateDegree: nullableText,
    fieldMatch: nullableBoolean,
    reason: nullableText,
  }),
  semanticSimilarity: z.object({
    status: z.enum(['calculated', 'unavailable']),
    overall: semanticAspectSchema,
    experience: semanticAspectSchema,
    projects: semanticAspectSchema,
    skills: semanticAspectSchema,
    reason: nullableText,
    signalComparison: z
      .object({
        exactRequiredSkillCoverage: z.number(),
        semanticSkillsSimilarity: z.number(),
        difference: z.number(),
        observation: nullableText,
      })
      .nullable(),
  }),
  dataQuality: z.object({
    status: z.enum(['complete', 'mostly_complete', 'partial', 'insufficient']),
    issues: textList,
    notApplicable: textList,
  }),
  strengths: z.array(observation(['skills', 'experience', 'education', 'projects', 'semantic_similarity'])).max(5),
  gaps: z.array(observation(['required_skill', 'preferred_skill', 'experience', 'education', 'insufficient_data'])).max(5),
  additionalGapCount: count,
});

export type MatchAnalysis = z.infer<typeof matchAnalysisSchema>;

export const analyzeMatchResults = async (
  matching: MatchingResult,
  semanticMatch: SemanticMatch | null,
  semanticError: { code: string; message: string } | null
): Promise<MatchAnalysis> => {
  const data = await request('/api/matching/analysis', {
    method: 'POST',
    body: { matching, semanticMatch, semanticError },
  });

  const parsed = matchAnalysisSchema.safeParse(data?.analysis);
  if (!parsed.success) {
    const paths = parsed.error.issues.map((issue) => issue.path.join('.')).slice(0, 5);
    console.error(`AI service returned a malformed match analysis: ${paths.join(', ')}`);
    throw new AiServiceError(502, 'AI_SERVICE_ERROR', 'AI service returned an invalid response');
  }
  return parsed.data;
};

// Resume improvement recommendations (Step 7B), built from the results above.
// Only role and project entries are sent; personal details never are.
export interface RecommendationResumeInput {
  experience: {
    title: string | null;
    company: string | null;
    startDate: string | null;
    endDate: string | null;
    isCurrent: boolean;
    description: string[];
  }[];
  projects: { name: string | null; description: string[]; technologies: string[] }[];
}

const recommendationSchema = z.object({
  id: z.string().regex(/^rec-\d{3}$/),
  category: z.enum(['required_skill', 'preferred_skill', 'experience', 'projects', 'education', 'resume_content', 'data_quality']),
  priority: z.enum(['high', 'medium', 'low']),
  title: z.string().min(1),
  issue: z.string().min(1),
  reason: z.string().min(1),
  action: z.string().min(1),
  relatedSkills: textList,
  evidence: nullableText,
});

const recommendationsSchema = z.object({
  items: z.array(recommendationSchema).max(8),
  total: count,
  limitations: textList,
  message: nullableText,
});

export type ResumeRecommendations = z.infer<typeof recommendationsSchema>;

export const generateRecommendations = async (
  matching: MatchingResult,
  analysis: MatchAnalysis,
  resume: RecommendationResumeInput
): Promise<ResumeRecommendations> => {
  const data = await request('/api/matching/recommendations', {
    method: 'POST',
    body: { matching, analysis, resume },
  });

  const parsed = recommendationsSchema.safeParse(data?.recommendations);
  if (!parsed.success || parsed.data.total !== parsed.data.items.length) {
    const paths = parsed.success ? ['total'] : parsed.error.issues.map((issue) => issue.path.join('.')).slice(0, 5);
    console.error(`AI service returned malformed recommendations: ${paths.join(', ')}`);
    throw new AiServiceError(502, 'AI_SERVICE_ERROR', 'AI service returned an invalid response');
  }
  return parsed.data;
};

// Rule-based cover letters (Step 12). Only structured facts are sent: the
// candidate's name, skills, roles with their description lines, projects,
// education and certifications, and the job's title, company and skills. No
// raw text and no contact details. Lists and strings are trimmed to the AI
// service's limits.
export type CoverLetterTone = 'professional' | 'confident' | 'conversational' | 'concise';
export type CoverLetterLength = 'short' | 'standard' | 'detailed';
export const COVER_LETTER_TONES: readonly CoverLetterTone[] = ['professional', 'confident', 'conversational', 'concise'];
export const COVER_LETTER_LENGTHS: readonly CoverLetterLength[] = ['short', 'standard', 'detailed'];

const cut = (value: string | null | undefined, max: number) => (value ? value.slice(0, max) : null);
const cutList = (values: string[], count: number, max = 200) => values.slice(0, count).map((v) => v.slice(0, max));

export const toCoverLetterFacts = (structured: StructuredResume, requirements: Pick<JobRequirements, 'requiredSkills' | 'preferredSkills'>, job: { title: string; companyName: string | null }) => ({
  candidate: {
    name: cut(structured.personalInformation.name, 200),
    skills: cutList([...new Set(Object.values(structured.skills).flat())], 300),
    experience: structured.experience.slice(0, 30).map((e) => ({
      title: cut(e.title, 200),
      company: cut(e.company, 200),
      startDate: cut(e.startDate, 200),
      endDate: cut(e.endDate, 200),
      isCurrent: e.isCurrent,
      highlights: cutList(e.description, 12, 500),
    })),
    projects: structured.projects.slice(0, 30).map((p) => ({ name: cut(p.name, 200), technologies: cutList(p.technologies, 30), highlights: cutList(p.description, 12, 500) })),
    education: structured.education.slice(0, 15).map((e) => ({ degree: cut(e.degree, 200), field: cut(e.field, 200), institution: cut(e.institution, 200), isCurrent: e.isCurrent })),
    certifications: cutList(structured.certifications.map((c) => c.name), 30),
  },
  job: {
    title: job.title.slice(0, 200),
    companyName: cut(job.companyName, 200),
    requiredSkills: cutList(requirements.requiredSkills, 300),
    preferredSkills: cutList(requirements.preferredSkills, 300),
  },
});

const coverLetterSchema = z.object({
  method: z.literal('rule_based'),
  tone: z.enum(['professional', 'confident', 'conversational', 'concise']),
  length: z.enum(['short', 'standard', 'detailed']),
  paragraphs: z.array(z.string().max(6000)).min(1).max(20),
  text: z.string().min(1).max(6000),
  wordCount: z.number().int().nonnegative(),
  placeholders: textList,
  usedFacts: z.object({ skills: textList, experience: textList, projects: textList, education: textList, certifications: textList }),
  notes: textList,
});

export type GeneratedCoverLetter = z.infer<typeof coverLetterSchema>;

export const generateCoverLetter = async (
  facts: ReturnType<typeof toCoverLetterFacts>,
  tone: CoverLetterTone,
  length: CoverLetterLength
): Promise<GeneratedCoverLetter> => {
  const data = await request('/api/cover-letter/generate', { method: 'POST', body: { ...facts, tone, length } });
  const parsed = coverLetterSchema.safeParse(data?.coverLetter);
  if (!parsed.success) {
    // Log only where the payload is malformed, never its values (they are letter contents).
    const paths = parsed.error.issues.map((issue) => issue.path.join('.')).slice(0, 5);
    console.error(`AI service returned a malformed cover letter: ${paths.join(', ')}`);
    throw new AiServiceError(502, 'AI_SERVICE_ERROR', 'AI service returned an invalid response');
  }
  return parsed.data;
};

// ---- Mock interviews (Step 16) ----

export const INTERVIEW_TYPES = ['technical', 'behavioral', 'hr', 'mixed'] as const;
export const INTERVIEW_DIFFICULTIES = ['beginner', 'intermediate', 'advanced'] as const;
export type InterviewType = (typeof INTERVIEW_TYPES)[number];
export type InterviewDifficulty = (typeof INTERVIEW_DIFFICULTIES)[number];

const label = z.string().min(1).max(200);
const interviewQuestionSchema = z.object({
  type: z.enum(['technical', 'behavioral', 'hr']),
  text: z.string().min(10).max(1000),
  focus: label,
  difficulty: z.enum(INTERVIEW_DIFFICULTIES),
  expectedPoints: z.array(z.object({ label, keywords: z.array(z.string().min(1).max(60)).min(1).max(20) })).min(1).max(8),
  grounding: z.object({
    source: z.enum(['resume_and_job', 'job', 'resume', 'general']),
    skill: label.nullable().optional(),
    resumeReference: label.nullable().optional(),
  }),
  guidance: z.string().max(500).default(''),
});
export type InterviewQuestion = z.infer<typeof interviewQuestionSchema>;

const questionSetSchema = z.object({
  method: z.literal('rule_based'),
  generatorVersion: z.string().min(1).max(20),
  questions: z.array(interviewQuestionSchema).min(1).max(15),
  notes: z.array(z.string().max(1000)).max(10),
});

const feedbackList = z.array(z.string().min(1).max(1000)).max(20);
const evaluationSchema = z.object({
  method: z.literal('rule_based'),
  rulesVersion: z.string().min(1).max(20),
  score: z.number().int().min(0).max(100),
  insufficientDetail: z.boolean(),
  strengths: feedbackList,
  missingPoints: feedbackList,
  suggestions: feedbackList,
  exampleAnswer: z.string().max(3000).nullable(),
  conceptsToReview: feedbackList,
  coveredPoints: feedbackList,
  wordCount: z.number().int().nonnegative(),
});
export type InterviewEvaluation = z.infer<typeof evaluationSchema>;

// One automatic retry when the AI service could not be reached (e.g. a restart);
// timeouts and errors are reported straight away.
const withRetry = async <T>(work: () => Promise<T>): Promise<T> => {
  try {
    return await work();
  } catch (error) {
    if (!(error instanceof AiServiceError) || error.code !== 'AI_SERVICE_UNAVAILABLE') throw error;
    await new Promise((resolve) => setTimeout(resolve, 300));
    return work();
  }
};

const malformed = (what: string, error: z.ZodError) => {
  // Only where the payload is malformed, never its values.
  const paths = error.issues.map((issue) => issue.path.join('.')).slice(0, 5);
  console.error(`AI service returned malformed ${what}: ${paths.join(', ')}`);
  return new AiServiceError(502, 'AI_SERVICE_ERROR', 'AI service returned an invalid response');
};

export const generateInterviewQuestions = async (
  facts: ReturnType<typeof toCoverLetterFacts>,
  settings: { interviewType: InterviewType; difficulty: InterviewDifficulty; count: number }
) => {
  const data = await withRetry(() => request('/api/interview/questions', { method: 'POST', body: { ...facts, ...settings } }));
  const parsed = questionSetSchema.safeParse(data?.questionSet);
  if (!parsed.success) throw malformed('interview questions', parsed.error);
  if (parsed.data.questions.length > settings.count) throw new AiServiceError(502, 'AI_SERVICE_ERROR', 'AI service returned an invalid response');
  return parsed.data;
};

// The role's requirements are already part of the question (its expected points).
export const evaluateInterviewAnswer = async (question: InterviewQuestion, answer: string): Promise<InterviewEvaluation> => {
  const data = await withRetry(() => request('/api/interview/evaluate', { method: 'POST', body: { question, answer } }));
  const parsed = evaluationSchema.safeParse(data?.evaluation);
  if (!parsed.success) throw malformed('an interview evaluation', parsed.error);
  return parsed.data;
};

export const parseInterviewQuestion = (value: unknown) => interviewQuestionSchema.safeParse(value);
