import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { v4 as uuidv4 } from 'uuid';
import pool from '../config/database';
import * as resumeService from './resume.service';
import * as coverLetters from './cover-letter.service';

// Opt-in SQL tests (a database with migrations 001-012 applied):
//   DASHBOARD_DB_TESTS=1 DB_NAME=<test db> DB_PASSWORD=<pw> npm test
const dbTests = process.env.DASHBOARD_DB_TESTS === '1';
const skip = !dbTests && 'set DASHBOARD_DB_TESTS=1';
const createdUsers: string[] = [];
after(async () => {
  if (!dbTests) return;
  for (const id of createdUsers) await pool.execute('DELETE FROM users WHERE id = ?', [id]);
  await pool.end();
});

const setup = async () => {
  const userId = uuidv4();
  createdUsers.push(userId);
  await pool.execute('INSERT INTO users (id, name, email, password_hash) VALUES (?, ?, ?, ?)', [userId, 'T', `${userId}@c.test`, 'x']);
  const resume = (await resumeService.createResume(userId, 'cv.pdf', `${uuidv4()}.pdf`, '/n.pdf', 1, 'application/pdf'))!;
  const jobId = uuidv4();
  await pool.execute("INSERT INTO job_descriptions (id, user_id, title, description_text) VALUES (?, ?, 'Backend Developer', 'x')", [jobId, userId]);
  return { userId, resumeId: resume.id, jobId };
};
const INPUT = { title: 'Backend Developer — Test Co', roleTitle: 'Backend Developer', companyName: 'Test Co', content: 'Dear Hiring Manager,\n\nText.', tone: 'professional' as const, length: 'standard' as const };

test('SQL: create, read, list, update and delete, owner only', { skip }, async () => {
  const a = await setup();
  const b = await setup();
  assert.equal(await coverLetters.createCoverLetter(a.userId, INPUT, b.resumeId, null), null, "another user's resume");
  assert.equal(await coverLetters.createCoverLetter(a.userId, INPUT, null, b.jobId), null, "another user's job");
  const id = (await coverLetters.createCoverLetter(a.userId, INPUT, a.resumeId, a.jobId))!;
  const saved = (await coverLetters.getCoverLetter(id, a.userId))!;
  assert.equal(saved.content, INPUT.content);
  assert.deepEqual([saved.resume?.id, saved.resume?.versionNumber, saved.jobDescription?.title], [a.resumeId, 1, 'Backend Developer']);
  assert.equal(await coverLetters.getCoverLetter(id, b.userId), null);
  assert.deepEqual(await coverLetters.listCoverLetters(b.userId), []);
  assert.equal((await coverLetters.listCoverLetters(a.userId)).length, 1);
  assert.ok(!('content' in (await coverLetters.listCoverLetters(a.userId))[0]), 'list has no content');

  assert.equal(await coverLetters.updateCoverLetter(id, b.userId, { content: 'hijack' }), false);
  assert.equal(await coverLetters.deleteCoverLetter(id, b.userId), false);
  assert.ok(await coverLetters.updateCoverLetter(id, a.userId, { content: 'Edited text', tone: 'concise' }));
  const edited = (await coverLetters.getCoverLetter(id, a.userId))!;
  assert.deepEqual([edited.content, edited.tone, edited.title], ['Edited text', 'concise', INPUT.title]);
  assert.ok(await coverLetters.deleteCoverLetter(id, a.userId));
  assert.equal(await coverLetters.getCoverLetter(id, a.userId), null);
  // A letter without sources is allowed.
  assert.ok(await coverLetters.createCoverLetter(a.userId, INPUT, null, null));
});

test('SQL: deleting the source resume or job keeps the letter', { skip }, async () => {
  const a = await setup();
  const id = (await coverLetters.createCoverLetter(a.userId, INPUT, a.resumeId, a.jobId))!;
  await resumeService.deleteResume(a.resumeId, a.userId);
  await pool.execute('DELETE FROM job_descriptions WHERE id = ?', [a.jobId]);
  const kept = (await coverLetters.getCoverLetter(id, a.userId))!;
  assert.deepEqual([kept.resume, kept.jobDescription, kept.companyName, kept.content], [null, null, 'Test Co', INPUT.content]);
});
