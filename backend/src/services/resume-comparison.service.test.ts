import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compareLists, compareSavedScores, compareSections, compareSkills, compareText, normalizeLabel } from './resume-comparison.service';
import { parseVersionLabel } from '../controllers/resume.controller';
import { isValidResumeId } from '../controllers/resume-version.controller';
import type { StructuredResume } from './ai.service';

test('skills: added, removed and unchanged', () => {
  const r = compareSkills(['React', 'Node.js', 'MySQL'], ['React', 'Docker', 'MySQL']);
  assert.equal(r.status, 'available');
  assert.deepEqual(r.added, ['Docker']);
  assert.deepEqual(r.removed, ['Node.js']);
  assert.deepEqual(r.unchanged, ['React', 'MySQL']);
});

test('skills: case and whitespace differences are not changes', () => {
  const r = compareSkills(['  node.js ', 'REACT', 'Machine   Learning'], ['Node.js', 'React', 'machine learning']);
  assert.deepEqual(r.added, []);
  assert.deepEqual(r.removed, []);
  assert.equal(r.unchanged.length, 3);
  assert.equal(normalizeLabel(' Node.JS. '), 'node.js');
});

test('skills: an empty or missing side is unavailable, never "all removed"', () => {
  for (const [a, b] of [[['React'], []], [[], ['React']], [null, ['React']], [['React'], null]] as const) {
    const r = compareSkills(a as string[] | null, b as string[] | null);
    assert.equal(r.status, 'unavailable');
    assert.deepEqual([r.added, r.removed, r.unchanged], [[], [], []]);
    assert.ok(r.reason);
  }
});

const resume = (overrides: Partial<StructuredResume>): StructuredResume =>
  ({ experience: [], education: [], projects: [], certifications: [], skills: {}, ...overrides }) as StructuredResume;
const job = (title: string | null, company: string | null) =>
  ({ title, company, location: null, startDate: '2022', endDate: null, isCurrent: true, description: [], rawText: '' });

test('sections: entries matched on normalised main fields', () => {
  const older = resume({
    experience: [job('Software Developer', 'ABC Technologies'), job('Intern', 'XYZ')],
    projects: [{ name: 'Shop App', description: [], technologies: [], url: null, rawText: '' }],
  });
  const newer = resume({
    experience: [job('software developer ', 'ABC  Technologies'), job('Senior Developer', 'DEF')],
    projects: [{ name: 'Shop App', description: ['changed'], technologies: [], url: null, rawText: '' }],
  });
  const s = compareSections(older, newer);
  assert.deepEqual(s.experience.added, ['Senior Developer at DEF (2022 – Present)']);
  assert.deepEqual(s.experience.removed, ['Intern at XYZ (2022 – Present)']);
  assert.equal(s.experience.unchanged.length, 1);
  assert.deepEqual(s.projects.unchanged, ['Shop App']);
  // Neither version lists education or certifications: unavailable, not "removed".
  assert.equal(s.education.status, 'unavailable');
  assert.equal(s.certifications.status, 'unavailable');
});

test('sections: a section missing from one version is not reported as removed', () => {
  const s = compareSections(resume({ experience: [job('Developer', 'ABC')] }), resume({ experience: [] }));
  assert.equal(s.experience.status, 'unavailable');
  assert.deepEqual(s.experience.removed, []);
});

test('sections: no analysis means unavailable', () => {
  const s = compareSections(null, resume({ experience: [job('Developer', 'ABC')] }));
  for (const section of Object.values(s)) assert.equal(section.status, 'unavailable');
});

test('sections: entries without identifying fields are ignored', () => {
  const r = compareLists([{ k: '' }, { k: 'a' }], [{ k: 'a' }], (x) => x.k, (x) => x.k, 'empty');
  assert.deepEqual([r.added, r.removed, r.unchanged], [[], [], ['a']]);
});

test('text: counts changed lines without returning text', () => {
  const r = compareText('Line one\nLine  two\n\nLine three', 'Line one\nLine two\nLine four');
  assert.equal(r.changed, true);
  assert.equal(r.linesAdded, 1);
  assert.equal(r.linesRemoved, 1);
  assert.equal(r.olderWordCount, 6);
  assert.ok(!JSON.stringify(r).includes('Line'));
  assert.equal(compareText('a  b\n\n', 'a b').changed, false);
  assert.equal(compareText(null, 'x').status, 'unavailable');
});

const row = (id: string, resumeId: string, jobDescriptionId: string, overallScore: number, minute: number) => ({
  id,
  resumeId,
  jobDescriptionId,
  jobTitle: `Job ${jobDescriptionId}`,
  companyName: null,
  overallScore,
  createdAt: new Date(Date.UTC(2026, 0, 1, 0, minute)),
});

test('scores: only jobs analysed with both versions, latest analysis each', () => {
  // Newest first, as the query returns them.
  const rows = [
    row('m5', 'new', 'j1', 82.5, 50),
    row('m4', 'old', 'j2', 40, 40),
    row('m3', 'new', 'j1', 70, 30),
    row('m2', 'old', 'j1', 61.25, 20),
    row('m1', 'new', 'j3', 90, 10),
  ];
  const r = compareSavedScores(rows, 'old', 'new');
  assert.equal(r.length, 1);
  assert.deepEqual(
    { job: r[0].jobDescriptionId, older: r[0].olderScore, newer: r[0].newerScore, diff: r[0].difference, ids: [r[0].olderMatchId, r[0].newerMatchId] },
    { job: 'j1', older: 61.25, newer: 82.5, diff: 21.25, ids: ['m2', 'm5'] }
  );
  assert.deepEqual(compareSavedScores([], 'old', 'new'), []);
  assert.deepEqual(compareSavedScores([row('a', 'old', 'j1', 50, 1), row('b', 'new', 'j2', 60, 2)], 'old', 'new'), []);
});

test('version label and id validation', () => {
  assert.deepEqual(parseVersionLabel(undefined), { label: null });
  assert.deepEqual(parseVersionLabel('   '), { label: null });
  assert.deepEqual(parseVersionLabel('  Backend   focus '), { label: 'Backend focus' });
  assert.ok('error' in parseVersionLabel('x'.repeat(101)));
  assert.ok('error' in parseVersionLabel('bad\u0000label'));
  assert.ok('error' in parseVersionLabel(42));
  assert.equal(isValidResumeId('3f1c2b6e-1d2a-4c3b-9a8f-0e1d2c3b4a59'), true);
  for (const id of ['1', "' OR 1=1 --", '../etc/passwd', '']) assert.equal(isValidResumeId(id), false);
});
