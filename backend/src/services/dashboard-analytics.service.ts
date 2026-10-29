import pool from '../config/database';
import { SUMMARY_COLUMNS, toNumber, toSummary, type MatchHistorySummary } from './match-history.service';

// Dashboard analytics (Step 8B): descriptive summaries of the signed-in user's
// saved match history. Nothing is recalculated: every score metric uses the
// stored Step 6B score (resume_job_matches.overall_score), and semantic
// similarity is not part of any of them. Every query is scoped to one user.

// "Analyses scoring N% or higher".
export const SCORE_THRESHOLD = 80;
export const RECENT_ACTIVITY_LIMIT = 5;
export const STRONGEST_MATCHES_LIMIT = 5;

// A score counts only within 0-100; NULL and out-of-range values are excluded
// from every score metric but still counted in totalAnalyses.
export const MIN_SCORE = 0;
export const MAX_SCORE = 100;

// Each bucket holds min <= score < next bucket's min; the last one includes MAX_SCORE.
// `max` is the highest value a bucket can hold at the column's two decimals.
export const SCORE_BUCKETS = [
  { label: '0–39%', min: 0, max: 39.99 },
  { label: '40–59%', min: 40, max: 59.99 },
  { label: '60–79%', min: 60, max: 79.99 },
  { label: '80–100%', min: 80, max: 100 },
] as const;

export const isValidScore = (score: number | null): score is number =>
  score !== null && Number.isFinite(score) && score >= MIN_SCORE && score <= MAX_SCORE;

const VALID_SCORE_SQL = `overall_score IS NOT NULL AND overall_score >= ${MIN_SCORE} AND overall_score <= ${MAX_SCORE}`;

// Upper bound of bucket i, as a condition with one placeholder.
const bucketUpperSql = (index: number) => (index === SCORE_BUCKETS.length - 1 ? 'overall_score <= ?' : 'overall_score < ?');
const bucketUpper = (index: number) => (index === SCORE_BUCKETS.length - 1 ? MAX_SCORE : SCORE_BUCKETS[index + 1].min);

const SUMMARY_SQL = `SELECT
    COUNT(*) AS totalAnalyses,
    COUNT(CASE WHEN ${VALID_SCORE_SQL} THEN 1 END) AS scoredAnalyses,
    AVG(CASE WHEN ${VALID_SCORE_SQL} THEN overall_score END) AS averageScore,
    MAX(CASE WHEN ${VALID_SCORE_SQL} THEN overall_score END) AS highestScore,
    COUNT(CASE WHEN ${VALID_SCORE_SQL} AND overall_score >= ? THEN 1 END) AS atOrAboveThreshold,
    ${SCORE_BUCKETS.map(
      (_, i) => `COUNT(CASE WHEN ${VALID_SCORE_SQL} AND overall_score >= ? AND ${bucketUpperSql(i)} THEN 1 END) AS bucket${i}`
    ).join(',\n    ')}
  FROM resume_job_matches
  WHERE user_id = ?`;

const summaryParams = (userId: string) => [
  SCORE_THRESHOLD,
  ...SCORE_BUCKETS.flatMap((bucket, i) => [bucket.min, bucketUpper(i)]),
  userId,
];

const roundScore = (value: number | null) => (value === null ? null : Math.round(value * 100) / 100);

// Turns the aggregate row into the API shape. Missing scores stay null, never 0.
export const toAnalytics = (row: Record<string, unknown>) => ({
  summary: {
    totalAnalyses: Number(row.totalAnalyses ?? 0),
    scoredAnalyses: Number(row.scoredAnalyses ?? 0),
    averageMatchScore: roundScore(toNumber(row.averageScore)),
    highestMatchScore: roundScore(toNumber(row.highestScore)),
    analysesAtOrAboveThreshold: Number(row.atOrAboveThreshold ?? 0),
    scoreThreshold: SCORE_THRESHOLD,
  },
  scoreDistribution: SCORE_BUCKETS.map((bucket, i) => ({ ...bucket, count: Number(row[`bucket${i}`] ?? 0) })),
});

// History summaries (no snapshots), with an out-of-range score reported as unavailable.
const toActivityItem = (row: unknown): MatchHistorySummary => {
  const item = toSummary(row);
  return { ...item, overallScore: isValidScore(item.overallScore) ? item.overallScore : null };
};

export type DashboardAnalytics = ReturnType<typeof toAnalytics> & {
  latestAnalysis: MatchHistorySummary | null;
  recentActivity: MatchHistorySummary[];
  strongestMatches: MatchHistorySummary[];
};

export const getDashboardAnalytics = async (userId: string): Promise<DashboardAnalytics> => {
  const [[summaryRows], [recentRows], [strongestRows]]: any = await Promise.all([
    pool.execute(SUMMARY_SQL, summaryParams(userId)),
    // query() rather than execute(): see listMatchHistory (LIMIT placeholders).
    pool.query(
      `SELECT ${SUMMARY_COLUMNS} FROM resume_job_matches
        WHERE user_id = ?
        ORDER BY created_at DESC, id DESC
        LIMIT ?`,
      [userId, RECENT_ACTIVITY_LIMIT]
    ),
    // Equal scores: newer first, then id, so the order is stable.
    pool.query(
      `SELECT ${SUMMARY_COLUMNS} FROM resume_job_matches
        WHERE user_id = ? AND ${VALID_SCORE_SQL}
        ORDER BY overall_score DESC, created_at DESC, id DESC
        LIMIT ?`,
      [userId, STRONGEST_MATCHES_LIMIT]
    ),
  ]);
  const recentActivity = recentRows.map(toActivityItem);
  return {
    ...toAnalytics(summaryRows[0] ?? {}),
    latestAnalysis: recentActivity[0] ?? null,
    recentActivity,
    strongestMatches: strongestRows.map(toActivityItem),
  };
};
