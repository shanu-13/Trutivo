import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { v4 as uuidv4 } from 'uuid';
import pool from '../config/database';
import * as resumeService from './resume.service';
import { getAtsChecks, saveAtsCheck } from './ats-check.service';
import { evaluateAtsReadiness } from './ats-readiness.service';

// Opt-in SQL tests (a database with migrations 001-011 applied):
//   DASHBOARD_DB_TESTS=1 DB_NAME=<test db> DB_PASSWORD=<pw> npm test
const dbTests = process.env.DASHBOARD_DB_TESTS === '1';
const skip = !dbTests && 'set DASHBOARD_DB_TESTS=1';
const createdUsers: string[] = [];
const TEXT = 'Jane Doe\njane@example.com\nSKILLS\nGo, SQL';

after(async () => {
  if (!dbTests) return;
  for (const id of createdUsers) await pool.execute('DELETE FROM users WHERE id = ?', [id]);
  await pool.end();
});

const setup = async () => {
  const userId = uuidv4();
  createdUsers.push(userId);
  await pool.execute('INSERT INTO users (id, name, email, password_hash) VALUES (?, ?, ?, ?)', [userId, 'T', `${userId}@a.test`, 'x']);
  const r = (await resumeService.createResume(userId, 'cv.pdf', `${uuidv4()}.pdf`, '/n.pdf', 1, 'application/pdf'))!;
  await resumeService.updateExtractionStatus(r.id, 'completed', TEXT, null);
  return { userId, resumeId: r.id };
};

test('SQL: results are stored per user and resume, latest first', { skip }, async () => {
  const a = await setup();
  const b = await setup();
  const result = evaluateAtsReadiness({ text: TEXT, structured: null });
  assert.equal(await saveAtsCheck(b.userId, a.resumeId, TEXT, result), null, "cannot store against another user's resume");
  const first = await saveAtsCheck(a.userId, a.resumeId, TEXT, result);
  const second = await saveAtsCheck(a.userId, a.resumeId, TEXT, result);
  const { latest, history } = await getAtsChecks(a.resumeId, a.userId, TEXT);
  assert.equal(latest?.id, second);
  assert.deepEqual(history.map((h: { id: string }) => h.id), [second, first]);
  assert.equal(latest?.stale, false);
  assert.deepEqual(latest?.result, result);
  const other = await getAtsChecks(a.resumeId, b.userId, TEXT);
  assert.equal(other.latest, null);
  assert.deepEqual(other.history, []);
});

test('SQL: a result becomes stale when the resume text changes', { skip }, async () => {
  const a = await setup();
  await saveAtsCheck(a.userId, a.resumeId, TEXT, evaluateAtsReadiness({ text: TEXT, structured: null }));
  // Re-extraction produced different text.
  await resumeService.updateExtractionStatus(a.resumeId, 'completed', TEXT + '\nEXPERIENCE\nDeveloper', null);
  const { latest } = await getAtsChecks(a.resumeId, a.userId, TEXT + '\nEXPERIENCE\nDeveloper');
  assert.equal(latest?.stale, true);
  // A different version of the resume has its own results.
  const v2 = (await resumeService.createResume(a.userId, 'cv2.pdf', `${uuidv4()}.pdf`, '/n.pdf', 1, 'application/pdf', { versionOf: a.resumeId }))!;
  assert.equal((await getAtsChecks(v2.id, a.userId, TEXT)).latest, null);
  // Deleting the version deletes its results.
  await resumeService.deleteResume(a.resumeId, a.userId);
  const [rows]: any = await pool.execute('SELECT COUNT(*) as n FROM resume_ats_checks WHERE resume_id = ?', [a.resumeId]);
  assert.equal(Number(rows[0].n), 0);
});
