import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { v4 as uuidv4 } from 'uuid';
import pool from '../config/database';
import { createJobDescription, getUserJobDescriptions, updateJobDescription } from './job-description.service';

// Opt-in SQL tests, like dashboard-analytics.service.test.ts:
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
  await pool.execute('INSERT INTO users (id, name, email, password_hash) VALUES (?, ?, ?, ?)', [id, 'Test', `${id}@jd.test`, 'x']);
  return id;
};

const storeRequirements = (jobDescriptionId: string) =>
  pool.execute(
    `INSERT INTO job_requirements (id, job_description_id, required_skills, preferred_skills, mentioned_skills,
       experience_requirements, education_requirements, responsibilities)
     VALUES (?, ?, '[]', '[]', '[]', '[]', '[]', '[]')`,
    [uuidv4(), jobDescriptionId]
  );

test('SQL: the list reports whether requirements are extracted, per user', { skip }, async () => {
  const alice = await createUser();
  const bob = await createUser();
  const input = { title: 'Backend Developer', companyName: null, descriptionText: 'Node.js' };
  const extracted = await createJobDescription(alice, input);
  const notExtracted = await createJobDescription(alice, { ...input, title: 'Other' });
  await createJobDescription(bob, { ...input, title: 'Bob job' });
  await storeRequirements(extracted);

  const rows = await getUserJobDescriptions(alice);
  assert.deepEqual(rows.map((r: any) => r.title).sort(), ['Backend Developer', 'Other']);
  const byId = Object.fromEntries(rows.map((r: any) => [r.id, r]));
  assert.ok(byId[extracted].requirementsExtractedAt instanceof Date);
  assert.equal(byId[notExtracted].requirementsExtractedAt, null);
  assert.deepEqual(Object.keys(byId[extracted]).sort(), ['companyName', 'createdAt', 'id', 'requirementsExtractedAt', 'title', 'updatedAt']);

  // Changing the text discards the old requirements, so the status goes back.
  await updateJobDescription(extracted, alice, { descriptionText: 'Python' });
  const after = await getUserJobDescriptions(alice);
  assert.equal(after.find((r: any) => r.id === extracted).requirementsExtractedAt, null);
});
