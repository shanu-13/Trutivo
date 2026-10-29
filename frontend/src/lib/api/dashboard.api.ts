import { apiClient } from './client';
import type { MatchHistorySummary } from './matchHistory.api';

export interface DashboardSummary {
  totalAnalyses: number;
  scoredAnalyses: number;
  // null when no saved analysis has a valid score (never reported as 0).
  averageMatchScore: number | null;
  highestMatchScore: number | null;
  analysesAtOrAboveThreshold: number;
  scoreThreshold: number;
}

export interface ScoreBucket {
  label: string;
  min: number;
  max: number;
  count: number;
}

export interface DashboardAnalytics {
  summary: DashboardSummary;
  scoreDistribution: ScoreBucket[];
  latestAnalysis: MatchHistorySummary | null;
  recentActivity: MatchHistorySummary[];
  strongestMatches: MatchHistorySummary[];
}

export const getDashboardAnalytics = async (): Promise<DashboardAnalytics> => {
  const data = await apiClient('/dashboard/analytics');
  return data.data as DashboardAnalytics;
};
