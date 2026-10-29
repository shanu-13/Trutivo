import {
  AlignmentType,
  BorderStyle,
  Document,
  ExternalHyperlink,
  HeadingLevel,
  LevelFormat,
  Packer,
  Paragraph,
  TextRun,
  type ParagraphChild,
} from 'docx';
import type { Block, ResumeDocument } from './resume-document.service';
import type { TemplateId } from './resume-pdf.service';

// Renders the structured resume document (the same one the PDF export draws)
// as an editable Word document (Step 10): native paragraphs, Heading 1 section
// headings, real bulleted lists and plain text runs, so it opens and edits
// normally in Word, LibreOffice or Google Docs. Single column, no tables,
// images or text boxes. Templates change formatting only, never the text.

interface DocxTemplate {
  font: string;
  // Sizes in half-points, spacing in twentieths of a point (Word units).
  nameSize: number;
  detailSize: number;
  headingSize: number;
  bodySize: number;
  margin: number;
  sectionSpaceBefore: number;
  blockSpaceAfter: number;
  center: boolean;
  allCapsHeadings: boolean;
  accent: string | null;
  rule: boolean;
}

// Mirrors the PDF templates in resume-pdf.service.ts with fonts every Word install has.
export const DOCX_TEMPLATES: Record<TemplateId, DocxTemplate> = {
  classic: {
    font: 'Georgia',
    nameSize: 40,
    detailSize: 19,
    headingSize: 23,
    bodySize: 20,
    margin: 1134, // 2 cm
    sectionSpaceBefore: 240,
    blockSpaceAfter: 40,
    center: true,
    allCapsHeadings: true,
    accent: null,
    rule: false,
  },
  modern: {
    font: 'Calibri',
    nameSize: 44,
    detailSize: 18,
    headingSize: 24,
    bodySize: 20,
    margin: 1020, // 1.8 cm
    sectionSpaceBefore: 240,
    blockSpaceAfter: 40,
    center: false,
    allCapsHeadings: false,
    accent: '1D4ED8',
    rule: true,
  },
  compact: {
    font: 'Arial',
    nameSize: 32,
    detailSize: 17,
    headingSize: 20,
    bodySize: 18,
    margin: 794, // 1.4 cm
    sectionSpaceBefore: 140,
    blockSpaceAfter: 20,
    center: false,
    allCapsHeadings: true,
    accent: null,
    rule: true,
  },
};

const TEXT_COLOR = '111111';
const MUTED_COLOR = '333333';
const BULLETS = 'resume-bullets';

// Characters XML 1.0 cannot contain (lone surrogates, U+FFFE/U+FFFF) are dropped;
// control characters were already removed when the document was built.
const xmlSafe = (text: string) => text.replace(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]|[￾￿]/g, '');

// Explicit web addresses and e-mail addresses become clickable links; the visible text is unchanged.
const LINK_RE = /(https?:\/\/[^\s|,;]+[^\s|,;.)]|[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,})/g;

const runs = (text: string, style: { size: number; bold?: boolean; color: string; font: string }): ParagraphChild[] => {
  const safe = xmlSafe(text);
  const children: ParagraphChild[] = [];
  let last = 0;
  for (const match of safe.matchAll(LINK_RE)) {
    const start = match.index ?? 0;
    if (start > last) children.push(new TextRun({ text: safe.slice(last, start), ...style }));
    const target = match[0].includes('@') && !match[0].startsWith('http') ? `mailto:${match[0]}` : match[0];
    children.push(new ExternalHyperlink({ link: target, children: [new TextRun({ text: match[0], ...style, style: 'Hyperlink' })] }));
    last = start + match[0].length;
  }
  if (last < safe.length) children.push(new TextRun({ text: safe.slice(last), ...style }));
  return children;
};

export const renderResumeDocx = async (resume: ResumeDocument, templateId: TemplateId, title: string): Promise<Buffer> => {
  const t = DOCX_TEMPLATES[templateId];
  const align = t.center ? AlignmentType.CENTER : AlignmentType.LEFT;
  const base = { font: t.font, size: t.bodySize };
  const paragraphs: Paragraph[] = [];

  if (resume.name) {
    paragraphs.push(
      new Paragraph({
        heading: HeadingLevel.TITLE,
        alignment: align,
        spacing: { after: 60 },
        children: runs(resume.name, { font: t.font, size: t.nameSize, bold: true, color: t.accent ?? TEXT_COLOR }),
      })
    );
  }
  for (const detail of resume.details) {
    paragraphs.push(
      new Paragraph({ alignment: align, spacing: { after: 0 }, children: runs(detail, { font: t.font, size: t.detailSize, color: MUTED_COLOR }) })
    );
  }

  const blockParagraph = (block: Block, index: number, next: Block | undefined) => {
    const color = block.type === 'text' ? MUTED_COLOR : TEXT_COLOR;
    const children = runs(block.text, { ...base, bold: block.type === 'entry', color });
    if (block.type === 'bullet') {
      return new Paragraph({ numbering: { reference: BULLETS, level: 0 }, spacing: { after: t.blockSpaceAfter }, children });
    }
    return new Paragraph({
      spacing: { before: block.type === 'entry' && index > 0 ? t.blockSpaceAfter * 3 : 0, after: t.blockSpaceAfter },
      // An entry title stays on the same page as the line after it.
      keepNext: block.type === 'entry' && next !== undefined,
      children,
    });
  };

  for (const section of resume.sections) {
    paragraphs.push(
      new Paragraph({
        heading: HeadingLevel.HEADING_1,
        // A heading is never left alone at the bottom of a page.
        keepNext: true,
        keepLines: true,
        spacing: { before: t.sectionSpaceBefore, after: 80 },
        border: t.rule ? { bottom: { style: BorderStyle.SINGLE, size: 6, color: t.accent ?? '666666', space: 1 } } : undefined,
        children: [
          new TextRun({
            text: xmlSafe(section.title),
            font: t.font,
            size: t.headingSize,
            bold: true,
            allCaps: t.allCapsHeadings,
            color: t.accent ?? TEXT_COLOR,
          }),
        ],
      })
    );
    section.blocks.forEach((block, i) => paragraphs.push(blockParagraph(block, i, section.blocks[i + 1])));
  }

  const document = new Document({
    title,
    creator: 'AI Resume Analyzer',
    styles: {
      default: { document: { run: { font: t.font, size: t.bodySize, color: TEXT_COLOR } } },
      // Heading and title styles keep Word's navigation pane and outline; colours come from the runs.
      paragraphStyles: [
        { id: 'Title', name: 'Title', basedOn: 'Normal', next: 'Normal', run: { font: t.font, size: t.nameSize, bold: true } },
        { id: 'Heading1', name: 'Heading 1', basedOn: 'Normal', next: 'Normal', quickFormat: true, run: { font: t.font, size: t.headingSize, bold: true } },
      ],
    },
    numbering: {
      config: [
        {
          reference: BULLETS,
          levels: [
            {
              level: 0,
              format: LevelFormat.BULLET,
              text: '•',
              alignment: AlignmentType.LEFT,
              style: { paragraph: { indent: { left: 360, hanging: 240 } } },
            },
          ],
        },
      ],
    },
    sections: [
      {
        properties: {
          page: {
            size: { width: 11906, height: 16838 }, // A4
            margin: { top: t.margin, bottom: t.margin, left: t.margin, right: t.margin },
          },
        },
        children: paragraphs,
      },
    ],
  });
  return Packer.toBuffer(document);
};
