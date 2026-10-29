import { apiClient } from './client';

// ATS readiness (Step 11): deterministic checks of one resume version. The score
// is separate from the job match score and is an estimate, not a prediction.

export type CategoryId = 'structure' | 'content' | 'parsing' | 'contact';
export type CheckStatus = 'pass' | 'partial' | 'fail' | 'not_applicable' | 'not_evaluated';
export type Severity = 'high' | 'medium' | 'low';

export interface AtsCheckResult {
  id: string;
  category: CategoryId;
  title: string;
  status: CheckStatus;
  earned: number;
  available: number;
  detail: string;
}

export interface AtsRecommendation {
  id: string;
  checkId: string;
  category: CategoryId;
  severity: Severity;
  title: string;
  explanation: string;
  whyItMatters: string;
  action: string;
  example: string | null;
}

export interface AtsCategory {
  id: CategoryId;
  name: string;
  earned: number;
  available: number;
  evaluated: boolean;
}

export interface AtsResult {
  rulesVersion: string;
  score: number | null;
  band: { id: 'strong' | 'good' | 'fair' | 'weak'; label: string } | null;
  complete: boolean;
  incompleteReason: string | null;
  categories: AtsCategory[];
  checks: AtsCheckResult[];
  strengths: string[];
  recommendations: AtsRecommendation[];
  stats: { wordCount: number; lineCount: number; sectionsFound: string[] };
}

export interface StoredAtsCheck {
  id: string;
  createdAt: string;
  stale: boolean;
  result: AtsResult;
}

export interface AtsHistoryItem {
  id: string;
  score: number | null;
  band: string | null;
  complete: boolean;
  stale: boolean;
  createdAt: string;
}

export interface AtsScoring {
  rulesVersion: string;
  bands: { min: number; id: string; label: string }[];
  disclaimer: string;
}

export interface RequirementCoverage {
  requirement: string;
  type: 'required_skill' | 'preferred_skill' | 'experience' | 'education';
  status: 'supported' | 'partial' | 'not_found';
  detail: string;
}

export type AtsRelevance =
  | { status: 'available'; jobDescriptionId: string; jobTitle: string; companyName: string | null; requirements: RequirementCoverage[]; suggestions: string[] }
  | { status: 'unavailable'; jobDescriptionId: string; reason: string };

export const getAtsCheck = async (
  resumeId: string
): Promise<{ check: StoredAtsCheck | null; history: AtsHistoryItem[]; scoring: AtsScoring }> => {
  const data = await apiClient(`/resumes/${encodeURIComponent(resumeId)}/ats-check`);
  return data.data;
};

export const runAtsCheck = async (
  resumeId: string,
  jobDescriptionId: string | null
): Promise<{ check: StoredAtsCheck; relevance: AtsRelevance | null; scoring: AtsScoring }> => {
  const data = await apiClient(`/resumes/${encodeURIComponent(resumeId)}/ats-check`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(jobDescriptionId ? { jobDescriptionId } : {}),
  });
  return data.data;
};
