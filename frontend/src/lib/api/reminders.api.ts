import { apiClient } from './client';
import { todayLocal } from '@/lib/format';
import type { ApplicationStatus } from './applications.api';

// Reminders (Step 14). Shown in the app only; nothing is e-mailed or pushed.

export const REMINDER_TYPES = ['follow_up', 'interview', 'assessment', 'recruiter_contact', 'custom'] as const;
export type ReminderType = (typeof REMINDER_TYPES)[number];

// Each type has a symbol and text, so it is never shown by colour alone.
export const TYPE_INFO: Record<ReminderType, { label: string; symbol: string; tone: string }> = {
  follow_up: { label: 'Follow-up', symbol: '↻', tone: 'bg-blue-50 text-blue-800 border-blue-200' },
  interview: { label: 'Interview', symbol: '☏', tone: 'bg-purple-50 text-purple-800 border-purple-200' },
  assessment: { label: 'Assessment', symbol: '◇', tone: 'bg-indigo-50 text-indigo-800 border-indigo-200' },
  recruiter_contact: { label: 'Recruiter contact', symbol: '✆', tone: 'bg-sky-50 text-sky-800 border-sky-200' },
  custom: { label: 'Custom', symbol: '•', tone: 'bg-gray-50 text-gray-700 border-gray-200' },
};

// Must match the backend's limits.
export const LIMITS = { title: 200, notes: 2000 };

export type OutdatedReason = 'application_deleted' | 'application_closed' | 'interview_changed' | 'follow_up_changed';
export const OUTDATED_TEXT: Record<OutdatedReason, string> = {
  application_deleted: 'The linked application was deleted.',
  application_closed: 'The linked application is closed (offer, rejected or withdrawn).',
  interview_changed: 'The interview on the application was moved or removed after this reminder was created.',
  follow_up_changed: 'The follow-up date on the application was changed or removed after this reminder was created.',
};

export interface ReminderInput {
  type: ReminderType;
  title: string;
  notes: string | null;
  dueLocal: string; // "YYYY-MM-DDTHH:mm" in timeZone
  timeZone: string;
  applicationId: string | null;
}

export interface Reminder {
  id: string;
  type: ReminderType;
  title: string;
  notes: string | null;
  dueAt: string;
  timeZone: string;
  dueLocal: string;
  status: 'pending' | 'completed' | 'dismissed';
  overdue: boolean;
  completedAt: string | null;
  dismissedAt: string | null;
  source: 'manual' | 'application_interview' | 'application_follow_up';
  application: { id: string; jobTitle: string; companyName: string; status: ApplicationStatus } | null;
  applicationRemoved: boolean;
  mayBeOutdated: OutdatedReason | null;
  createdAt: string;
  updatedAt: string;
}

export type View = 'upcoming' | 'overdue' | 'pending' | 'completed' | 'dismissed' | 'all';

export interface ReminderSummary {
  counts: { overdue: number; dueWithin24Hours: number; upcomingThisWeek: number; pending: number; completed: number; dismissed: number; mayBeOutdated: number };
  overdue: Reminder[];
  upcoming: Reminder[];
  upcomingWindowDays: number;
}

export interface Suggestion {
  applicationId: string;
  jobTitle: string;
  companyName: string;
  kind: 'interview' | 'follow_up';
  eventAt: string; // interview: ISO time; follow-up: YYYY-MM-DD
  suggestedTitle: string;
}

const json = (method: string, body?: unknown): RequestInit => ({ method, headers: { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
const path = (id: string) => `/reminders/${encodeURIComponent(id)}`;

export const listReminders = async (q: { view: View; from?: string; to?: string; applicationId?: string; page?: number; limit?: number }) => {
  const params = new URLSearchParams({ view: q.view, page: String(q.page ?? 1), limit: String(q.limit ?? 20) });
  if (q.from) params.set('from', q.from);
  if (q.to) params.set('to', q.to);
  if (q.applicationId) params.set('applicationId', q.applicationId);
  return (await apiClient(`/reminders?${params}`)).data as { items: Reminder[]; pagination: { page: number; limit: number; total: number; totalPages: number } };
};

export const getReminderSummary = async (): Promise<ReminderSummary> => (await apiClient('/reminders/summary')).data;

export const getReminder = async (id: string): Promise<Reminder> => (await apiClient(path(id))).data.reminder;

export const createReminder = async (input: ReminderInput): Promise<Reminder> => (await apiClient('/reminders', json('POST', input))).data.reminder;

export const updateReminder = async (id: string, changes: Partial<ReminderInput>): Promise<Reminder> => (await apiClient(path(id), json('PUT', changes))).data.reminder;

export const completeReminder = async (id: string): Promise<Reminder> => (await apiClient(`${path(id)}/complete`, json('POST'))).data.reminder;
export const dismissReminder = async (id: string): Promise<Reminder> => (await apiClient(`${path(id)}/dismiss`, json('POST'))).data.reminder;
export const reopenReminder = async (id: string): Promise<Reminder> => (await apiClient(`${path(id)}/reopen`, json('POST'))).data.reminder;

export const deleteReminder = async (id: string) => apiClient(path(id), { method: 'DELETE' });

export const getSuggestions = async (applicationId?: string): Promise<{ suggestions: Suggestion[]; interviewLeadMinutes: number[] }> => {
  const params = new URLSearchParams({ today: todayLocal() });
  if (applicationId) params.set('applicationId', applicationId);
  return (await apiClient(`/reminders/suggestions?${params}`)).data;
};

export const acceptSuggestion = async (input: { applicationId: string; kind: Suggestion['kind']; timeZone: string; leadMinutes?: number; time?: string }) =>
  (await apiClient(`/reminders/suggestions/accept?today=${todayLocal()}`, json('POST', input))).data as { reminder: Reminder; created: boolean };
