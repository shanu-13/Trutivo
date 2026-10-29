import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import http from 'http';
import { AddressInfo } from 'net';
import { v4 as uuidv4 } from 'uuid';
import pool from '../config/database';
import { AiServiceError, evaluateInterviewAnswer, generateInterviewQuestions, type InterviewEvaluation, type InterviewQuestion } from './ai.service';
import * as interviews from './interview.service';
import { computeSummary } from './interview.service';
import { createSchema, draftSchema, positionSchema, submitSchema, MAX_ANSWER_CHARS, MAX_QUESTIONS } from '../controllers/interview.controller';

// ---------- fixtures ----------

const question = (over: Partial<InterviewQuestion> = {}): InterviewQuestion => ({
  type: 'technical',
  text: 'In Node.js, explain the following: event loop and non-blocking I/O; modules and packages.',
  focus: 'Node.js',
  difficulty: 'intermediate',
  expectedPoints: [{ label: 'event loop and non-blocking I/O', keywords: ['event loop'] }],
  grounding: { source: 'resume_and_job', skill: 'Node.js', resumeReference: null },
  guidance: '',
  ...over,
});
const evaluation = (score: number, concepts: string[] = []): InterviewEvaluation => ({
  method: 'rule_based',
  rulesVersion: '1.0',
  score,
  insufficientDetail: score < 20,
  strengths: [],
  missingPoints: [],
  suggestions: [],
  exampleAnswer: null,
  conceptsToReview: concepts,
  coveredPoints: [],
  wordCount: 50,
});

// ---------- AI client: validation, failures and retry ----------

type Handler = (req: http.IncomingMessage, body: string, res: http.ServerResponse) => void;
let handler: Handler;
let server: http.Server;
let calls = 0;
const send = (res: http.ServerResponse, status: number, body: unknown) => {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body));
};
before(async () => {
  server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      calls++;
      handler(req, body, res);
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
});
beforeEach(() => {
  process.env.AI_SERVICE_URL = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  delete process.env.AI_SERVICE_TIMEOUT_MS;
  calls = 0;
});
const facts = { candidate: { name: null, skills: [], experience: [], projects: [], education: [], certifications: [] }, job: { title: 'Dev', companyName: null, requiredSkills: [], preferredSkills: [] } };
const settings = { interviewType: 'technical' as const, difficulty: 'beginner' as const, count: 2 };
const isAiError = (status: number, code: string) => (err: unknown) => err instanceof AiServiceError && err.statusCode === status && err.code === code;

test('AI client: valid questions and evaluations are returned', async () => {
  handler = (req, body, res) =>
    req.url === '/api/interview/questions'
      ? send(res, 200, { success: true, data: { questionSet: { method: 'rule_based', generatorVersion: '1.0', questions: [question()], notes: [] } } })
      : send(res, 200, { success: true, data: { evaluation: evaluation(70) } });
  const set = await generateInterviewQuestions(facts as any, settings);
  assert.equal(set.questions.length, 1);
  assert.equal((await evaluateInterviewAnswer(question(), 'answer')).score, 70);
});

test('AI client: malformed responses are rejected, never saved as results', async () => {
  const bad = [
    { questionSet: { method: 'rule_based', generatorVersion: '1.0', questions: [], notes: [] } },
    { questionSet: { method: 'llm', generatorVersion: '1.0', questions: [question()], notes: [] } },
    { questionSet: { method: 'rule_based', generatorVersion: '1.0', questions: [question(), question(), question()], notes: [] } }, // more than asked for
  ];
  for (const data of bad) {
    handler = (_req, _b, res) => send(res, 200, { success: true, data });
    await assert.rejects(generateInterviewQuestions(facts as any, settings), isAiError(502, 'AI_SERVICE_ERROR'));
  }
  for (const ev of [{ ...evaluation(70), score: 101 }, { ...evaluation(70), score: -1 }, { ...evaluation(70), score: 7.5 }, { ...evaluation(70), strengths: 'good' }, null]) {
    handler = (_req, _b, res) => send(res, 200, { success: true, data: { evaluation: ev } });
    await assert.rejects(evaluateInterviewAnswer(question(), 'a'), isAiError(502, 'AI_SERVICE_ERROR'));
  }
});

test('AI client: service errors and timeouts are reported, not hidden', async () => {
  handler = (_req, _b, res) => send(res, 500, { success: false, message: 'x', error: { code: 'INTERVIEW_EVALUATION_FAILED' } });
  await assert.rejects(evaluateInterviewAnswer(question(), 'a'), isAiError(502, 'AI_SERVICE_ERROR'));
  assert.equal(calls, 1, 'errors are not retried');
  process.env.AI_SERVICE_TIMEOUT_MS = '100';
  handler = (_req, _b, res) => setTimeout(() => send(res, 200, { success: true, data: { evaluation: evaluation(50) } }), 400);
  await assert.rejects(evaluateInterviewAnswer(question(), 'a'), isAiError(504, 'AI_SERVICE_TIMEOUT'));
});

test('AI client: an unreachable service is retried once, then reported', async () => {
  process.env.AI_SERVICE_URL = 'http://127.0.0.1:9'; // nothing listens on the discard port
  const started = Date.now();
  await assert.rejects(evaluateInterviewAnswer(question(), 'a'), isAiError(503, 'AI_SERVICE_UNAVAILABLE'));
  assert.ok(Date.now() - started >= 300, 'waited before retrying');
});

after(() => {
  server.closeAllConnections();
  server.close();
});

// ---------- request validation ----------

test('create: ids, types, difficulty and question count are validated', () => {
  const ok = { resumeId: uuidv4(), jobDescriptionId: uuidv4(), interviewType: 'mixed', difficulty: 'advanced', questionCount: 5 };
  assert.equal(createSchema.safeParse(ok).success, true);
  for (const bad of [
    { ...ok, resumeId: 'x' },
    { ...ok, interviewType: 'panel' },
    { ...ok, difficulty: 'expert' },
    { ...ok, questionCount: 0 },
    { ...ok, questionCount: MAX_QUESTIONS + 1 },
    { ...ok, questionCount: 2.5 },
    { ...ok, userId: uuidv4() },
  ]) assert.equal(createSchema.safeParse(bad).success, false, JSON.stringify(bad));
});

test('answers: drafts may be empty, submissions may not; length and characters are limited', () => {
  assert.equal(draftSchema.parse({ answer: '' }).answer, '');
  assert.equal(draftSchema.parse({ answer: 'line 1\r\nline 2' }).answer, 'line 1\nline 2');
  assert.equal(submitSchema.safeParse({ answer: '   ' }).success, false);
  assert.equal(submitSchema.safeParse({ answer: 'a'.repeat(MAX_ANSWER_CHARS + 1) }).success, false);
  assert.equal(submitSchema.safeParse({ answer: 'bad\u0000char' }).success, false);
  assert.equal(submitSchema.safeParse({ answer: 'ok', score: 100 }).success, false, 'a score is never accepted from the client');
  assert.equal(positionSchema.safeParse({ position: -1 }).success, false);
});

// ---------- summary ----------

test('summary: no evaluated answers means no average and no conclusions', () => {
  const s = computeSummary([
    { type: 'technical', focus: 'Node.js', score: null, evaluation: null, draftAnswer: 'half an answer' },
    { type: 'hr', focus: 'motivation', score: null, evaluation: null, draftAnswer: null },
  ]);
  assert.deepEqual(s.statistics, {
    totalQuestions: 2, evaluated: 0, draftOnly: 1, unanswered: 1, averageScore: null, highestScore: null, lowestScore: null,
    byType: { technical: { questions: 1, evaluated: 0, averageScore: null }, hr: { questions: 1, evaluated: 0, averageScore: null } },
  });
  assert.deepEqual(s.feedback, { strongestAreas: [], areasToImprove: [], frequentlyMissedConcepts: [], studyNext: [] });
});

test('summary: averages only evaluated answers; areas, missed concepts and study topics', () => {
  const s = computeSummary([
    { type: 'technical', focus: 'Node.js', score: 90, evaluation: evaluation(90), draftAnswer: 'x' },
    { type: 'technical', focus: 'Docker', score: 30, evaluation: evaluation(30, ['images and containers (Docker)', 'security (Docker)']), draftAnswer: 'x' },
    { type: 'behavioral', focus: 'teamwork', score: 55, evaluation: evaluation(55, ['STAR answer structure']), draftAnswer: 'x' },
    { type: 'behavioral', focus: 'handling conflict', score: 45, evaluation: evaluation(45, ['STAR answer structure']), draftAnswer: 'x' },
    { type: 'hr', focus: 'motivation', score: null, evaluation: null, draftAnswer: null },
  ]);
  assert.equal(s.statistics.averageScore, 55); // (90+30+55+45)/4, the unanswered one excluded
  assert.deepEqual([s.statistics.highestScore, s.statistics.lowestScore, s.statistics.evaluated, s.statistics.unanswered], [90, 30, 4, 1]);
  assert.deepEqual(s.statistics.byType.behavioral, { questions: 2, evaluated: 2, averageScore: 50 });
  assert.deepEqual(s.feedback.strongestAreas.map((a) => a.focus), ['Node.js']);
  assert.deepEqual(s.feedback.areasToImprove.map((a) => a.focus), ['Docker', 'handling conflict', 'teamwork']);
  assert.deepEqual(s.feedback.frequentlyMissedConcepts[0], { concept: 'STAR answer structure', count: 2 });
  assert.equal(s.feedback.studyNext[0], 'Docker');
  assert.ok(s.feedback.studyNext.includes('STAR answer structure'));
  assert.ok(s.feedback.studyNext.length <= 6);
});

// ---------- database (opt-in: DASHBOARD_DB_TESTS=1 DB_NAME=<test db with 001-015>) ----------

const dbTests = process.env.DASHBOARD_DB_TESTS === '1';
const skip = !dbTests && 'set DASHBOARD_DB_TESTS=1';
const createdUsers: string[] = [];
after(async () => {
  if (!dbTests) return;
  for (const id of createdUsers) await pool.execute('DELETE FROM users WHERE id = ?', [id]);
  await pool.end();
});
const user = async () => {
  const id = uuidv4();
  createdUsers.push(id);
  await pool.execute('INSERT INTO users (id, name, email, password_hash) VALUES (?, ?, ?, ?)', [id, 'T', `${id}@a.test`, 'x']);
  return id;
};
const resumeAndJob = async (userId: string) => {
  const resumeId = uuidv4();
  const groupId = uuidv4();
  await pool.execute('INSERT INTO resume_groups (id, user_id) VALUES (?, ?)', [groupId, userId]);
  await pool.execute(
    `INSERT INTO resumes (id, user_id, resume_group_id, version_number, original_filename, stored_filename, file_path, file_size, mime_type, extraction_status)
     VALUES (?, ?, ?, 1, 'r.pdf', 'r.pdf', '/nonexistent/r.pdf', 1, 'application/pdf', 'completed')`,
    [resumeId, userId, groupId]
  );
  const jobId = uuidv4();
  await pool.execute("INSERT INTO job_descriptions (id, user_id, title, description_text) VALUES (?, ?, 'Dev', 'text')", [jobId, userId]);
  return { resumeId, jobId };
};
const newSession = async (userId: string, count = 3) => {
  const { resumeId, jobId } = await resumeAndJob(userId);
  const questions = Array.from({ length: count }, (_, i) => question({ text: `Question number ${i + 1} about Node.js event loops.`, focus: i === 0 ? 'Node.js' : `focus ${i}` }));
  const id = await interviews.createSession(userId, {
    resumeId, jobDescriptionId: jobId, title: 'Dev — Co', resumeLabel: 'r.pdf (version 1)', interviewType: 'technical', difficulty: 'intermediate',
    generatorVersion: '1.0', notes: ['note'], questions,
  });
  return { id, resumeId, jobId };
};

test('SQL: create, read, drafts, evaluation, position, complete (read-only afterwards), delete', { skip }, async () => {
  const u = await user();
  const { id } = await newSession(u);
  let data = (await interviews.getSession(u, id))!;
  assert.deepEqual([data.session.status, data.session.questionCount, data.session.currentPosition, data.questions.length, data.session.notes], ['in_progress', 3, 0, 3, ['note']]);
  const [q1, q2] = data.questions;
  assert.equal((data.questions[0] as any).expectedPoints, undefined, 'expected keywords are not sent to the browser');

  // Draft saved and recovered later.
  assert.equal(await interviews.saveDraft(u, id, q1.id, 'first draft'), 'ok');
  assert.equal(await interviews.saveDraft(u, id, q1.id, 'second draft'), 'ok');
  data = (await interviews.getSession(u, id))!;
  assert.deepEqual([data.questions[0].draftAnswer, data.questions[0].submittedAnswer, data.questions[0].score], ['second draft', null, null]);

  assert.equal(await interviews.recordEvaluation(u, id, q1.id, 'final answer', evaluation(80, ['streams (Node.js)'])), 'ok');
  assert.equal(await interviews.setPosition(u, id, 1), 'ok');
  assert.equal(await interviews.setPosition(u, id, 3), 'out_of_range');
  data = (await interviews.getSession(u, id))!;
  assert.deepEqual([data.questions[0].submittedAnswer, data.questions[0].draftAnswer, data.questions[0].score, data.session.currentPosition], ['final answer', 'final answer', 80, 1]);
  assert.deepEqual([data.summary.statistics.evaluated, data.summary.statistics.averageScore], [1, 80]);

  const list = await interviews.listSessions(u, 1, 20);
  assert.deepEqual([list.items.length, list.items[0].evaluatedCount, list.items[0].averageScore], [1, 1, 80]);

  assert.equal(await interviews.completeSession(u, id), 'ok');
  assert.equal(await interviews.completeSession(u, id), 'ok', 'completing twice is harmless');
  data = (await interviews.getSession(u, id))!;
  assert.equal(data.session.status, 'completed');
  assert.deepEqual([data.summary.statistics.evaluated, data.summary.statistics.unanswered], [1, 2]);
  assert.equal(await interviews.saveDraft(u, id, q2.id, 'late'), 'completed');
  assert.equal(await interviews.recordEvaluation(u, id, q2.id, 'late', evaluation(90)), 'completed');
  assert.equal(await interviews.setPosition(u, id, 0), 'completed');

  assert.equal(await interviews.deleteSession(u, id), true);
  const [left]: any = await pool.execute('SELECT COUNT(*) as n FROM interview_questions WHERE session_id = ?', [id]);
  assert.equal(Number(left[0].n), 0);
});

test('SQL: other users cannot read, answer, move, complete or delete; questions must belong to the session', { skip }, async () => {
  const owner = await user();
  const other = await user();
  const { id } = await newSession(owner);
  const otherSession = await newSession(other);
  const q = (await interviews.getSession(owner, id))!.questions[0];
  const otherQ = (await interviews.getSession(other, otherSession.id))!.questions[0];

  assert.equal(await interviews.getSession(other, id), null);
  assert.equal(await interviews.getQuestionForAnswer(other, id, q.id), null);
  assert.equal(await interviews.saveDraft(other, id, q.id, 'x'), 'not_found');
  assert.equal(await interviews.recordEvaluation(other, id, q.id, 'x', evaluation(100)), 'not_found');
  assert.equal(await interviews.setPosition(other, id, 1), 'not_found');
  assert.equal(await interviews.completeSession(other, id), 'not_found');
  assert.equal(await interviews.deleteSession(other, id), false);
  assert.equal((await interviews.listSessions(other, 1, 20)).items.every((s) => s.id !== id), true);
  // Another session's question id, even the owner's own, does not work in this session.
  assert.equal(await interviews.saveDraft(owner, id, otherQ.id, 'x'), 'not_found');
  assert.equal(await interviews.getQuestionForAnswer(owner, id, otherQ.id), null);
  const data = (await interviews.getSession(owner, id))!;
  assert.deepEqual([data.session.status, data.questions[0].draftAnswer], ['in_progress', null]);
});

test('SQL: deleting the resume or job description keeps the session and its answers', { skip }, async () => {
  const u = await user();
  const { id, resumeId, jobId } = await newSession(u);
  const q = (await interviews.getSession(u, id))!.questions[0];
  await interviews.recordEvaluation(u, id, q.id, 'answer', evaluation(60));
  await pool.execute('DELETE FROM resumes WHERE id = ?', [resumeId]);
  await pool.execute('DELETE FROM job_descriptions WHERE id = ?', [jobId]);
  const data = (await interviews.getSession(u, id))!;
  assert.deepEqual([data.session.resumeId, data.session.jobDescriptionId, data.session.title, data.questions[0].score], [null, null, 'Dev — Co', 60]);
});
