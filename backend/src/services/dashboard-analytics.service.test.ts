import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { v4 as uuidv4 } from 'uuid';
import pool from '../config/database';
import {
  getDashboardAnalytics,
  isValidScore,
  toAnalytics,
  RECENT_ACTIVITY_LIMIT,
  SCORE_BUCKETS,
  SCORE_THRESHOLD,
} from './dashboard-analytics.service';

// --- Pure helpers (no database) ---

test('buckets cover 0-100 without gaps or overlaps', () => {
  assert.deepEqual(
    SCORE_BUCKETS.map((b) => b.label),
    ['0–39%', '40–59%', '60–79%', '80–100%']
  );
  assert.equal(SCORE_BUCKETS[0].min, 0);
  assert.equal(SCORE_BUCKETS[SCORE_BUCKETS.length - 1].max, 100);
  for (let i = 1; i < SCORE_BUCKETS.length; i++) {
    assert.equal(SCORE_BUCKETS[i].min, Math.round((SCORE_BUCKETS[i - 1].max + 0.01) * 100) / 100);
  }
});

test('only finite scores within 0-100 are valid', () => {
  for (const score of [0, 39.99, 80, 100]) assert.equal(isValidScore(score), true, String(score));
  for (const score of [null, -0.01, 100.01, 150, NaN, Infinity]) assert.equal(isValidScore(score), false, String(score));
});

test('an empty history gives zero counts, null scores and all four buckets', () => {
  const empty = toAnalytics({ totalAnalyses: 0, scoredAnalyses: 0, averageScore: null, highestScore: null, atOrAboveThreshold: 0 });
  assert.deepEqual(empty.summary, {
    totalAnalyses: 0,
    scoredAnalyses: 0,
    averageMatchScore: null,
    highestMatchScore: null,
    analysesAtOrAboveThreshold: 0,
    scoreThreshold: SCORE_THRESHOLD,
  });
  assert.deepEqual(
    empty.scoreDistribution.map((b) => b.count),
    [0, 0, 0, 0]
  );
});

test('aggregate values from MySQL (DECIMAL strings) become rounded numbers', () => {
  const { summary } = toAnalytics({ totalAnalyses: 3, scoredAnalyses: 2, averageScore: '78.456667', highestScore: '94.20', atOrAboveThreshold: 1 });
  assert.equal(summary.averageMatchScore, 78.46);
  assert.equal(summary.highestMatchScore, 94.2);
});

// --- SQL aggregation against a real MySQL database ---
// Opt-in: needs a database with migrations 001-007 applied, e.g.
//   DASHBOARD_DB_TESTS=1 DB_NAME=<test db> DB_PASSWORD=<pw> npm test
// The test creates its own users and removes them (and, by cascade, their rows).

const dbTests = process.env.DASHBOARD_DB_TESTS === '1';
const createdUsers: string[] = [];

after(async () => {
  if (!dbTests) return;
  for (const id of createdUsers) await pool.execute('DELETE FROM users WHERE id = ?', [id]);
  await pool.end();
});

const createUser = async () => {
  const userId = uuidv4();
  createdUsers.push(userId);
  await pool.execute('INSERT INTO users (id, name, email, password_hash) VALUES (?, ?, ?, ?)', [userId, 'Test', `${userId}@analytics.test`, 'x']);
  const resumeId = uuidv4();
  // Every resume belongs to a version group (migration 008).
  await pool.execute('INSERT INTO resume_groups (id, user_id) VALUES (?, ?)', [resumeId, userId]);
  await pool.execute(
    `INSERT INTO resumes (id, user_id, resume_group_id, version_number, original_filename, stored_filename, file_path, file_size, mime_type)
     VALUES (?, ?, ?, 1, 'cv.pdf', 's.pdf', 'uploads/s.pdf', 1, 'application/pdf')`,
    [resumeId, userId, resumeId]
  );
  const jobId = uuidv4();
  await pool.execute("INSERT INTO job_descriptions (id, user_id, title, description_text) VALUES (?, ?, 'Job', 'x')", [jobId, userId]);
  return { userId, resumeId, jobId };
};

// Inserts saved matches with explicit scores and timestamps (seconds after a fixed base).
const addMatches = async (
  owner: { userId: string; resumeId: string; jobId: string },
  rows: { score: number | null; at: number; title?: string; id?: string }[]
) => {
  for (const row of rows) {
    await pool.execute(
      `INSERT INTO resume_job_matches
         (id, user_id, resume_id, job_description_id, resume_filename_snapshot, job_title_snapshot, overall_score, result_json, created_at)
       VALUES (?, ?, ?, ?, 'cv.pdf', ?, ?, CAST('{}' AS JSON), TIMESTAMPADD(SECOND, ?, '2026-01-01 00:00:00'))`,
      [row.id ?? uuidv4(), owner.userId, owner.resumeId, owner.jobId, row.title ?? `score ${row.score}`, row.score, row.at]
    );
  }
};

test('SQL: summary, distribution, activity and strongest matches', { skip: !dbTests && 'set DASHBOARD_DB_TESTS=1' }, async () => {
  const alice = await createUser();
  const bob = await createUser();
  const boundaries = [0, 39.99, 40, 59.99, 60, 79.99, 80, 100];
  await addMatches(alice, [
    ...boundaries.map((score, i) => ({ score, at: i })),
    { score: null, at: 20 },
    { score: 150, at: 21 }, // invalid: above range
    { score: -5, at: 22 }, // invalid: below range
  ]);
  // Another user's high scores must not appear anywhere in Alice's analytics.
  await addMatches(bob, [{ score: 99.5, at: 30, title: 'bob' }, { score: 10, at: 31, title: 'bob' }]);

  const a = await getDashboardAnalytics(alice.userId);

  // Totals include the null and invalid records; score metrics exclude them.
  assert.equal(a.summary.totalAnalyses, 11);
  assert.equal(a.summary.scoredAnalyses, 8);
  const mean = boundaries.reduce((s, x) => s + x, 0) / boundaries.length;
  assert.equal(a.summary.averageMatchScore, Math.round(mean * 100) / 100);
  assert.equal(a.summary.highestMatchScore, 100);
  assert.equal(a.summary.analysesAtOrAboveThreshold, 2); // 80 and 100
  assert.equal(a.summary.scoreThreshold, SCORE_THRESHOLD);

  // Boundary scores land in exactly one bucket each.
  assert.deepEqual(
    a.scoreDistribution.map((b) => [b.label, b.count]),
    [['0–39%', 2], ['40–59%', 2], ['60–79%', 2], ['80–100%', 2]]
  );

  // Recent activity: newest first, five records, invalid score shown as unavailable.
  assert.equal(a.recentActivity.length, RECENT_ACTIVITY_LIMIT);
  assert.deepEqual(
    a.recentActivity.map((r) => r.overallScore),
    [null, null, null, 100, 80]
  );
  const times = a.recentActivity.map((r) => new Date(r.createdAt).getTime());
  assert.deepEqual(times, [...times].sort((x, y) => y - x));
  assert.equal(a.latestAnalysis?.id, a.recentActivity[0].id);
  for (const item of a.recentActivity) assert.ok(!('result' in item), 'no snapshot in activity');

  // Strongest: valid scores only, highest first.
  assert.deepEqual(
    a.strongestMatches.map((r) => r.overallScore),
    [100, 80, 79.99, 60, 59.99]
  );
  assert.ok([...a.recentActivity, ...a.strongestMatches].every((r) => r.jobTitle !== 'bob'));

  const b = await getDashboardAnalytics(bob.userId);
  assert.equal(b.summary.totalAnalyses, 2);
  assert.equal(b.summary.highestMatchScore, 99.5);
  assert.deepEqual(
    b.scoreDistribution.map((x) => x.count),
    [1, 0, 0, 1]
  );
});

test('SQL: ties in strongest matches use creation time, then id', { skip: !dbTests && 'set DASHBOARD_DB_TESTS=1' }, async () => {
  const user = await createUser();
  const suffix = uuidv4().slice(8);
  const ids = [`aaaaaaaa${suffix}`, `bbbbbbbb${suffix}`];
  await addMatches(user, [
    { score: 75, at: 1, title: 'older' },
    { score: 75, at: 5, id: ids[0], title: 'same time, lower id' },
    { score: 75, at: 5, id: ids[1], title: 'same time, higher id' },
  ]);
  for (let run = 0; run < 3; run++) {
    const { strongestMatches } = await getDashboardAnalytics(user.userId);
    assert.deepEqual(
      strongestMatches.map((r) => r.jobTitle),
      ['same time, higher id', 'same time, lower id', 'older']
    );
  }
});

test('SQL: history with no valid scores keeps the total and null score metrics', { skip: !dbTests && 'set DASHBOARD_DB_TESTS=1' }, async () => {
  const user = await createUser();
  await addMatches(user, [{ score: null, at: 1 }, { score: null, at: 2 }]);
  const a = await getDashboardAnalytics(user.userId);
  assert.equal(a.summary.totalAnalyses, 2);
  assert.equal(a.summary.scoredAnalyses, 0);
  assert.equal(a.summary.averageMatchScore, null);
  assert.equal(a.summary.highestMatchScore, null);
  assert.equal(a.summary.analysesAtOrAboveThreshold, 0);
  assert.deepEqual(a.strongestMatches, []);
  assert.equal(a.recentActivity.length, 2);

  const nobody = await createUser();
  const empty = await getDashboardAnalytics(nobody.userId);
  assert.equal(empty.summary.totalAnalyses, 0);
  assert.equal(empty.latestAnalysis, null);
  assert.deepEqual(empty.recentActivity, []);
  assert.deepEqual(empty.strongestMatches, []);
  assert.equal(empty.scoreDistribution.length, 4);
});
