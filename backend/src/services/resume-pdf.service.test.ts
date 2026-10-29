import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildResumeDocument, documentText, headingKind, validateDocumentText, MAX_DOCUMENT_CHARS } from './resume-document.service';
import { TEMPLATES, TEMPLATE_IDS, isTemplateId, renderResumePdf, unsupportedCharacters } from './resume-pdf.service';
import { exportFilename, storedFilePath } from './resume-export.service';
import { UPLOAD_DIR } from '../middleware/upload.middleware';
const { PDFParse } = require('pdf-parse');

const pdfText = async (pdf: Buffer) => {
  const parser = new PDFParse({ data: pdf });
  try {
    const result = await parser.getText();
    return { text: result.text as string, pages: result.total as number };
  } finally {
    await parser.destroy();
  }
};
const squash = (s: string) => s.replace(/\s+/g, '').toLowerCase();

const RESUME = [
  'JOHN DOE',
  'john.doe@example.com | +91 98765 43210',
  'github.com/johndoe',
  '',
  'Professional Summary:',
  'Backend developer. Café — naïve résumé Ω ü ß ñ',
  'SKILLS',
  'JavaScript, Node.js, MySQL',
  'EXPERIENCE',
  'Software Developer',
  'ABC Technologies',
  'Jan 2022 - Dec 2025',
  '- Developed RESTful APIs',
  '• Worked with MySQL databases',
  'Junior Developer',
  'XYZ Ltd',
  '- Fixed bugs',
  'CERTIFICATIONS',
  'EDUCATION',
  'B.Tech Computer Science',
  'XYZ University',
].join('\n');

test('structure: name, details, sections, entries and bullets', () => {
  const doc = buildResumeDocument(RESUME);
  assert.equal(doc.name, 'JOHN DOE');
  assert.deepEqual(doc.details, ['john.doe@example.com | +91 98765 43210', 'github.com/johndoe']);
  assert.deepEqual(doc.sections.map((s) => [s.title, s.kind]), [
    ['Professional Summary', 'summary'],
    ['SKILLS', 'skills'],
    ['EXPERIENCE', 'entries'],
    ['EDUCATION', 'entries'],
  ]);
  const exp = doc.sections[2].blocks;
  assert.deepEqual(exp.map((b) => b.type), ['entry', 'text', 'text', 'bullet', 'bullet', 'entry', 'text', 'bullet']);
  assert.equal(exp[3].text, 'Developed RESTful APIs');
});

test('structure: every content line kept exactly once, nothing added; empty sections omitted', () => {
  const doc = buildResumeDocument(RESUME);
  const content = RESUME.split('\n').map((l) => l.trim().replace(/^[-•]\s+/, '').replace(/:$/, '')).filter((l) => l && l !== 'CERTIFICATIONS');
  assert.deepEqual(documentText(doc), content);
  assert.ok(!doc.sections.some((s) => s.title === 'CERTIFICATIONS'), 'heading with no content is omitted');
});

test('structure: lines wrapped in the source PDF are rejoined, not turned into entries', () => {
  const text = [
    'Jane', 'EXPERIENCE', 'Engineer', 'Acme', '- Delivered feature one covering validation for the payments',
    'platform team', '- Built the iOS client', 'iOS Developer', 'Beta Inc', '- Shipped apps',
    'SUMMARY', 'Backend developer focused on reliable', 'services and clear documentation.',
  ].join('\n');
  const doc = buildResumeDocument(text);
  const exp = doc.sections[0].blocks;
  assert.deepEqual(exp.map((b) => [b.type, b.text]), [
    ['entry', 'Engineer'],
    ['text', 'Acme'],
    ['bullet', 'Delivered feature one covering validation for the payments platform team'],
    ['bullet', 'Built the iOS client'],
    ['entry', 'iOS Developer'],
    ['text', 'Beta Inc'],
    ['bullet', 'Shipped apps'],
  ]);
  assert.deepEqual(doc.sections[1].blocks, [{ type: 'text', text: 'Backend developer focused on reliable services and clear documentation.' }]);
  // Same words in the same order.
  assert.equal(documentText(doc).join(' ').replace(/\s+/g, ' '), text.split('\n').map((l) => l.replace(/^- /, '')).join(' ').replace(/\s+/g, ' '));
});

test('structure: missing optional parts do not crash or get invented', () => {
  assert.deepEqual(buildResumeDocument('Jane Smith'), { name: 'Jane Smith', details: [], sections: [] });
  const noHeadings = buildResumeDocument('Jane Smith\nSome text\nMore text');
  assert.deepEqual(noHeadings.details, ['Some text', 'More text']);
  assert.equal(noHeadings.sections.length, 0);
});

test('heading detection is conservative', () => {
  for (const h of ['EXPERIENCE', 'Work Experience', 'skills:', 'OPEN SOURCE']) assert.ok(headingKind(h), h);
  for (const n of ['john.doe@example.com | +91 98765 43210', 'JAN 2022 - DEC 2025', '- Built APIs', 'Software Developer', 'AWS, GCP, SQL', 'B.TECH 2017']) {
    assert.equal(headingKind(n), null, n);
  }
});

test('document text limits', () => {
  assert.equal(validateDocumentText(RESUME), null);
  assert.equal(validateDocumentText('x'.repeat(MAX_DOCUMENT_CHARS + 1)), 'TOO_LARGE');
  assert.equal(validateDocumentText(Array(1600).fill('a').join('\n')), 'TOO_LARGE');
  assert.equal(validateDocumentText(' \n\t\n'), 'EMPTY');
});

test('templates: allowlist', () => {
  for (const t of TEMPLATE_IDS) assert.equal(isTemplateId(t), true);
  for (const t of ['fancy', '', 'Classic', '../classic', null]) assert.equal(isTemplateId(t), false);
  assert.equal(TEMPLATES.classic.accent, null, 'Classic uses no colour');
  assert.equal(TEMPLATES.classic.rule, false, 'Classic draws no rules');
});

test('PDF: every template renders the same text, including special characters', async () => {
  const doc = buildResumeDocument(RESUME);
  const texts: string[] = [];
  for (const t of TEMPLATE_IDS) {
    const pdf = await renderResumePdf(doc, t, 'John Doe');
    assert.equal(pdf.subarray(0, 5).toString(), '%PDF-');
    const { text } = await pdfText(pdf);
    for (const line of documentText(doc)) assert.ok(squash(text).includes(squash(line)), `${t}: ${line}`);
    assert.ok(text.includes('Café — naïve résumé Ω ü ß ñ'), `${t}: special characters`);
    assert.ok(!/CERTIFICATIONS/i.test(text), 'empty section omitted');
    texts.push(squash(text));
  }
  assert.equal(new Set(texts).size, 1, 'content identical across templates');
});

test('PDF: a long resume spans several valid pages with nothing lost', async () => {
  const bullets = Array.from({ length: 120 }, (_, i) => `- Delivered item ${i} with a deliberately long description that wraps onto a second line in every template`);
  const text = ['Jane Smith', 'jane@example.com', 'EXPERIENCE', 'Engineer', 'Acme', ...bullets, 'EDUCATION', 'BSc Physics', 'Uni'].join('\n');
  for (const t of TEMPLATE_IDS) {
    const { text: out, pages } = await pdfText(await renderResumePdf(buildResumeDocument(text), t, 'x'));
    assert.ok(pages >= 3, `${t}: ${pages} pages`);
    for (let i = 0; i < 120; i++) assert.ok(out.includes(`Delivered item ${i} `), `${t}: bullet ${i}`);
    assert.ok(out.includes('BSc Physics'));
  }
});

test('PDF: markup in the resume is drawn as text, never interpreted', async () => {
  const text = 'Jane\nSKILLS\n<script>alert(1)</script> <img src="http://example.invalid/x.png"> <style>*{display:none}</style>';
  const pdf = await renderResumePdf(buildResumeDocument(text), 'modern', 'x');
  const { text: out } = await pdfText(pdf);
  assert.ok(out.includes('<script>alert(1)</script>'));
  assert.ok(!pdf.includes(Buffer.from('/JavaScript')) && !pdf.includes(Buffer.from('/JS ')), 'no PDF JavaScript actions');
  assert.ok(!pdf.includes(Buffer.from('/URI')), 'no links or remote resources');
});

test('unsupported characters are reported', () => {
  assert.deepEqual(unsupportedCharacters('Café Ω ü — résumé'), []);
  assert.deepEqual(unsupportedCharacters('Name 履歴'), ['履', '歴']);
});

test('download filenames are sanitized', () => {
  assert.equal(exportFilename('Jane Doe CV (final).pdf', 'classic'), 'Jane-Doe-CV-final-classic.pdf');
  assert.equal(exportFilename('../../etc/passwd', 'modern'), 'etc-passwd-modern.pdf');
  assert.equal(exportFilename('résumé "x"\r\n.pdf', 'compact'), 'resume-x-compact.pdf');
  assert.equal(exportFilename('履歴書.pdf', 'classic'), 'resume-classic.pdf');
  assert.match(exportFilename('a'.repeat(300), 'classic'), /^a{80}-classic\.pdf$/);
});

test('stored files are only served from the upload directory', () => {
  assert.ok(storedFilePath(`${UPLOAD_DIR}/abc.pdf`));
  assert.equal(storedFilePath(`${UPLOAD_DIR}/../../.env`), null);
  assert.equal(storedFilePath('/etc/passwd'), null);
  assert.equal(storedFilePath(UPLOAD_DIR), null);
});
