import { apiClient } from './client';
import type { ResumeSummary } from './resume.api';

// Job-specific tailoring (Step 9C). Suggestions come from fixed rules, not from
// a language model; they only reorder, shorten or reword existing resume lines.

// Must match the backend's limit for an edited line.
export const MAX_EDITED_LINE_LENGTH = 1000;

export type SuggestionCategory = 'skills' | 'experience' | 'projects' | 'structure';
export type ReviewStatus = 'pending' | 'accepted' | 'edited' | 'rejected';
export type ReviewAction = 'accept' | 'edit' | 'reject' | 'reset';

export interface TailoringSuggestion {
  id: string;
  category: SuggestionCategory;
  section: 'skills' | 'experience' | 'projects';
  lineIndex: number;
  entryLabel: string | null;
  originalText: string;
  // Empty: the suggestion removes the line.
  suggestedText: string;
  editedText: string | null;
  reason: string;
  relatedRequirements: string[];
  status: ReviewStatus;
  updatedAt: string;
}

export interface RequirementCoverage {
  requirement: string;
  type: 'required_skill' | 'preferred_skill' | 'experience' | 'education';
  status: 'supported' | 'partial' | 'not_found';
  detail: string;
}

export interface TailoringNote {
  section: 'summary' | 'experience' | 'projects';
  lineIndex: number | null;
  lineText: string | null;
  message: string;
}

export interface TailoringSessionSummary {
  id: string;
  resumeId: string;
  jobDescriptionId: string;
  status: 'draft' | 'saved';
  savedResumeId: string | null;
  createdAt: string;
  updatedAt: string;
  jobTitle: string;
  companyName: string | null;
  resumeFilename: string;
  versionNumber: number;
  versionLabel: string | null;
}

export interface TailoringSessionListItem extends TailoringSessionSummary {
  suggestionCount: number;
  acceptedCount: number;
}

export interface TailoringSession extends TailoringSessionSummary {
  method: 'rule_based';
  requirements: RequirementCoverage[];
  notes: TailoringNote[];
  suggestions: TailoringSuggestion[];
}

export interface PreviewLine {
  index: number;
  text: string;
  status: 'original' | 'revised' | 'removed';
  originalText: string | null;
  suggestionId: string | null;
}

export interface TailoringPreview {
  lines: PreviewLine[];
  appliedCount: number;
  staleSuggestionIds: string[];
}

const base = (resumeId: string) => `/resumes/${encodeURIComponent(resumeId)}/tailoring`;
const json = (method: string, body: unknown): RequestInit => ({
  method,
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
});

export const createTailoring = async (resumeId: string, jobDescriptionId: string): Promise<TailoringSession> => {
  const data = await apiClient(base(resumeId), json('POST', { jobDescriptionId }));
  return data.data.session;
};

export const listTailoring = async (resumeId: string): Promise<TailoringSessionListItem[]> => {
  const data = await apiClient(base(resumeId));
  return data.data.sessions;
};

export const getTailoring = async (resumeId: string, sessionId: string): Promise<TailoringSession> => {
  const data = await apiClient(`${base(resumeId)}/${encodeURIComponent(sessionId)}`);
  return data.data.session;
};

export const reviewSuggestion = async (
  resumeId: string,
  sessionId: string,
  suggestionId: string,
  action: ReviewAction,
  editedText?: string
): Promise<TailoringSuggestion> => {
  const body = action === 'edit' ? { action, editedText } : { action };
  const data = await apiClient(
    `${base(resumeId)}/${encodeURIComponent(sessionId)}/suggestions/${encodeURIComponent(suggestionId)}`,
    json('PATCH', body)
  );
  return data.data.suggestion;
};

export const getTailoringPreview = async (resumeId: string, sessionId: string): Promise<TailoringPreview> => {
  const data = await apiClient(`${base(resumeId)}/${encodeURIComponent(sessionId)}/preview`);
  return data.data.preview;
};

export const saveTailoredCopy = async (
  resumeId: string,
  sessionId: string
): Promise<{ resume: ResumeSummary | null; created: boolean }> => {
  const data = await apiClient(`${base(resumeId)}/${encodeURIComponent(sessionId)}/save`, { method: 'POST' });
  return data.data;
};
