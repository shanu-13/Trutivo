import { apiClient } from './client';
import { todayLocal } from '@/lib/format';

// Job application tracker (Step 13).

export const STATUSES = ['wishlist', 'preparing', 'applied', 'assessment', 'interview', 'offer', 'rejected', 'withdrawn'] as const;
export type ApplicationStatus = (typeof STATUSES)[number];

// Each status has a symbol and text, so it is never shown by colour alone.
export const STATUS_INFO: Record<ApplicationStatus, { label: string; symbol: string; tone: string; description: string }> = {
  wishlist: { label: 'Wishlist', symbol: '☆', tone: 'bg-gray-50 text-gray-700 border-gray-200', description: 'Interested, not started' },
  preparing: { label: 'Preparing', symbol: '✎', tone: 'bg-slate-50 text-slate-700 border-slate-200', description: 'Getting the application ready' },
  applied: { label: 'Applied', symbol: '→', tone: 'bg-blue-50 text-blue-800 border-blue-200', description: 'Application sent' },
  assessment: { label: 'Assessment', symbol: '◇', tone: 'bg-indigo-50 text-indigo-800 border-indigo-200', description: 'Test or assignment' },
  interview: { label: 'Interview', symbol: '☏', tone: 'bg-purple-50 text-purple-800 border-purple-200', description: 'Interviewing' },
  offer: { label: 'Offer', symbol: '★', tone: 'bg-green-50 text-green-800 border-green-200', description: 'Offer received' },
  rejected: { label: 'Rejected', symbol: '✕', tone: 'bg-red-50 text-red-700 border-red-200', description: 'Not successful' },
  withdrawn: { label: 'Withdrawn', symbol: '↩', tone: 'bg-amber-50 text-amber-800 border-amber-200', description: 'You withdrew' },
};

export const EMPLOYMENT_TYPES = { full_time: 'Full-time', part_time: 'Part-time', contract: 'Contract', internship: 'Internship', temporary: 'Temporary', freelance: 'Freelance', other: 'Other' } as const;
export const INTERVIEW_TYPES = { phone: 'Phone', video: 'Video', in_person: 'In person', other: 'Other' } as const;
export type EmploymentType = keyof typeof EMPLOYMENT_TYPES;
export type InterviewType = keyof typeof INTERVIEW_TYPES;

// Must match the backend's limits.
export const LIMITS = { title: 200, company: 200, url: 2048, location: 200, compensation: 500, contactName: 200, contactEmail: 254, contactPhone: 50, notes: 5000, interviewStage: 100, interviewer: 200, interviewNotes: 5000, followUpNotes: 1000 };

export interface ApplicationInput {
  jobTitle: string;
  companyName: string;
  postingUrl: string | null;
  status: ApplicationStatus;
  appliedOn: string | null;
  location: string | null;
  employmentType: EmploymentType | null;
  compensationNotes: string | null;
  contactName: string | null;
  contactEmail: string | null;
  contactPhone: string | null;
  notes: string | null;
  interviewAt: string | null;
  interviewType: InterviewType | null;
  interviewStage: string | null;
  interviewerName: string | null;
  interviewNotes: string | null;
  followUpOn: string | null;
  followUpNotes: string | null;
  jobDescriptionId: string | null;
  resumeId: string | null;
  coverLetterId: string | null;
}

export interface Application extends ApplicationInput {
  id: string;
  createdAt: string;
  updatedAt: string;
  links: {
    jobDescription: { id: string; title: string } | null;
    resume: { id: string; filename: string; versionNumber: number } | null;
    coverLetter: { id: string; title: string } | null;
  };
  nextAction: { type: 'interview' | 'follow_up'; at: string } | null;
  followUpDue: boolean;
}

export interface HistoryEvent {
  id: string;
  type: 'created' | 'status_changed' | 'interview_scheduled' | 'interview_updated' | 'interview_cleared' | 'follow_up_set' | 'follow_up_cleared' | 'details_updated';
  fromStatus: ApplicationStatus | null;
  toStatus: ApplicationStatus | null;
  details: { interviewAt?: string | null; interviewType?: InterviewType | null; interviewStage?: string | null; followUpOn?: string | null; fields?: string[] } | null;
  createdAt: string;
}

export interface ApplicationMetrics {
  asOf: string;
  total: number;
  submitted: number;
  upcomingInterviews: number;
  offers: number;
  rejections: number;
  followUpsDue: number;
  byStatus: Record<ApplicationStatus, number>;
}

export type SortKey = 'updated' | 'applied' | 'company' | 'upcoming';
export interface ListFilters {
  status: ApplicationStatus | '';
  company: string;
  title: string;
  appliedFrom: string;
  appliedTo: string;
  sort: SortKey;
}

const json = (method: string, body: unknown): RequestInit => ({ method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
// The viewer's own date decides which follow-ups are due today.
const today = () => `today=${todayLocal()}`;

export const listApplications = async (filters: ListFilters, page: number, limit: number) => {
  const params = new URLSearchParams({ sort: filters.sort, page: String(page), limit: String(limit), today: todayLocal() });
  for (const key of ['status', 'company', 'title', 'appliedFrom', 'appliedTo'] as const) if (filters[key].trim()) params.set(key, filters[key].trim());
  const data = await apiClient(`/applications?${params}`);
  return data.data as { items: Application[]; pagination: { page: number; limit: number; total: number; totalPages: number } };
};

export const getApplicationMetrics = async (): Promise<{ metrics: ApplicationMetrics; definitions: Record<string, string> }> =>
  (await apiClient(`/applications/metrics?${today()}`)).data;

export const getApplication = async (id: string): Promise<{ application: Application; history: HistoryEvent[] }> =>
  (await apiClient(`/applications/${encodeURIComponent(id)}?${today()}`)).data;

export const createApplication = async (input: ApplicationInput): Promise<Application> =>
  (await apiClient(`/applications?${today()}`, json('POST', input))).data.application;

export const updateApplication = async (id: string, changes: Partial<ApplicationInput>): Promise<Application> =>
  (await apiClient(`/applications/${encodeURIComponent(id)}?${today()}`, json('PUT', changes))).data.application;

export const deleteApplication = async (id: string) => apiClient(`/applications/${encodeURIComponent(id)}`, { method: 'DELETE' });

// Application insights (Step 14).
export type Recommendation =
  | { kind: 'no_applications'; tone: 'info' }
  | { kind: 'overdue_reminders'; tone: 'attention'; count: number }
  | { kind: 'follow_ups_due'; tone: 'attention'; count: number }
  | { kind: 'interview_soon'; tone: 'info'; application: { id: string; jobTitle: string; companyName: string }; interviewAt: string }
  | { kind: 'busy_day'; tone: 'info'; date: string; count: number }
  | { kind: 'no_next_step'; tone: 'info'; count: number; applications: { id: string; jobTitle: string; companyName: string }[] }
  | { kind: 'outdated_reminders'; tone: 'info'; count: number }
  | { kind: 'inactive'; tone: 'info'; days: number };

export interface Insights {
  asOf: string;
  applications: {
    total: number;
    submitted: number;
    inInterviewStages: number;
    offers: number;
    rejections: number;
    upcomingInterviews: number;
    followUpsDue: number;
    followUpsScheduled: number;
    byStatus: Record<ApplicationStatus, number>;
  };
  upcomingInterviews: { id: string; jobTitle: string; companyName: string; status: ApplicationStatus; interviewType: InterviewType | null; interviewAt: string }[];
  reminders: { pending: number; overdue: number; upcomingThisWeek: number; completed: number; dismissed: number; completionRate: number | null };
  monthly: { month: string; applied: number; added: number }[];
  funnel: { minimumSample: number; enoughData: boolean; stages: { key: 'submitted' | 'interview' | 'offer'; count: number; rate: number | null }[] };
  recommendations: Recommendation[];
}

export const getInsights = async (months: number): Promise<{ insights: Insights; definitions: Record<string, string> }> =>
  (await apiClient(`/applications/insights?months=${months}&${today()}`)).data;
