import { apiClient } from './client';

export const MATCH_HISTORY_PAGE_SIZE = 10;

export interface MatchHistorySummary {
  id: string;
  resumeId: string;
  jobDescriptionId: string;
  resumeFilename: string;
  jobTitle: string;
  companyName: string | null;
  overallScore: number | null;
  createdAt: string;
}

export interface MatchHistoryPagination {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

export const getMatchHistory = async (page: number, limit = MATCH_HISTORY_PAGE_SIZE) => {
  return apiClient(`/match-history?page=${page}&limit=${limit}`);
};

export const getMatchHistoryItem = async (id: string) => {
  return apiClient(`/match-history/${encodeURIComponent(id)}`);
};

export const deleteMatchHistoryItem = async (id: string) => {
  return apiClient(`/match-history/${encodeURIComponent(id)}`, { method: 'DELETE' });
};
