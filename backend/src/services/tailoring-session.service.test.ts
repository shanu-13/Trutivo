import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';
import pool from '../config/database';
import * as resumeService from './resume.service';
import * as sessions from './tailoring-session.service';
import type { SuggestionDraft } from './resume-tailoring.service';

// Opt-in SQL tests (a database with migrations 001-009 applied):
//   DASHBOARD_DB_TESTS=1 DB_NAME=<test db> DB_PASSWORD=<pw> npm test
const dbTests = process.env.DASHBOARD_DB_TESTS === '1';
const skip = !dbTests && 'set DASHBOARD_DB_TESTS=1';
const createdUsers: string[] = [];
const UPLOADS = path.join(__dirname, '../../uploads/resumes');
const TEXT = 'JOHN DOE\nSKILLS\nGit, React, Node.js\n- Responsible for building APIs';

after(async () => {
  if (!dbTests) return;
  for (const id of createdUsers) {
    const [files]: any = await pool.execute('SELECT file_path as p FROM resumes WHERE user_id = ? AND source_type = ?', [id, 'tailored']);
    for (const f of files) await fs.promises.unlink(f.p).catch(() => {});
    await pool.execute('DELETE FROM users WHERE id = ?', [id]);
  }
  await pool.end();
});

const setup = async () => {
  const userId = uuidv4();
  createdUsers.push(userId);
  await pool.execute('INSERT INTO users (id, name, email, password_hash) VALUES (?, ?, ?, ?)', [userId, 'T', `${userId}@t.test`, 'x']);
  const resume = (await resumeService.createResume(userId, 'cv.pdf', `${uuidv4()}.pdf`, '/nonexistent/cv.pdf', 1, 'application/pdf'))!;
  await resumeService.updateExtractionStatus(resume.id, 'completed', TEXT, null);
  await resumeService.reconcileCurrentVersion(resume.id);
  const jobId = uuidv4();
  await pool.execute("INSERT INTO job_descriptions (id, user_id, title, description_text) VALUES (?, ?, 'Backend Developer', 'x')", [jobId, userId]);
  return { userId, resumeId: resume.id, jobId };
};

const drafts: SuggestionDraft[] = [
  { category: 'skills', section: 'skills', lineIndex: 2, originalText: 'Git, React, Node.js', suggestedText: 'Node.js, Git, React', entryLabel: null, reason: 'r', relatedRequirements: ['Node.js'] },
  { category: 'experience', section: 'experience', lineIndex: 3, originalText: '- Responsible for building APIs', suggestedText: '- Built APIs', entryLabel: 'Dev', reason: 'r', relatedRequirements: [] },
];
const result = { suggestions: drafts, requirements: [], notes: [] };

const textBuilder = (sessionId: string, resumeId: string, userId: string) => async () => {
  const s = (await sessions.getSession(sessionId, resumeId, userId))!;
  const lines = TEXT.split('\n');
  let applied = 0;
  for (const x of s.suggestions) {
    if (x.status === 'accepted' || x.status === 'edited') {
      lines[x.lineIndex] = x.editedText ?? x.suggestedText;
      applied++;
    }
  }
  return { text: lines.join('\n'), appliedCount: applied, jobTitle: s.jobTitle, sourceFilename: s.resumeFilename };
};

test('SQL: sessions only for the user\'s own resume and job description', { skip }, async () => {
  const a = await setup();
  const b = await setup();
  assert.equal(await sessions.createSession(a.userId, a.resumeId, b.jobId, result), null, "another user's job");
  assert.equal(await sessions.createSession(a.userId, b.resumeId, a.jobId, result), null, "another user's resume");
  const id = (await sessions.createSession(a.userId, a.resumeId, a.jobId, result))!;
  const s = (await sessions.getSession(id, a.resumeId, a.userId))!;
  assert.equal(s.suggestions.length, 2);
  assert.equal(s.suggestions[1].originalText, '- Responsible for building APIs');
  assert.ok(s.suggestions.every((x) => x.status === 'pending'));
  assert.equal(await sessions.getSession(id, a.resumeId, b.userId), null);
  assert.equal(await sessions.getSession(id, b.resumeId, b.userId), null);
  assert.deepEqual(await sessions.listSessions(a.resumeId, b.userId), []);
});

test('SQL: reviews are scoped to the session and its owner', { skip }, async () => {
  const a = await setup();
  const b = await setup();
  const sa = (await sessions.createSession(a.userId, a.resumeId, a.jobId, result))!;
  const sb = (await sessions.createSession(b.userId, b.resumeId, b.jobId, result))!;
  const suggestionA = (await sessions.getSession(sa, a.resumeId, a.userId))!.suggestions[0].id;
  assert.equal(await sessions.reviewSuggestion(sa, a.resumeId, suggestionA, b.userId, 'accepted', null), 'not_found');
  assert.equal(await sessions.reviewSuggestion(sb, b.resumeId, suggestionA, b.userId, 'accepted', null), 'not_found', 'suggestion of another session');
  const ok = await sessions.reviewSuggestion(sa, a.resumeId, suggestionA, a.userId, 'edited', 'Node.js, Git');
  assert.ok(typeof ok === 'object' && ok.suggestion.status === 'edited' && ok.suggestion.editedText === 'Node.js, Git');
  assert.equal(ok.suggestion.originalText, 'Git, React, Node.js', 'original kept');
});

test('SQL: save needs an accepted change, creates one non-current version, and is idempotent', { skip }, async () => {
  const a = await setup();
  const id = (await sessions.createSession(a.userId, a.resumeId, a.jobId, result))!;
  const build = textBuilder(id, a.resumeId, a.userId);
  assert.equal(await sessions.saveTailoredCopy(id, a.resumeId, a.userId, build), 'nothing_accepted');

  const s = (await sessions.getSession(id, a.resumeId, a.userId))!;
  await sessions.reviewSuggestion(id, a.resumeId, s.suggestions[1].id, a.userId, 'accepted', null);
  await sessions.reviewSuggestion(id, a.resumeId, s.suggestions[0].id, a.userId, 'rejected', null);

  const [first, second] = await Promise.all([
    sessions.saveTailoredCopy(id, a.resumeId, a.userId, build),
    sessions.saveTailoredCopy(id, a.resumeId, a.userId, build),
  ]);
  assert.ok(typeof first === 'object' && typeof second === 'object');
  assert.equal(first.resumeId, second.resumeId, 'one copy for concurrent saves');
  assert.deepEqual([first.created, second.created].sort(), [false, true]);
  const again = await sessions.saveTailoredCopy(id, a.resumeId, a.userId, build);
  assert.ok(typeof again === 'object' && !again.created && again.resumeId === first.resumeId);

  const copy = await resumeService.getResumeById(first.resumeId, a.userId);
  assert.equal(copy.sourceType, 'tailored');
  assert.equal(Number(copy.isCurrent), 0, 'not made current');
  assert.equal(Number(copy.versionNumber), 2);
  assert.equal(copy.resumeGroupId, (await resumeService.getResumeById(a.resumeId, a.userId)).resumeGroupId);
  assert.equal(copy.originalFilename, 'cv - tailored for Backend Developer.txt');
  const copyText = (await resumeService.getResumeTextById(first.resumeId, a.userId)).textContent;
  assert.equal(copyText, 'JOHN DOE\nSKILLS\nGit, React, Node.js\n- Built APIs', 'only the accepted change');
  assert.equal(fs.readFileSync(copy.filePath, 'utf8'), copyText);
  // The source resume is unchanged and still current.
  const source = await resumeService.getResumeTextById(a.resumeId, a.userId);
  assert.equal(source.textContent, TEXT);
  assert.equal(Number((await resumeService.getResumeById(a.resumeId, a.userId)).isCurrent), 1);
  // A saved session is read-only, and stays linked to its resume and job.
  assert.equal(await sessions.reviewSuggestion(id, a.resumeId, s.suggestions[0].id, a.userId, 'accepted', null), 'saved');
  const saved = (await sessions.getSession(id, a.resumeId, a.userId))!;
  assert.deepEqual([saved.status, saved.savedResumeId, saved.resumeId, saved.jobDescriptionId], ['saved', first.resumeId, a.resumeId, a.jobId]);
  // Another user cannot save it.
  const b = await setup();
  assert.equal(await sessions.saveTailoredCopy(id, a.resumeId, b.userId, build), 'not_found');
});

test('SQL: a tailored copy is never promoted automatically', { skip }, async () => {
  const a = await setup();
  const id = (await sessions.createSession(a.userId, a.resumeId, a.jobId, result))!;
  const s = (await sessions.getSession(id, a.resumeId, a.userId))!;
  await sessions.reviewSuggestion(id, a.resumeId, s.suggestions[1].id, a.userId, 'accepted', null);
  const saved = await sessions.saveTailoredCopy(id, a.resumeId, a.userId, textBuilder(id, a.resumeId, a.userId));
  assert.ok(typeof saved === 'object');
  // Deleting the current upload leaves no automatic current (the only other version is tailored).
  await resumeService.deleteResume(a.resumeId, a.userId);
  const [rows]: any = await pool.execute('SELECT is_current as c FROM resumes WHERE id = ?', [saved.resumeId]);
  assert.equal(Number(rows[0].c), 0);
  assert.equal(await resumeService.setCurrentVersion(saved.resumeId, a.userId), 'updated', 'the user can still choose it');
});

test('SQL: a failure while saving leaves no record and no file', { skip }, async () => {
  const a = await setup();
  const id = (await sessions.createSession(a.userId, a.resumeId, a.jobId, result))!;
  const s = (await sessions.getSession(id, a.resumeId, a.userId))!;
  await sessions.reviewSuggestion(id, a.resumeId, s.suggestions[1].id, a.userId, 'accepted', null);
  const filesBefore = new Set(fs.readdirSync(UPLOADS));
  await pool.query(`CREATE TRIGGER fail_tailored_insert BEFORE INSERT ON resumes FOR EACH ROW
    BEGIN IF NEW.source_type = 'tailored' THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'forced failure'; END IF; END`);
  try {
    await assert.rejects(sessions.saveTailoredCopy(id, a.resumeId, a.userId, textBuilder(id, a.resumeId, a.userId)));
  } finally {
    await pool.query('DROP TRIGGER IF EXISTS fail_tailored_insert');
  }
  assert.deepEqual(fs.readdirSync(UPLOADS).filter((f) => !filesBefore.has(f)), [], 'no orphaned file');
  const [copies]: any = await pool.execute("SELECT COUNT(*) as n FROM resumes WHERE user_id = ? AND source_type = 'tailored'", [a.userId]);
  assert.equal(Number(copies[0].n), 0);
  const after = (await sessions.getSession(id, a.resumeId, a.userId))!;
  assert.equal(after.status, 'draft');
  assert.equal(after.suggestions[1].status, 'accepted', 'decisions kept');
  const [group]: any = await pool.execute('SELECT latest_version_number as n FROM resume_groups WHERE id = (SELECT resume_group_id FROM resumes WHERE id = ?)', [a.resumeId]);
  assert.equal(Number(group[0].n), 1, 'version number not consumed');
  // Saving works once the problem is gone.
  const saved = await sessions.saveTailoredCopy(id, a.resumeId, a.userId, textBuilder(id, a.resumeId, a.userId));
  assert.ok(typeof saved === 'object' && saved.created);
});

test('SQL: deleting the source resume removes its sessions but keeps a saved copy', { skip }, async () => {
  const a = await setup();
  const id = (await sessions.createSession(a.userId, a.resumeId, a.jobId, result))!;
  const s = (await sessions.getSession(id, a.resumeId, a.userId))!;
  await sessions.reviewSuggestion(id, a.resumeId, s.suggestions[1].id, a.userId, 'accepted', null);
  const saved = await sessions.saveTailoredCopy(id, a.resumeId, a.userId, textBuilder(id, a.resumeId, a.userId));
  assert.ok(typeof saved === 'object');
  await resumeService.deleteResume(a.resumeId, a.userId);
  const [rows]: any = await pool.execute('SELECT COUNT(*) as n FROM resume_tailoring_sessions WHERE id = ?', [id]);
  assert.equal(Number(rows[0].n), 0);
  assert.ok(await resumeService.getResumeById(saved.resumeId, a.userId));
});
