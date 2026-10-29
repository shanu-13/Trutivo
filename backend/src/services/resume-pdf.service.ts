import path from 'path';
import PDFDocument from 'pdfkit';
import type { Block, ResumeDocument } from './resume-document.service';

// Renders a structured resume document to PDF (Step 9D) with PDFKit. Text is
// drawn directly (no HTML, no scripts, no remote resources), so nothing in the
// resume can run or load anything. All templates are single-column, use real
// text (searchable and ATS-readable) and the bundled DejaVu fonts, which cover
// Latin, Greek, Cyrillic and common symbols. Templates change presentation
// only; every template draws exactly the same text.

export const TEMPLATE_IDS = ['classic', 'modern', 'compact'] as const;
export type TemplateId = (typeof TEMPLATE_IDS)[number];
export const isTemplateId = (value: unknown): value is TemplateId => TEMPLATE_IDS.includes(value as TemplateId);

export const TEMPLATE_INFO: { id: TemplateId; name: string; description: string }[] = [
  { id: 'classic', name: 'Classic', description: 'Single column, serif type, plain headings. The most conservative and ATS-friendly choice.' },
  { id: 'modern', name: 'Modern', description: 'Single column, sans-serif type with a blue accent and a thin line under each heading.' },
  { id: 'compact', name: 'Compact', description: 'Condensed type and tighter spacing to fit content-heavy resumes on fewer pages.' },
];

const FONT_DIR = path.join(path.dirname(require.resolve('dejavu-fonts-ttf/package.json')), 'ttf');
const font = (file: string) => path.join(FONT_DIR, file);

interface Template {
  regular: string;
  bold: string;
  margin: number;
  nameSize: number;
  detailSize: number;
  headingSize: number;
  bodySize: number;
  lineGap: number;
  sectionGap: number;
  blockGap: number;
  align: 'left' | 'center';
  uppercaseHeadings: boolean;
  accent: string | null;
  rule: boolean;
}

export const TEMPLATES: Record<TemplateId, Template> = {
  // Conservative serif layout: black text, plain headings, no rules or colour.
  classic: {
    regular: font('DejaVuSerif.ttf'),
    bold: font('DejaVuSerif-Bold.ttf'),
    margin: 56,
    nameSize: 20,
    detailSize: 9.5,
    headingSize: 11.5,
    bodySize: 10,
    lineGap: 2,
    sectionGap: 12,
    blockGap: 3,
    align: 'center',
    uppercaseHeadings: true,
    accent: null,
    rule: false,
  },
  // Sans-serif with a single accent colour and a thin line under each heading.
  modern: {
    regular: font('DejaVuSans.ttf'),
    bold: font('DejaVuSans-Bold.ttf'),
    margin: 50,
    nameSize: 22,
    detailSize: 9,
    headingSize: 12,
    bodySize: 9.5,
    lineGap: 2,
    sectionGap: 12,
    blockGap: 3,
    align: 'left',
    uppercaseHeadings: false,
    accent: '#1d4ed8',
    rule: true,
  },
  // Condensed type, smaller margins and spacing for content-heavy resumes.
  compact: {
    regular: font('DejaVuSansCondensed.ttf'),
    bold: font('DejaVuSansCondensed-Bold.ttf'),
    margin: 38,
    nameSize: 16,
    detailSize: 8.5,
    headingSize: 10,
    bodySize: 8.75,
    lineGap: 1,
    sectionGap: 8,
    blockGap: 1.5,
    align: 'left',
    uppercaseHeadings: true,
    accent: null,
    rule: true,
  },
};

const TEXT_COLOR = '#111111';
const MUTED_COLOR = '#333333';
const BULLET_INDENT = 11;

// Code points in the text that the template's font cannot draw.
export const unsupportedCharacters = (text: string, template: TemplateId = 'classic') => {
  const doc = new PDFDocument({ autoFirstPage: false });
  doc.font(TEMPLATES[template].regular);
  const fontkitFont = (doc as unknown as { _font?: { font?: { hasGlyphForCodePoint?: (cp: number) => boolean } } })._font?.font;
  if (typeof fontkitFont?.hasGlyphForCodePoint !== 'function') return [];
  const missing = new Set<string>();
  for (const ch of text) {
    const cp = ch.codePointAt(0)!;
    if (cp > 0x20 && !fontkitFont.hasGlyphForCodePoint(cp)) missing.add(ch);
  }
  return [...missing];
};

export const renderResumePdf = (resume: ResumeDocument, templateId: TemplateId, title: string): Promise<Buffer> =>
  new Promise((resolve, reject) => {
    const t = TEMPLATES[templateId];
    const doc = new PDFDocument({
      size: 'A4',
      margins: { top: t.margin, bottom: t.margin, left: t.margin, right: t.margin },
      info: { Title: title, Creator: 'AI Resume Analyzer' },
      // Text stays real text in the file, so it can be selected and parsed.
      compress: true,
    });
    const chunks: Buffer[] = [];
    doc.on('data', (chunk: Buffer) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    try {
      doc.registerFont('regular', t.regular);
      doc.registerFont('bold', t.bold);
      const left = doc.page.margins.left;
      const width = doc.page.width - doc.page.margins.left - doc.page.margins.right;
      const bottom = () => doc.page.height - doc.page.margins.bottom;

      const height = (text: string, fontName: string, size: number, w = width) =>
        doc.font(fontName).fontSize(size).heightOfString(text, { width: w, lineGap: t.lineGap });
      // Starts a new page unless `needed` points still fit, so a heading or an
      // entry title is not left alone at the bottom of a page.
      const keep = (needed: number) => {
        if (doc.y + needed > bottom() && doc.y > doc.page.margins.top) doc.addPage();
      };
      const write = (text: string, fontName: string, size: number, color: string, options: PDFKit.Mixins.TextOptions = {}) =>
        doc.font(fontName).fontSize(size).fillColor(color).text(text, { width, lineGap: t.lineGap, ...options });

      // Name and contact details, exactly as written.
      if (resume.name) write(resume.name, 'bold', t.nameSize, t.accent ?? TEXT_COLOR, { align: t.align });
      for (const detail of resume.details) write(detail, 'regular', t.detailSize, MUTED_COLOR, { align: t.align });

      const blockHeight = (b: Block) =>
        b.type === 'bullet' ? height(b.text, 'regular', t.bodySize, width - BULLET_INDENT) : height(b.text, b.type === 'entry' ? 'bold' : 'regular', t.bodySize);

      const lineHeight = t.bodySize * 1.4;
      // An entry's title with the lines right after it (organisation, dates), up to
      // the first bullet: kept on one page when they fit.
      const entryGroupHeight = (blocks: Block[], start: number) => {
        let h = blockHeight(blocks[start]);
        for (let i = start + 1; i < blocks.length && blocks[i].type === 'text' && i <= start + 4; i++) h += blockHeight(blocks[i]) + t.blockGap;
        const after = blocks.find((b, i) => i > start && b.type === 'bullet');
        return h + (after ? Math.min(blockHeight(after), 2 * lineHeight) : 0);
      };
      const leadHeight = (blocks: Block[], start: number) =>
        blocks[start].type === 'entry' ? entryGroupHeight(blocks, start) : Math.min(blockHeight(blocks[start]), 2 * lineHeight);

      for (const section of resume.sections) {
        doc.y += t.sectionGap;
        const heading = t.uppercaseHeadings ? section.title.toUpperCase() : section.title;
        const headingHeight = height(heading, 'bold', t.headingSize) + 4;
        keep(headingHeight + leadHeight(section.blocks, 0));
        doc.x = left;
        write(heading, 'bold', t.headingSize, t.accent ?? TEXT_COLOR);
        if (t.rule) {
          const y = doc.y + 1;
          doc.moveTo(left, y).lineTo(left + width, y).lineWidth(0.6).strokeColor(t.accent ?? '#666666').stroke();
          doc.y = y + 3;
        } else {
          doc.y += 2;
        }

        section.blocks.forEach((block, i) => {
          // A long block may split across pages; its first lines may not be stranded.
          keep(leadHeight(section.blocks, i));
          if (block.type === 'entry' && i > 0) doc.y += t.blockGap * 2;
          doc.x = left;
          if (block.type === 'bullet') {
            const y = doc.y;
            doc.font('regular').fontSize(t.bodySize).fillColor(TEXT_COLOR).text('•', left + 2, y, { lineBreak: false });
            doc.text(block.text, left + BULLET_INDENT, y, { width: width - BULLET_INDENT, lineGap: t.lineGap });
          } else {
            write(block.text, block.type === 'entry' ? 'bold' : 'regular', t.bodySize, block.type === 'entry' ? TEXT_COLOR : MUTED_COLOR);
          }
          doc.y += t.blockGap;
        });
      }
      doc.end();
    } catch (error) {
      reject(error);
    }
  });
