import { apiClient } from './client';

// Mock interviews (Step 16). Questions and feedback are rule-based estimates
// from the AI service; the backend stores sessions and answers.

export const INTERVIEW_TYPES = {
  technical: { label: 'Technical', description: 'Skills from the job and your resume' },
  behavioral: { label: 'Behavioral', description: 'Real examples, answered with STAR' },
  hr: { label: 'HR', description: 'Motivation, background and fit' },
  mixed: { label: 'Mixed', description: 'A blend of all three' },
} as const;
export const DIFFICULTIES = { beginner: 'Beginner', intermediate: 'Intermediate', advanced: 'Advanced' } as const;
export const QUESTION_TYPE_INFO = {
  technical: { label: 'Technical', symbol: '⌘', tone: 'bg-indigo-50 text-indigo-800 border-indigo-200' },
  behavioral: { label: 'Behavioral', symbol: '☺', tone: 'bg-sky-50 text-sky-800 border-sky-200' },
  hr: { label: 'HR', symbol: '✎', tone: 'bg-amber-50 text-amber-800 border-amber-200' },
} as const;

export type InterviewType = keyof typeof INTERVIEW_TYPES;
export type Difficulty = keyof typeof DIFFICULTIES;
export type QuestionType = keyof typeof QUESTION_TYPE_INFO;

export interface Evaluation {
  method: 'rule_based';
  rulesVersion: string;
  score: number;
  insufficientDetail: boolean;
  strengths: string[];
  missingPoints: string[];
  suggestions: string[];
  exampleAnswer: string | null;
  conceptsToReview: string[];
  coveredPoints: string[];
  wordCount: number;
}

export interface InterviewQuestion {
  id: string;
  position: number;
  type: QuestionType;
  focus: string;
  text: string;
  guidance: string;
  grounding: { source: 'resume_and_job' | 'job' | 'resume' | 'general'; skill?: string | null; resumeReference?: string | null };
  draftAnswer: string | null;
  draftSavedAt: string | null;
  submittedAnswer: string | null;
  submittedAt: string | null;
  evaluation: Evaluation | null;
  score: number | null;
  evaluatedAt: string | null;
}

export interface InterviewSession {
  id: string;
  title: string;
  resumeLabel: string;
  interviewType: InterviewType;
  difficulty: Difficulty;
  questionCount: number;
  status: 'in_progress' | 'completed';
  currentPosition: number;
  generatorVersion: string;
  notes: string[];
  resumeId: string | null;
  jobDescriptionId: string | null;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
}

export interface InterviewSummary {
  statistics: {
    totalQuestions: number;
    evaluated: number;
    draftOnly: number;
    unanswered: number;
    averageScore: number | null;
    highestScore: number | null;
    lowestScore: number | null;
    byType: Partial<Record<QuestionType, { questions: number; evaluated: number; averageScore: number | null }>>;
  };
  feedback: {
    strongestAreas: { focus: string; type: QuestionType; score: number }[];
    areasToImprove: { focus: string; type: QuestionType; score: number }[];
    frequentlyMissedConcepts: { concept: string; count: number }[];
    studyNext: string[];
  };
}

export interface InterviewDetails {
  session: InterviewSession;
  questions: InterviewQuestion[];
  summary: InterviewSummary;
  limits?: { maxAnswerChars: number };
}

export type InterviewListItem = InterviewSession & { evaluatedCount: number; averageScore: number | null };

const json = (method: string, body?: unknown): RequestInit => ({ method, headers: { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
const path = (id: string) => `/interviews/${encodeURIComponent(id)}`;

export const listInterviews = async (page = 1, limit = 20) =>
  (await apiClient(`/interviews?page=${page}&limit=${limit}`)).data as {
    items: InterviewListItem[];
    pagination: { page: number; limit: number; total: number; totalPages: number };
    limits: { maxQuestions: number; maxAnswerChars: number };
  };

export const createInterview = async (input: { resumeId: string; jobDescriptionId: string; interviewType: InterviewType; difficulty: Difficulty; questionCount: number }): Promise<InterviewDetails> =>
  (await apiClient('/interviews', json('POST', input))).data;

export const getInterview = async (id: string): Promise<InterviewDetails> => (await apiClient(path(id))).data;

export const saveDraft = async (id: string, questionId: string, answer: string) =>
  (await apiClient(`${path(id)}/questions/${encodeURIComponent(questionId)}/draft`, json('PUT', { answer }))).data as { savedAt: string };

export const submitAnswer = async (id: string, questionId: string, answer: string) =>
  (await apiClient(`${path(id)}/questions/${encodeURIComponent(questionId)}/submit`, json('POST', { answer }))).data as { evaluation: Evaluation; score: number };

export const getInterviewSummary = async (id: string) =>
  (await apiClient(`${path(id)}/summary`)).data as { summary: InterviewSummary; final: boolean };

export const savePosition = async (id: string, position: number) => apiClient(`${path(id)}/position`, json('PATCH', { position }));

export const completeInterview = async (id: string): Promise<InterviewDetails> => (await apiClient(`${path(id)}/complete`, json('POST'))).data;

export const deleteInterview = async (id: string) => apiClient(path(id), { method: 'DELETE' });
