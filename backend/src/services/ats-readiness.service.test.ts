import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BANDS, CATEGORY_NAMES, CHECK_WEIGHTS, bandFor, categoryWeight, evaluateAtsReadiness, type AtsResult, type CategoryId } from './ats-readiness.service';
import type { StructuredResume } from './ai.service';

const job = (title: string | null, startDate: string | null, description: string[]) =>
  ({ title, company: 'ABC', location: null, startDate, endDate: null, isCurrent: true, description, rawText: '' });
const structured = (o: Partial<StructuredResume> = {}): StructuredResume =>
  ({
    personalInformation: { name: 'Priya Raman', email: null, phone: null, location: null, linkedin: null, github: null, portfolio: null },
    summary: 'Backend developer with three years of experience building reliable REST APIs and data pipelines for payments teams.',
    experience: [
      job('Senior Developer', 'Jan 2022', ['Built the refunds API used by 40 merchants', 'Reduced report time from 10 to 2 minutes', 'Designed the audit log schema', 'Led code reviews for four engineers']),
      job('Developer', 'Jun 2019', ['Maintained MySQL schemas and migration scripts', 'Added monitoring to the billing service']),
    ],
    education: [],
    projects: [],
    skills: { backend: ['Node.js', 'Express.js'], databases: ['MySQL'], languages: ['JavaScript', 'TypeScript'], tools: ['Git'] },
    certifications: [],
    achievements: [],
    languages: [],
    interests: [],
    otherSections: {},
    ...o,
  }) as StructuredResume;

const WELL_STRUCTURED = [
  'Priya Raman',
  'priya.raman@example.com | +91 90000 00000 | https://github.com/priya-raman | linkedin.com/in/priya-raman',
  'PROFESSIONAL SUMMARY',
  'Backend developer with three years of experience building reliable REST APIs and data pipelines for payments teams.',
  'SKILLS',
  'JavaScript, TypeScript, Node.js, Express.js, MySQL, Git',
  'EXPERIENCE',
  'Senior Developer',
  'ABC Payments',
  'Jan 2022 - Present',
  '- Built the refunds API used by 40 merchants across three regions with full audit trails',
  '- Reduced report generation time from 10 to 2 minutes by caching expensive queries',
  '- Designed the audit log schema and the retention policy for transaction history',
  '- Led code reviews for four engineers and wrote the team testing guidelines',
  'Developer',
  'XYZ Solutions',
  'Jun 2019 - Dec 2021',
  '- Maintained MySQL schemas and wrote migration scripts for the billing platform',
  '- Added monitoring and alerting to the billing service to catch failed payments early',
  'PROJECTS',
  'Expense Tracker',
  '- Built a personal expense tracking web app with React, Node.js and MySQL, including monthly reports and CSV export',
  'EDUCATION',
  'B.E. Computer Science',
  'Anna University',
  '2015 - 2019',
].join('\n');

const check = (r: AtsResult, id: string) => r.checks.find((c) => c.id === id)!;
const recFor = (r: AtsResult, id: string) => r.recommendations.find((x) => x.checkId === id);

test('weights: categories add up to 100 and are fixed', () => {
  const totals = (Object.keys(CATEGORY_NAMES) as CategoryId[]).map(categoryWeight);
  assert.deepEqual(totals, [25, 35, 25, 15]);
  assert.equal(totals.reduce((a, b) => a + b, 0), 100);
  assert.deepEqual(BANDS.map((b) => b.min), [85, 70, 50, 0]);
  assert.deepEqual([bandFor(100).id, bandFor(85).id, bandFor(84).id, bandFor(70).id, bandFor(69).id, bandFor(50).id, bandFor(49).id, bandFor(0).id], ['strong', 'strong', 'good', 'good', 'fair', 'fair', 'weak', 'weak']);
});

test('a well-structured resume scores strongly, with consistent arithmetic', () => {
  const r = evaluateAtsReadiness({ text: WELL_STRUCTURED, structured: structured() });
  assert.equal(r.complete, true);
  assert.equal(r.score, 100, JSON.stringify(r.checks.filter((c) => c.earned < c.available)));
  assert.equal(r.band?.id, 'strong');
  assert.deepEqual(r.recommendations, []);
  assert.ok(r.strengths.length >= 8);
  for (const c of r.categories) assert.equal(c.earned, r.checks.filter((x) => x.category === c.id).reduce((n, x) => n + x.earned, 0));
  assert.equal(r.score, r.categories.reduce((n, c) => n + c.earned, 0));
  // Deterministic.
  assert.deepEqual(evaluateAtsReadiness({ text: WELL_STRUCTURED, structured: structured() }), r);
});

test('missing contact information', () => {
  const text = WELL_STRUCTURED.replace(/^priya\.raman.*$/m, 'Chennai, India');
  const r = evaluateAtsReadiness({ text, structured: structured() });
  assert.equal(check(r, 'email').status, 'fail');
  assert.equal(check(r, 'phone').status, 'fail');
  assert.equal(check(r, 'links').status, 'not_applicable', 'links are optional');
  assert.equal(r.score, 100 - CHECK_WEIGHTS.contact.email - CHECK_WEIGHTS.contact.phone);
  assert.equal(recFor(r, 'email')?.severity, 'high');
  assert.equal(recFor(r, 'email')?.title, 'Add an e-mail address');
  assert.ok(recFor(r, 'phone'));
});

test('missing section headings', () => {
  const text = WELL_STRUCTURED.split('\n').filter((l) => !/^(PROFESSIONAL SUMMARY|SKILLS|EXPERIENCE|PROJECTS|EDUCATION)$/.test(l)).join('\n');
  const r = evaluateAtsReadiness({ text, structured: structured() });
  assert.equal(check(r, 'headings').status, 'fail');
  assert.equal(check(r, 'coreSections').status, 'fail');
  assert.equal(check(r, 'skills').status, 'partial', 'skills found but no skills section');
  assert.equal(recFor(r, 'headings')?.severity, 'high');
  assert.equal(recFor(r, 'skills')?.title, 'Add a clearly labelled Skills section');
});

test('entry-level resume: no penalty for missing work experience or figures', () => {
  const text = [
    'Arun Kumar',
    'arun.kumar@example.com | +91 98888 77777',
    'SUMMARY',
    'Final-year computer science student interested in backend development, databases and building small web services.',
    'SKILLS',
    'Python, Django, SQL, Git, HTML, CSS',
    'PROJECTS',
    'Library System',
    '- Built a library management web app with Django and SQLite for my college',
    '- Designed the database schema and the borrowing workflow',
    'Weather Bot',
    '- Created a Telegram bot that answers weather questions using a public API',
    'EDUCATION',
    'B.Sc. Computer Science',
    'Madras Christian College',
    '2022 - 2025',
  ].join('\n');
  const s = structured({
    personalInformation: { name: 'Arun Kumar' } as StructuredResume['personalInformation'],
    summary: 'Final-year computer science student interested in backend development, databases and building small web services.',
    experience: [],
    projects: [
      { name: 'Library System', description: ['Built a library management web app with Django and SQLite for my college', 'Designed the database schema and the borrowing workflow'], technologies: [], url: null, rawText: '' },
      { name: 'Weather Bot', description: ['Created a Telegram bot that answers weather questions using a public API'], technologies: [], url: null, rawText: '' },
    ],
    skills: { languages: ['Python', 'SQL'], backend: ['Django'], tools: ['Git'], frontend: ['HTML', 'CSS'] },
  });
  const r = evaluateAtsReadiness({ text, structured: s });
  for (const id of ['experienceDetail', 'measurableResults', 'datesAndTitles']) {
    assert.equal(check(r, id).status, 'not_applicable', id);
    assert.equal(check(r, id).earned, check(r, id).available, id);
    assert.equal(recFor(r, id), undefined, id);
  }
  assert.equal(check(r, 'coreSections').status, 'pass', 'projects and education count');
  assert.ok(!r.recommendations.some((x) => /experience/i.test(x.title)));
});

test('empty or poorly extracted text: one clear issue, no cascade, no score', () => {
  for (const text of ['', 'Scan001\nPage 1']) {
    const r = evaluateAtsReadiness({ text, structured: null });
    assert.equal(r.score, null);
    assert.equal(r.band, null);
    assert.equal(r.complete, false);
    assert.match(r.incompleteReason!, /Too little text/);
    assert.deepEqual(r.recommendations.map((x) => x.checkId), ['textAmount']);
    assert.equal(r.recommendations[0].severity, 'high');
    assert.ok(r.checks.filter((c) => c.id !== 'textAmount').every((c) => c.status === 'not_evaluated'));
  }
});

test('structured analysis unavailable: text checks still run, no overall score', () => {
  const r = evaluateAtsReadiness({ text: WELL_STRUCTURED, structured: null });
  assert.equal(r.score, null);
  assert.match(r.incompleteReason!, /structured resume analysis is unavailable/);
  assert.ok(r.checks.filter((c) => c.category === 'content').every((c) => c.status === 'not_evaluated'));
  assert.ok(r.checks.filter((c) => c.category !== 'content').every((c) => c.status !== 'not_evaluated'));
  assert.equal(r.categories.find((c) => c.id === 'content')!.evaluated, false);
});

test('malformed dates and suspicious links are reported once each', () => {
  const text = WELL_STRUCTURED.replace('Jan 2022 - Present', '13/2022 - Present')
    .replace('https://github.com/priya-raman', 'https//github.com/priya-raman')
    .replace('linkedin.com/in/priya-raman', 'linkedin. com/in/priya-raman');
  const r = evaluateAtsReadiness({ text, structured: structured() });
  assert.equal(check(r, 'dateFormats').status, 'fail');
  assert.match(recFor(r, 'dateFormats')!.explanation, /13\/2022/);
  assert.equal(check(r, 'links').status, 'fail');
  assert.match(recFor(r, 'links')!.explanation, /https\/\/github\.com/);
  assert.equal(r.recommendations.filter((x) => x.checkId === 'links').length, 1);
});

test('mixed date formats are a smaller deduction than invalid dates', () => {
  const r = evaluateAtsReadiness({ text: WELL_STRUCTURED.replace('Jun 2019 - Dec 2021', '06/2019 - 12/2021'), structured: structured() });
  assert.equal(check(r, 'dateFormats').status, 'partial');
  assert.equal(recFor(r, 'dateFormats')!.title, 'Use one date format');
  const r2 = evaluateAtsReadiness({ text: WELL_STRUCTURED.replace('Jun 2019', 'May 2019'), structured: structured() });
  assert.equal(check(r2, 'dateFormats').status, 'pass', '"May" fits either month style');
});

test('a malformed e-mail is reported once, masked', () => {
  const r = evaluateAtsReadiness({ text: WELL_STRUCTURED.replace('priya.raman@example.com', 'priya.raman@examplecom'), structured: structured() });
  assert.equal(check(r, 'email').status, 'fail');
  assert.equal(recFor(r, 'email')!.title, 'Check your e-mail address');
  assert.ok(!JSON.stringify(r).includes('priya.raman@'), 'address is not repeated');
  assert.equal(check(r, 'links').status, 'pass', 'e-mail problems are not counted again as link problems');
});

test('vague bullets and missing figures map to their recommendations', () => {
  const s = structured({
    experience: [job('Developer', 'Jan 2022', ['Worked on the payments API', 'Helped with deployments', 'Involved in code reviews', 'Participated in planning'])],
  });
  const r = evaluateAtsReadiness({ text: WELL_STRUCTURED, structured: s });
  assert.equal(check(r, 'actionLanguage').status, 'fail');
  assert.equal(recFor(r, 'actionLanguage')!.title, 'Make vague description lines specific');
  assert.equal(check(r, 'measurableResults').status, 'partial');
  assert.match(recFor(r, 'measurableResults')!.action, /Never estimate or invent numbers/);
  // Every recommendation belongs to a check that lost points, and each check has at most one.
  for (const rec of r.recommendations) {
    const c = check(r, rec.checkId);
    assert.ok(c.earned < c.available, rec.checkId);
  }
  assert.equal(new Set(r.recommendations.map((x) => x.checkId)).size, r.recommendations.length);
  const order = r.recommendations.map((x) => ({ high: 0, medium: 1, low: 2 })[x.severity]);
  assert.deepEqual(order, [...order].sort((a, b) => a - b), 'sorted by severity');
});

test('keywords alone do not raise the score', () => {
  const stuffed = 'Keyword Person\nSKILLS\n' + Array(60).fill('Python, Java, AWS, Kubernetes, React, SQL, Docker').join(', ');
  const r = evaluateAtsReadiness({ text: stuffed, structured: structured({ experience: [], projects: [], summary: null, skills: { languages: ['Python', 'Java'], cloud: ['AWS', 'Kubernetes', 'Docker'], frontend: ['React'] } }) });
  assert.ok(r.score !== null && r.score < 70, String(r.score));
  assert.equal(check(r, 'coreSections').status, 'fail');
  assert.equal(check(r, 'paragraphLength').status, 'partial');
});

test('unreadable characters are detected from the extracted text', () => {
  const r = evaluateAtsReadiness({ text: WELL_STRUCTURED + '\n(cid:12)(cid:15) ��', structured: structured() });
  assert.equal(check(r, 'cleanText').status, 'fail');
  assert.equal(recFor(r, 'cleanText')!.severity, 'high');
});

test('an all-capitals name is a name, not an empty section', () => {
  const text = WELL_STRUCTURED.replace('Priya Raman', 'PRIYA RAMAN').replace(/^priya\.raman.*\n/m, '');
  for (const s of [structured(), null]) {
    const r = evaluateAtsReadiness({ text, structured: s });
    assert.equal(check(r, 'name').status, 'pass');
    assert.equal(check(r, 'sectionContent').status, 'pass', JSON.stringify(check(r, 'sectionContent')));
  }
});
