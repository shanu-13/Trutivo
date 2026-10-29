import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import { v4 as uuidv4 } from 'uuid';
import pool from '../config/database';
import * as resumeService from './resume.service';
import * as sessions from './tailoring-session.service';
import { getApprovedContent, saveExportedVersion } from './resume-export.service';
import { buildResumeDocument } from './resume-document.service';
import { renderResumePdf } from './resume-pdf.service';
import { UPLOAD_DIR } from '../middleware/upload.middleware';
import type { SuggestionDraft } from './resume-tailoring.service';

// Opt-in SQL tests (a database with migrations 001-010 applied):
//   DASHBOARD_DB_TESTS=1 DB_NAME=<test db> DB_PASSWORD=<pw> npm test
const dbTests = process.env.DASHBOARD_DB_TESTS === '1';
const skip = !dbTests && 'set DASHBOARD_DB_TESTS=1';
const createdUsers: string[] = [];
const TEXT = ['JANE DOE', 'jane@example.com', 'SKILLS', 'Git, React, Node.js', 'EXPERIENCE', 'Developer', '- Responsible for building APIs', '- Successfully utilized tools', '- Worked on dashboards', '- Repeated line for testing'].join('\n');

after(async () => {
  if (!dbTests) return;
  for (const id of createdUsers) {
    const [files]: any = await pool.execute("SELECT file_path as p FROM resumes WHERE user_id = ? AND source_type <> 'upload'", [id]);
    for (const f of files) await fs.promises.unlink(f.p).catch(() => {});
    await pool.execute('DELETE FROM users WHERE id = ?', [id]);
  }
  await pool.end();
});

const setup = async () => {
  const userId = uuidv4();
  createdUsers.push(userId);
  await pool.execute('INSERT INTO users (id, name, email, password_hash) VALUES (?, ?, ?, ?)', [userId, 'T', `${userId}@x.test`, 'x']);
  const resume = (await resumeService.createResume(userId, 'Jane Doe CV.pdf', `${uuidv4()}.pdf`, '/nonexistent.pdf', 1, 'application/pdf'))!;
  await resumeService.updateExtractionStatus(resume.id, 'completed', TEXT, null);
  await resumeService.reconcileCurrentVersion(resume.id);
  const jobId = uuidv4();
  await pool.execute("INSERT INTO job_descriptions (id, user_id, title, description_text) VALUES (?, ?, 'Backend Developer', 'x')", [jobId, userId]);
  const line = (i: number) => TEXT.split('\n')[i];
  const drafts: SuggestionDraft[] = [
    { category: 'skills', section: 'skills', lineIndex: 3, originalText: line(3), suggestedText: 'Node.js, Git, React', entryLabel: null, reason: 'r', relatedRequirements: [] },
    { category: 'experience', section: 'experience', lineIndex: 6, originalText: line(6), suggestedText: '- Built APIs', entryLabel: null, reason: 'r', relatedRequirements: [] },
    { category: 'experience', section: 'experience', lineIndex: 7, originalText: line(7), suggestedText: '- Used tools', entryLabel: null, reason: 'r', relatedRequirements: [] },
    { category: 'structure', section: 'experience', lineIndex: 9, originalText: line(9), suggestedText: '', entryLabel: null, reason: 'r', relatedRequirements: [] },
  ];
  const sessionId = (await sessions.createSession(userId, resume.id, jobId, { suggestions: drafts, requirements: [], notes: [] }))!;
  const ids = (await sessions.getSession(sessionId, resume.id, userId))!.suggestions.map((s) => s.id);
  return { userId, resumeId: resume.id, sessionId, ids };
};

test('SQL: approved content has only accepted and edited changes', { skip }, async () => {
  const a = await setup();
  await sessions.reviewSuggestion(a.sessionId, a.resumeId, a.ids[0], a.userId, 'edited', 'Node.js, React, Git');
  await sessions.reviewSuggestion(a.sessionId, a.resumeId, a.ids[1], a.userId, 'accepted', null);
  await sessions.reviewSuggestion(a.sessionId, a.resumeId, a.ids[2], a.userId, 'rejected', null);
  // Pending, even with wording stored against it: not approved, so not exported.
  await pool.execute('UPDATE resume_tailoring_suggestions SET edited_text = ? WHERE id = ?', ['- Unapproved wording', a.ids[3]]);

  const content = await getApprovedContent(a.resumeId, a.userId, a.sessionId);
  assert.ok(typeof content === 'object');
  assert.equal(
    content.text,
    ['JANE DOE', 'jane@example.com', 'SKILLS', 'Node.js, React, Git', 'EXPERIENCE', 'Developer', '- Built APIs', '- Successfully utilized tools', '- Worked on dashboards', '- Repeated line for testing'].join('\n')
  );
  assert.ok(!content.text.includes('Unapproved') && !content.text.includes('- Used tools'));
  assert.equal(content.session?.jobTitle, 'Backend Developer');

  // Without a session: the version's own stored text.
  const plain = await getApprovedContent(a.resumeId, a.userId, null);
  assert.ok(typeof plain === 'object' && plain.text === TEXT && plain.session === null);

  // The PDF carries exactly this content.
  const pdf = await renderResumePdf(buildResumeDocument(content.text), 'classic', 'x');
  const { PDFParse } = require('pdf-parse');
  const parser = new PDFParse({ data: pdf });
  const out = (await parser.getText()).text as string;
  await parser.destroy();
  assert.ok(out.includes('Built APIs') && out.includes('Node.js, React, Git') && out.includes('Successfully utilized tools'));
  assert.ok(!out.includes('Used tools') && !out.includes('Unapproved') && !out.includes('Responsible for building'));
});

test('SQL: content is only available to the owner and for the matching resume', { skip }, async () => {
  const a = await setup();
  const b = await setup();
  assert.equal(await getApprovedContent(a.resumeId, b.userId, null), 'not_found');
  assert.equal(await getApprovedContent(a.resumeId, b.userId, a.sessionId), 'not_found');
  assert.equal(await getApprovedContent(b.resumeId, b.userId, a.sessionId), 'not_found', "another user's session");
  const other = (await resumeService.createResume(a.userId, 'other.pdf', `${uuidv4()}.pdf`, '/n.pdf', 1, 'application/pdf'))!;
  await resumeService.updateExtractionStatus(other.id, 'completed', 'X\nY', null);
  assert.equal(await getApprovedContent(other.id, a.userId, a.sessionId), 'not_found', 'session of a different resume');
  const pending = (await resumeService.createResume(a.userId, 'p.pdf', `${uuidv4()}.pdf`, '/p.pdf', 1, 'application/pdf'))!;
  assert.equal(await getApprovedContent(pending.id, a.userId, null), 'not_ready');
});

test('SQL: saving an export creates one non-current version per template and content', { skip }, async () => {
  const a = await setup();
  await sessions.reviewSuggestion(a.sessionId, a.resumeId, a.ids[1], a.userId, 'accepted', null);
  const content = await getApprovedContent(a.resumeId, a.userId, a.sessionId);
  assert.ok(typeof content === 'object');
  const pdf = await renderResumePdf(buildResumeDocument(content.text), 'modern', 'x');

  const [first, second] = await Promise.all([
    saveExportedVersion(a.userId, content, 'modern', pdf, 'Jane-Doe-CV-modern.pdf'),
    saveExportedVersion(a.userId, content, 'modern', pdf, 'Jane-Doe-CV-modern.pdf'),
  ]);
  assert.ok(typeof first === 'object' && typeof second === 'object');
  assert.equal(first.resumeId, second.resumeId, 'no duplicate for the same template and content');
  assert.deepEqual([first.created, second.created].sort(), [false, true]);

  const saved = await resumeService.getResumeById(first.resumeId, a.userId);
  assert.equal(saved.sourceType, 'exported');
  assert.equal(saved.exportTemplate, 'modern');
  assert.equal(saved.mimeType, 'application/pdf');
  assert.equal(Number(saved.isCurrent), 0);
  assert.equal(Number(saved.versionNumber), 2);
  assert.equal(saved.versionLabel, 'Exported PDF (Modern)');
  assert.ok(fs.readFileSync(saved.filePath).equals(pdf));
  assert.equal((await resumeService.getResumeTextById(first.resumeId, a.userId)).textContent, content.text);
  const [links]: any = await pool.execute('SELECT exported_from_resume_id as r, exported_from_session_id as s FROM resumes WHERE id = ?', [first.resumeId]);
  assert.deepEqual([links[0].r, links[0].s], [a.resumeId, a.sessionId]);
  // The source is unchanged and still current.
  assert.equal(Number((await resumeService.getResumeById(a.resumeId, a.userId)).isCurrent), 1);
  assert.equal((await resumeService.getResumeTextById(a.resumeId, a.userId)).textContent, TEXT);

  // Another template is another (explicitly saved) version.
  const classic = await saveExportedVersion(a.userId, content, 'classic', pdf, 'x.pdf');
  assert.ok(typeof classic === 'object' && classic.created && classic.resumeId !== first.resumeId);
  // Another user cannot save into this group.
  const b = await setup();
  assert.equal(await saveExportedVersion(b.userId, content, 'compact', pdf, 'x.pdf'), 'not_found');
});

test('SQL: a failure while saving leaves no file and no record', { skip }, async () => {
  const a = await setup();
  const content = await getApprovedContent(a.resumeId, a.userId, null);
  assert.ok(typeof content === 'object');
  const before = new Set(fs.readdirSync(UPLOAD_DIR));
  await pool.query(`CREATE TRIGGER fail_export_insert BEFORE INSERT ON resumes FOR EACH ROW
    BEGIN IF NEW.source_type = 'exported' THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'forced failure'; END IF; END`);
  try {
    await assert.rejects(saveExportedVersion(a.userId, content, 'classic', Buffer.from('%PDF-1.4'), 'x.pdf'));
  } finally {
    await pool.query('DROP TRIGGER IF EXISTS fail_export_insert');
  }
  assert.deepEqual(fs.readdirSync(UPLOAD_DIR).filter((f) => !before.has(f)), []);
  const [rows]: any = await pool.execute("SELECT COUNT(*) as n FROM resumes WHERE user_id = ? AND source_type = 'exported'", [a.userId]);
  assert.equal(Number(rows[0].n), 0);
  const [group]: any = await pool.execute('SELECT latest_version_number as n FROM resume_groups WHERE id = (SELECT resume_group_id FROM resumes WHERE id = ?)', [a.resumeId]);
  assert.equal(Number(group[0].n), 1);
});
