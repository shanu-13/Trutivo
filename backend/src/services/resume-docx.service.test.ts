import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildResumeDocument, documentText } from './resume-document.service';
import { TEMPLATE_IDS } from './resume-pdf.service';
import { renderResumeDocx } from './resume-docx.service';
import { exportFilename } from './resume-export.service';
// JSZip is the zip library docx itself uses; here it reads the generated package back.
const JSZip = require('jszip');

const unescape = (s: string) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');

// Opens a .docx package and returns its parts and the text of each paragraph.
const openDocx = async (buffer: Buffer) => {
  const zip = await JSZip.loadAsync(buffer);
  const read = async (name: string) => (zip.file(name) ? ((await zip.file(name).async('string')) as string) : null);
  const xml = (await read('word/document.xml'))!;
  const paragraphs = [...xml.matchAll(/<w:p[ >][\s\S]*?<\/w:p>/g)].map((m) => ({
    xml: m[0],
    text: unescape([...m[0].matchAll(/<w:t(?: [^>]*)?>([^<]*)<\/w:t>/g)].map((t) => t[1]).join('')),
  }));
  return { zip, xml, paragraphs, contentTypes: (await read('[Content_Types].xml'))!, rels: (await read('word/_rels/document.xml.rels')) ?? '', files: Object.keys(zip.files) };
};

const RESUME = [
  'PRIYA RAMAN',
  'priya@example.test | +91 90000 00000 | https://github.com/priya-test',
  'PROFESSIONAL SUMMARY',
  'Backend developer. Café — naïve résumé, Zürich, Œuvre; Tamil: தமிழ்; symbols: & < > " \' ✓ €',
  'SKILLS',
  'JavaScript, Node.js, MySQL',
  'EXPERIENCE',
  'Senior Developer',
  'ABC Technologies',
  'Jan 2022 - Dec 2025',
  '- Developed RESTful APIs',
  '- Maintained <script>alert(1)</script> safely as text',
  'Developer',
  'XYZ Ltd',
  '- Fixed bugs',
  'CERTIFICATIONS',
  'EDUCATION',
  'B.E. Computer Science',
  'Anna University',
].join('\n');

test('DOCX: a genuine Word package with native headings and lists', async () => {
  const doc = buildResumeDocument(RESUME);
  const buffer = await renderResumeDocx(doc, 'classic', 'Priya resume');
  assert.equal(buffer.subarray(0, 2).toString(), 'PK', 'zip container');
  const d = await openDocx(buffer);
  assert.match(d.contentTypes, /application\/vnd\.openxmlformats-officedocument\.wordprocessingml\.document\.main\+xml/);
  for (const part of ['word/document.xml', 'word/styles.xml', 'word/numbering.xml', '_rels/.rels', 'docProps/core.xml']) assert.ok(d.files.includes(part), part);
  assert.ok(!d.files.some((f) => f.startsWith('word/media')), 'no images');
  assert.ok(!d.xml.includes('<w:tbl>') && !d.xml.includes('<w:txbxContent>'), 'no tables or text boxes');
  const headings = d.paragraphs.filter((p) => p.xml.includes('<w:pStyle w:val="Heading1"/>'));
  assert.deepEqual(headings.map((h) => h.text), ['PROFESSIONAL SUMMARY', 'SKILLS', 'EXPERIENCE', 'EDUCATION']);
  assert.ok(headings.every((h) => h.xml.includes('<w:keepNext/>')), 'headings keep with next');
  const bullets = d.paragraphs.filter((p) => p.xml.includes('<w:numPr>'));
  assert.deepEqual(bullets.map((b) => b.text), ['Developed RESTful APIs', 'Maintained <script>alert(1)</script> safely as text', 'Fixed bugs']);
  assert.match((await d.zip.file('word/numbering.xml').async('string')) as string, /w:numFmt w:val="bullet"/);
  assert.equal(d.paragraphs.find((p) => p.xml.includes('<w:pStyle w:val="Title"/>'))?.text, 'PRIYA RAMAN');
});

test('DOCX: exactly the document text; empty sections omitted; nothing added', async () => {
  const doc = buildResumeDocument(RESUME);
  const d = await openDocx(await renderResumeDocx(doc, 'modern', 'x'));
  assert.deepEqual(d.paragraphs.map((p) => p.text).filter(Boolean), documentText(doc));
  assert.ok(!d.paragraphs.some((p) => p.text === 'CERTIFICATIONS'));
});

test('DOCX: Unicode and special characters are kept and escaped', async () => {
  const d = await openDocx(await renderResumeDocx(buildResumeDocument(RESUME), 'classic', 'x'));
  assert.ok(d.paragraphs.some((p) => p.text === 'Backend developer. Café — naïve résumé, Zürich, Œuvre; Tamil: தமிழ்; symbols: & < > " \' ✓ €'));
  assert.ok(d.xml.includes('&lt;script&gt;'), 'markup is escaped text');
  assert.ok(!d.xml.includes('<script>'));
});

test('DOCX: characters XML cannot hold are dropped instead of breaking the file', async () => {
  const d = await openDocx(await renderResumeDocx(buildResumeDocument('Jane\nSKILLS\nGo￾, Rust\uD800, SQL'), 'compact', 'x'));
  assert.ok(d.paragraphs.some((p) => p.text === 'Go, Rust, SQL'));
});

test('DOCX: e-mail addresses and web links are clickable, text unchanged', async () => {
  const d = await openDocx(await renderResumeDocx(buildResumeDocument(RESUME), 'classic', 'x'));
  assert.match(d.rels, /Target="mailto:priya@example\.test" TargetMode="External"/);
  assert.match(d.rels, /Target="https:\/\/github\.com\/priya-test" TargetMode="External"/);
  assert.equal(d.paragraphs[1].text, 'priya@example.test | +91 90000 00000 | https://github.com/priya-test');
});

test('DOCX: templates change formatting only', async () => {
  const doc = buildResumeDocument(RESUME);
  const texts: string[] = [];
  const fonts: string[] = [];
  for (const t of TEMPLATE_IDS) {
    const d = await openDocx(await renderResumeDocx(doc, t, 'x'));
    texts.push(JSON.stringify(d.paragraphs.map((p) => p.text)));
    fonts.push(d.xml.match(/w:ascii="([^"]+)"/)![1]);
  }
  assert.equal(new Set(texts).size, 1);
  assert.deepEqual(fonts, ['Georgia', 'Calibri', 'Arial']);
});

test('DOCX: a long resume keeps every line', async () => {
  const bullets = Array.from({ length: 150 }, (_, i) => `- Delivered item ${i} with a long description that spans several lines in Word`);
  const doc = buildResumeDocument(['Jane Smith', 'EXPERIENCE', 'Engineer', 'Acme', ...bullets, 'EDUCATION', 'BSc', 'Uni'].join('\n'));
  const d = await openDocx(await renderResumeDocx(doc, 'compact', 'x'));
  const list = d.paragraphs.filter((p) => p.xml.includes('<w:numPr>'));
  assert.equal(list.length, 150);
  for (let i = 0; i < 150; i++) assert.equal(list[i].text, `Delivered item ${i} with a long description that spans several lines in Word`);
  assert.ok(d.paragraphs.some((p) => p.text === 'Uni'));
});

test('DOCX filenames are sanitized', () => {
  assert.equal(exportFilename('Jane Doe CV (final).pdf', 'modern', 'docx'), 'Jane-Doe-CV-final-modern.docx');
  assert.equal(exportFilename('../../etc/passwd', 'classic', 'docx'), 'etc-passwd-classic.docx');
  assert.equal(exportFilename('résumé "x"\r\n.pdf', 'compact', 'docx'), 'resume-x-compact.docx');
  assert.equal(exportFilename('a.pdf', 'classic'), 'a-classic.pdf', 'PDF names unchanged');
});
