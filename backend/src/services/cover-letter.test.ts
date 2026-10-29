import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import http from 'http';
import { AddressInfo } from 'net';
import type { Request, Response } from 'express';
import { AiServiceError, generateCoverLetter, toCoverLetterFacts, type StructuredResume } from './ai.service';
import { createSchema, generateSchema, updateSchema, MAX_CONTENT_LENGTH } from '../controllers/cover-letter.controller';
import { rateLimitPerUser } from '../middleware/rate-limit.middleware';

let handler: (req: http.IncomingMessage, body: string, res: http.ServerResponse) => void;
let server: http.Server;
let baseUrl: string;
const sendJson = (res: http.ServerResponse, status: number, body: unknown) => {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body));
};
before(async () => {
  server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => handler(req, body, res));
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
after(() => {
  server.closeAllConnections();
  server.close();
});
beforeEach(() => {
  process.env.AI_SERVICE_URL = baseUrl;
  delete process.env.AI_SERVICE_TIMEOUT_MS;
});

const structured = {
  personalInformation: { name: 'Priya Raman', email: 'priya@example.com', phone: '+91 90000 00000', location: 'Chennai', linkedin: 'linkedin.com/in/p', github: null, portfolio: null },
  summary: 'Backend developer.',
  experience: [{ title: 'Developer', company: 'ABC', location: 'Chennai', startDate: 'Jan 2022', endDate: null, isCurrent: true, description: ['Built APIs', 'x'.repeat(900)], rawText: 'RAW TEXT' }],
  education: [{ degree: 'B.E.', field: 'CS', institution: 'Anna University', startDate: null, endDate: null, isCurrent: false, grade: null, rawText: 'RAW' }],
  projects: [{ name: 'Tracker', description: ['Built a tracker'], technologies: ['React'], url: null, rawText: 'RAW' }],
  skills: { backend: ['Node.js'], databases: ['MySQL', 'Node.js'] },
  certifications: [{ name: 'AWS CCP', issuer: 'Amazon', date: '2023' }],
  achievements: [],
  languages: [],
  interests: [],
  otherSections: {},
} as unknown as StructuredResume;

const LETTER = {
  method: 'rule_based',
  tone: 'professional',
  length: 'standard',
  paragraphs: ['Dear Hiring Manager,', 'Body.'],
  text: 'Dear Hiring Manager,\n\nBody.',
  wordCount: 5,
  placeholders: [],
  usedFacts: { skills: [], experience: [], projects: [], education: [], certifications: [] },
  notes: [],
};

test('facts sent for generation: no contact details or raw text, trimmed to limits', () => {
  const facts = toCoverLetterFacts(structured, { requiredSkills: ['Node.js'], preferredSkills: [] }, { title: 'Backend Developer', companyName: null });
  const json = JSON.stringify(facts);
  for (const secret of ['priya@example.com', '90000', 'Chennai', 'linkedin', 'RAW TEXT']) assert.ok(!json.includes(secret), secret);
  assert.equal(facts.candidate.name, 'Priya Raman');
  assert.deepEqual(facts.candidate.skills, ['Node.js', 'MySQL'], 'deduplicated');
  assert.equal(facts.candidate.experience[0].highlights[1].length, 500);
  assert.deepEqual(facts.candidate.certifications, ['AWS CCP']);
  assert.deepEqual(facts.job, { title: 'Backend Developer', companyName: null, requiredSkills: ['Node.js'], preferredSkills: [] });
});

test('generateCoverLetter sends the facts and returns the validated letter', async () => {
  let received: any;
  handler = (req, body, res) => {
    received = { url: req.url, body: JSON.parse(body) };
    sendJson(res, 200, { success: true, message: 'ok', data: { coverLetter: LETTER } });
  };
  const facts = toCoverLetterFacts(structured, { requiredSkills: [], preferredSkills: [] }, { title: 'Dev', companyName: 'Co' });
  const result = await generateCoverLetter(facts, 'concise', 'short');
  assert.equal(received.url, '/api/cover-letter/generate');
  assert.equal(received.body.tone, 'concise');
  assert.equal(received.body.length, 'short');
  assert.equal(result.text, LETTER.text);
});

test('malformed, failing, slow or unreachable generation never yields a letter', async () => {
  const facts = toCoverLetterFacts(structured, { requiredSkills: [], preferredSkills: [] }, { title: 'Dev', companyName: null });
  const expect = async (status: number, code: string) =>
    assert.rejects(generateCoverLetter(facts, 'professional', 'standard'), (e: unknown) => e instanceof AiServiceError && e.statusCode === status && e.code === code);
  for (const bad of [{ ...LETTER, text: '' }, { ...LETTER, method: 'llm' }, { ...LETTER, text: 'x'.repeat(6001) }, null]) {
    handler = (_q, _b, res) => sendJson(res, 200, { success: true, message: 'ok', data: { coverLetter: bad } });
    await expect(502, 'AI_SERVICE_ERROR');
  }
  handler = (_q, _b, res) => sendJson(res, 500, { success: false, message: 'x', error: { code: 'COVER_LETTER_INVALID', details: null } });
  await expect(502, 'AI_SERVICE_ERROR');
  process.env.AI_SERVICE_TIMEOUT_MS = '50';
  handler = (_q, _b, res) => setTimeout(() => sendJson(res, 200, { success: true, message: 'ok', data: { coverLetter: LETTER } }), 300);
  await expect(504, 'AI_SERVICE_TIMEOUT');
  process.env.AI_SERVICE_URL = 'http://127.0.0.1:1';
  await expect(503, 'AI_SERVICE_UNAVAILABLE');
});

const ID = '3f1c2b6e-1d2a-4c3b-9a8f-0e1d2c3b4a59';

test('request validation: ids, tone, length, sizes and plain text', () => {
  assert.ok(generateSchema.safeParse({ resumeId: ID, jobDescriptionId: ID, tone: 'confident', length: 'short' }).success);
  for (const bad of [
    { resumeId: 'x', jobDescriptionId: ID, tone: 'confident', length: 'short' },
    { resumeId: ID, jobDescriptionId: ID, tone: 'angry', length: 'short' },
    { resumeId: ID, jobDescriptionId: ID, tone: 'confident', length: 'epic' },
    { resumeId: ID, jobDescriptionId: ID, tone: 'confident', length: 'short', userId: ID },
  ]) assert.equal(generateSchema.safeParse(bad).success, false, JSON.stringify(bad));

  const ok = createSchema.parse({ title: '  Backend  role ', content: 'Line 1\r\nLine 2', tone: 'concise', length: 'short', companyName: '  ' });
  assert.equal(ok.title, 'Backend role');
  assert.equal(ok.content, 'Line 1\nLine 2');
  assert.equal(ok.companyName, null);
  for (const bad of [
    { title: '', content: 'x', tone: 'concise', length: 'short' },
    { title: 't', content: '   ', tone: 'concise', length: 'short' },
    { title: 't', content: 'x'.repeat(MAX_CONTENT_LENGTH + 1), tone: 'concise', length: 'short' },
    { title: 't', content: 'bad\u0000char', tone: 'concise', length: 'short' },
    { title: 'x'.repeat(201), content: 'x', tone: 'concise', length: 'short' },
    { title: 't', content: 'x', tone: 'concise', length: 'short', userId: ID },
    { title: 't', content: 'x', tone: 'concise', length: 'short', resumeId: 'nope' },
  ]) assert.equal(createSchema.safeParse(bad).success, false, JSON.stringify(bad).slice(0, 80));
  assert.equal(updateSchema.safeParse({}).success, false, 'nothing to update');
  assert.ok(updateSchema.safeParse({ content: 'New text' }).success);
});

test('generation is rate limited per user', () => {
  const limit = rateLimitPerUser('test', 2, 60_000);
  const run = (userId: string) => {
    let status = 200;
    let nextCalled = false;
    const res = { setHeader: () => undefined, status: (s: number) => ((status = s), res), json: () => res } as unknown as Response;
    limit({ user: { id: userId } } as Request, res, () => (nextCalled = true));
    return nextCalled ? 200 : status;
  };
  assert.deepEqual([run('a'), run('a'), run('a'), run('b')], [200, 200, 429, 200]);
});
