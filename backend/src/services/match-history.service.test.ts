import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildMatchSnapshot,
  redactPersonalData,
  MAX_SNAPSHOT_BYTES,
  SnapshotTooLargeError,
  SNAPSHOT_VERSION,
  type MatchSnapshotParts,
} from './match-history.service';
import { isValidMatchHistoryId, parsePagination, MAX_PAGE_SIZE } from '../controllers/match-history.controller';

// Fixture shaped like real validated results (values are synthetic).
const parts = (): MatchSnapshotParts =>
  ({
    matching: {
      resumeId: 'r1',
      jobDescriptionId: 'j1',
      overallScore: 84.25,
      scoreStatus: 'calculated',
      components: { requiredSkills: { score: 80, weight: 60, effectiveWeight: 60, contribution: 48, status: 'calculated', reason: null } },
      scoreMetadata: { scoringMethod: 'weighted_deterministic', version: '1.0', weights: {} },
      skills: { required: { matched: ['React'], missing: ['Docker'], coverage: 50, byCategory: {} } },
      experience: { status: 'not_applicable', requirements: [] },
      education: { status: 'not_applicable', requirements: [] },
      summary: {},
    },
    semanticMatch: null,
    semanticError: { code: 'EMBEDDING_MODEL_UNAVAILABLE', message: 'Semantic matching service is currently unavailable.' },
    analysis: { overall: { matchScore: 84.25, summary: 'x' }, strengths: [], gaps: [{ category: 'required_skill', message: 'Docker ...' }] },
    recommendations: {
      items: [
        {
          id: 'rec-001',
          category: 'projects',
          priority: 'medium',
          title: "Expand the description of the 'Shop App' project",
          issue: 'Brief',
          reason: 'r',
          action: 'a',
          relatedSkills: ['React'],
          evidence: 'Resume: Developer at ABC (contact jane.doe@example.com, +91 98765 43210, /home/jane/cv.pdf).',
        },
      ],
      total: 1,
      limitations: [],
      message: null,
    },
  }) as unknown as MatchSnapshotParts;

test('snapshot keeps the existing result parts and the Step 6B score', () => {
  const snapshot = buildMatchSnapshot(parts());
  assert.deepEqual(Object.keys(snapshot).sort(), ['analysis', 'matching', 'recommendations', 'semanticError', 'semanticMatch', 'snapshotVersion']);
  assert.equal(snapshot.snapshotVersion, SNAPSHOT_VERSION);
  assert.equal(snapshot.matching.overallScore, 84.25);
  assert.deepEqual(snapshot.matching.components, parts().matching.components);
  assert.deepEqual(snapshot.analysis.gaps, parts().analysis.gaps);
  assert.equal(snapshot.recommendations.items[0].title, "Expand the description of the 'Shop App' project");
  assert.equal(snapshot.semanticMatch, null);
  assert.equal(snapshot.semanticError?.code, 'EMBEDDING_MODEL_UNAVAILABLE');
});

test('snapshot never carries raw text or extra fields passed alongside', () => {
  const withExtras: any = { ...parts(), textContent: 'JOHN DOE ...', descriptionText: 'We are hiring', filePath: '/srv/uploads/x.pdf' };
  const text = JSON.stringify(buildMatchSnapshot(withExtras));
  for (const leaked of ['JOHN DOE', 'We are hiring', '/srv/uploads']) assert.ok(!text.includes(leaked), leaked);
});

test('contact details and file paths are redacted from snapshot strings', () => {
  const evidence = buildMatchSnapshot(parts()).recommendations.items[0].evidence ?? '';
  assert.ok(!evidence.includes('jane.doe@example.com'));
  assert.ok(!evidence.includes('98765'));
  assert.ok(!evidence.includes('/home/jane'));
  assert.ok(evidence.startsWith('Resume: Developer at ABC (contact [redacted]'));
});

test('redaction leaves ordinary analysis text alone', () => {
  for (const text of ['2017 - 2021', 'Available experience (4 years) meets the requirement of 3 years.', 'CI/CD', 'Node.js', 'B.Tech Computer Science', '84.25']) {
    assert.equal(redactPersonalData(text), text);
  }
});

test('the snapshot is a copy: later changes to the inputs do not alter it', () => {
  const input = parts();
  const snapshot = buildMatchSnapshot(input);
  (input.matching as any).overallScore = 10;
  assert.equal(snapshot.matching.overallScore, 84.25);
});

test('oversized snapshots are rejected', () => {
  const big: any = parts();
  big.analysis.overall.summary = 'x'.repeat(MAX_SNAPSHOT_BYTES);
  assert.throws(() => buildMatchSnapshot(big), SnapshotTooLargeError);
});

test('history ids must be UUIDs', () => {
  assert.equal(isValidMatchHistoryId('3f2504e0-4f89-41d3-9a0c-0305e82c3301'), true);
  for (const bad of ['', '123', "1' OR '1'='1", '3f2504e0-4f89-41d3-9a0c-0305e82c330', undefined, 42]) {
    assert.equal(isValidMatchHistoryId(bad), false, String(bad));
  }
});

test('pagination defaults and limits', () => {
  assert.deepEqual(parsePagination({}), { page: 1, limit: 10 });
  assert.deepEqual(parsePagination({ page: '3', limit: '25' }), { page: 3, limit: 25 });
  assert.deepEqual(parsePagination({ limit: String(MAX_PAGE_SIZE) }), { page: 1, limit: MAX_PAGE_SIZE });
  for (const query of [{ page: '0' }, { page: '-1' }, { page: '1.5' }, { page: 'abc' }, { limit: '0' }, { limit: '51' }, { limit: '1e3' }, { page: ['1', '2'] }, { page: '9999999' }]) {
    assert.ok('error' in parsePagination(query as any), JSON.stringify(query));
  }
});

test('redaction stays fast on long adversarial strings', () => {
  const started = Date.now();
  for (const text of ['a'.repeat(200_000), '1 '.repeat(100_000), 'a@'.repeat(100_000), '/home/'.repeat(30_000)]) redactPersonalData(text);
  assert.ok(Date.now() - started < 2000, `took ${Date.now() - started}ms`);
});
