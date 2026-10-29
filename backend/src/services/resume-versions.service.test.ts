import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { v4 as uuidv4 } from 'uuid';
import pool from '../config/database';
import * as resumeService from './resume.service';

// Opt-in SQL tests (a database with migrations 001-008 applied):
//   DASHBOARD_DB_TESTS=1 DB_NAME=<test db> DB_PASSWORD=<pw> npm test
const dbTests = process.env.DASHBOARD_DB_TESTS === '1';
const skip = !dbTests && 'set DASHBOARD_DB_TESTS=1';
const createdUsers: string[] = [];

after(async () => {
  if (!dbTests) return;
  for (const id of createdUsers) await pool.execute('DELETE FROM users WHERE id = ?', [id]);
  await pool.end();
});

const createUser = async () => {
  const id = uuidv4();
  createdUsers.push(id);
  await pool.execute('INSERT INTO users (id, name, email, password_hash) VALUES (?, ?, ?, ?)', [id, 'T', `${id}@v.test`, 'x']);
  return id;
};
const upload = (userId: string, name: string, versionOf?: string) =>
  resumeService.createResume(userId, name, `${uuidv4()}.pdf`, `/tmp/${uuidv4()}.pdf`, 1, 'application/pdf', { versionOf });
const finish = async (id: string, status: 'completed' | 'failed' | 'no_text') => {
  await resumeService.updateExtractionStatus(id, status, status === 'completed' ? 'text' : null, status === 'completed' ? null : 'error');
  await resumeService.reconcileCurrentVersion(id);
};
const current = async (groupId: string) => {
  const [rows]: any = await pool.execute('SELECT id FROM resumes WHERE resume_group_id = ? AND is_current = 1', [groupId]);
  return rows.map((r: any) => r.id);
};

test('SQL: versions get increasing numbers and the newest extracted one is current', { skip }, async () => {
  const user = await createUser();
  const v1 = (await upload(user, 'cv.pdf'))!;
  assert.equal(v1.versionNumber, 1);
  assert.deepEqual(await current(v1.resumeGroupId), [], 'not current before extraction');
  await finish(v1.id, 'completed');
  assert.deepEqual(await current(v1.resumeGroupId), [v1.id]);

  const v2 = (await upload(user, 'cv-v2.pdf', v1.id))!;
  assert.equal(v2.resumeGroupId, v1.resumeGroupId);
  assert.equal(v2.versionNumber, 2);
  assert.deepEqual(await current(v1.resumeGroupId), [v1.id], 'pending version is not current');
  await finish(v2.id, 'failed');
  assert.deepEqual(await current(v1.resumeGroupId), [v1.id], 'failed version is not promoted');
  const versions = await resumeService.getResumeVersions(v2.id, user);
  assert.deepEqual(versions!.map((v: any) => [v.versionNumber, v.extractionStatus]), [[2, 'failed'], [1, 'completed']]);

  const v3 = (await upload(user, 'cv-v3.pdf', v2.id))!;
  await finish(v3.id, 'completed');
  assert.deepEqual(await current(v1.resumeGroupId), [v3.id]);
  // Re-extracting an older version does not take over.
  await finish(v1.id, 'completed');
  assert.deepEqual(await current(v1.resumeGroupId), [v3.id]);
});

test('SQL: an unrelated upload starts its own group', { skip }, async () => {
  const user = await createUser();
  const a = (await upload(user, 'a.pdf'))!;
  const b = (await upload(user, 'b.pdf'))!;
  assert.notEqual(a.resumeGroupId, b.resumeGroupId);
});

test('SQL: concurrent uploads get distinct version numbers', { skip }, async () => {
  const user = await createUser();
  const v1 = (await upload(user, 'cv.pdf'))!;
  const results = await Promise.all(Array.from({ length: 8 }, (_, i) => upload(user, `cv-${i}.pdf`, v1.id)));
  const numbers = results.map((r) => r!.versionNumber).sort((x, y) => x - y);
  assert.deepEqual(numbers, [2, 3, 4, 5, 6, 7, 8, 9]);
});

test('SQL: another user cannot add a version, see versions or make one current', { skip }, async () => {
  const owner = await createUser();
  const other = await createUser();
  const v1 = (await upload(owner, 'cv.pdf'))!;
  await finish(v1.id, 'completed');
  assert.equal(await upload(other, 'x.pdf', v1.id), null);
  assert.equal(await resumeService.getResumeVersions(v1.id, other), null);
  assert.equal(await resumeService.setCurrentVersion(v1.id, other), 'not_found');
  assert.equal(await resumeService.deleteResume(v1.id, other), null);
  const [rows]: any = await pool.execute('SELECT COUNT(*) as n FROM resumes WHERE resume_group_id = ?', [v1.resumeGroupId]);
  assert.equal(Number(rows[0].n), 1);
});

test('SQL: explicit current selection, only for extracted versions', { skip }, async () => {
  const user = await createUser();
  const v1 = (await upload(user, 'cv.pdf'))!;
  await finish(v1.id, 'completed');
  const v2 = (await upload(user, 'cv2.pdf', v1.id))!;
  await finish(v2.id, 'completed');
  const v3 = (await upload(user, 'cv3.pdf', v1.id))!;
  await finish(v3.id, 'no_text');
  assert.equal(await resumeService.setCurrentVersion(v3.id, user), 'not_ready');
  assert.equal(await resumeService.setCurrentVersion(v1.id, user), 'updated');
  assert.deepEqual(await current(v1.resumeGroupId), [v1.id]);
  // The database refuses a second current version even if the application tried.
  await assert.rejects(pool.execute('UPDATE resumes SET is_current = 1 WHERE id = ?', [v2.id]), /Duplicate entry/);
  // A duplicate version number is refused as well.
  await assert.rejects(pool.execute('UPDATE resumes SET version_number = 1 WHERE id = ?', [v2.id]), /Duplicate entry/);
});

test('SQL: deleting a version keeps the others and promotes the newest extracted one', { skip }, async () => {
  const user = await createUser();
  const v1 = (await upload(user, 'cv.pdf'))!;
  await finish(v1.id, 'completed');
  const v2 = (await upload(user, 'cv2.pdf', v1.id))!;
  await finish(v2.id, 'completed');
  const v3 = (await upload(user, 'cv3.pdf', v1.id))!;
  await finish(v3.id, 'failed');
  const jd = uuidv4();
  await pool.execute("INSERT INTO job_descriptions (id, user_id, title, description_text) VALUES (?, ?, 'J', 'x')", [jd, user]);
  for (const v of [v1, v2]) {
    await pool.execute(
      `INSERT INTO resume_job_matches (id, user_id, resume_id, job_description_id, resume_filename_snapshot, job_title_snapshot, overall_score, result_json)
       VALUES (?, ?, ?, ?, 'cv.pdf', 'J', 50, '{}')`,
      [uuidv4(), user, v.id, jd]
    );
  }

  const deleted = await resumeService.deleteResume(v2.id, user);
  assert.ok(deleted?.filePath);
  const versions = (await resumeService.getResumeVersions(v1.id, user))!;
  assert.deepEqual(versions.map((v: any) => v.versionNumber), [3, 1]);
  assert.deepEqual(await current(v1.resumeGroupId), [v1.id], 'newest extracted remaining version (not the failed v3)');
  const [matches]: any = await pool.execute('SELECT resume_id as r FROM resume_job_matches WHERE user_id = ?', [user]);
  assert.deepEqual(matches.map((m: any) => m.r), [v1.id], "only the deleted version's saved match is gone");

  // Numbers are never reused after a deletion.
  assert.equal((await upload(user, 'cv4.pdf', v1.id))!.versionNumber, 4);

  for (const v of await resumeService.getResumeVersions(v1.id, user) ?? []) await resumeService.deleteResume(v.id, user);
  const [groups]: any = await pool.execute('SELECT COUNT(*) as n FROM resume_groups WHERE id = ?', [v1.resumeGroupId]);
  assert.equal(Number(groups[0].n), 0, 'empty group removed');
});
