// Structured resume document for PDF export (Step 9D).
//
// Built from approved resume text only: the stored text of a version, or the
// stored text with a tailoring session's accepted and edited suggestions
// applied. Structuring only decides how each line is presented (name, contact
// details, section heading, entry title, bullet or text) and rejoins lines that
// were wrapped in the source PDF; every word appears once, in order, unchanged. Nothing is added: no
// placeholder names, contact details or sections.

export const MAX_DOCUMENT_CHARS = 60_000;
export const MAX_DOCUMENT_LINES = 1_500;
export const MAX_LINE_CHARS = 2_000;

export type SectionKind = 'summary' | 'skills' | 'entries' | 'text';

export type Block =
  | { type: 'entry'; text: string } // first line of a job, degree or project
  | { type: 'bullet'; text: string } // bullet marker removed; drawn as a bullet
  | { type: 'text'; text: string };

export interface DocumentSection {
  title: string;
  kind: SectionKind;
  blocks: Block[];
}

export interface ResumeDocument {
  name: string | null;
  details: string[];
  sections: DocumentSection[];
}

// Section headings the document recognises, with how their content is laid out.
const KNOWN_HEADINGS: Record<string, SectionKind> = {};
const add = (kind: SectionKind, names: string[]) => names.forEach((n) => (KNOWN_HEADINGS[n] = kind));
add('summary', ['summary', 'professional summary', 'career summary', 'profile', 'professional profile', 'objective', 'career objective', 'about me', 'about']);
add('skills', ['skills', 'technical skills', 'key skills', 'core skills', 'core competencies', 'competencies', 'technologies', 'tools', 'skills and tools', 'languages']);
add('entries', [
  'experience', 'work experience', 'professional experience', 'employment', 'employment history', 'work history', 'career history',
  'education', 'academic background', 'education and training', 'qualifications', 'academic qualifications',
  'projects', 'personal projects', 'academic projects', 'key projects', 'selected projects',
  'certifications', 'certificates', 'licenses and certifications', 'licenses & certifications',
  'volunteer experience', 'volunteering', 'leadership', 'leadership experience', 'internships', 'internship',
]);
add('text', ['achievements', 'awards', 'honors', 'honours', 'awards and honors', 'publications', 'interests', 'hobbies', 'activities', 'extracurricular activities', 'references', 'training', 'courses', 'additional information']);

const BULLET_RE = /^\s*(?:[-*•▪◦·‣–]|\d{1,2}[.)])\s+/;
// A line wrapped from the previous one in the source PDF: it starts with a
// lowercase letter ("platform team", but not "iOS Developer").
const isContinuation = (line: string) => /^[a-z](?![A-Z])/.test(line);

const normalizeHeading = (line: string) => line.trim().replace(/:$/, '').replace(/\s+/g, ' ').toLowerCase();

// A known section name (any case, optional colon), or a short all-capitals line
// such as "OPEN SOURCE" that is not contact information or a date.
// Only the recognised section names ("Experience", "SKILLS:"), not other all-capitals lines.
export const knownHeadingKind = (line: string): SectionKind | null => {
  const t = line.trim();
  if (!t || t.length > 50 || BULLET_RE.test(t)) return null;
  return KNOWN_HEADINGS[normalizeHeading(t)] ?? null;
};

export const headingKind = (line: string): SectionKind | null => {
  const t = line.trim();
  if (!t || t.length > 50 || BULLET_RE.test(t)) return null;
  const known = KNOWN_HEADINGS[normalizeHeading(t)];
  if (known) return known;
  const letters = t.replace(/[^A-Za-z]/g, '');
  const isCaps = letters.length >= 3 && letters === letters.toUpperCase() && !/[\d@|/:,]/.test(t) && t.split(/\s+/).length <= 5;
  return isCaps ? 'text' : null;
};

// Control characters (other than tabs, which become spaces) are removed; they cannot be drawn.
const cleanLine = (line: string) => line.replace(/\t/g, ' ').replace(/[\u0000-\u0008\u000b-\u001f\u007f​﻿]/g, '').replace(/\s+$/, '');

export type DocumentProblem = 'EMPTY' | 'TOO_LARGE';

export const validateDocumentText = (text: string): DocumentProblem | null => {
  if (text.length > MAX_DOCUMENT_CHARS) return 'TOO_LARGE';
  const lines = text.split('\n');
  if (lines.length > MAX_DOCUMENT_LINES || lines.some((l) => l.length > MAX_LINE_CHARS)) return 'TOO_LARGE';
  if (!lines.some((l) => cleanLine(l).trim())) return 'EMPTY';
  return null;
};

export const buildResumeDocument = (text: string): ResumeDocument => {
  const lines = text.split('\n').map(cleanLine).filter((l) => l.trim());
  const doc: ResumeDocument = { name: null, details: [], sections: [] };
  let section: DocumentSection | null = null;
  let previous: Block['type'] | 'heading' | null = null;

  lines.forEach((raw, i) => {
    const line = raw.trim();
    // The first line is the name as written; lines up to the first heading are contact details.
    if (i === 0) {
      doc.name = line;
      return;
    }
    const kind = headingKind(line);
    if (kind) {
      section = { title: line.replace(/:$/, ''), kind, blocks: [] };
      doc.sections.push(section);
      previous = 'heading';
      return;
    }
    if (!section) {
      doc.details.push(line);
      return;
    }
    // Rejoin a wrapped bullet or paragraph line with the line it continues (same words, same order).
    const last = section.blocks[section.blocks.length - 1];
    if (last && (last.type === 'bullet' || last.type === 'text') && isContinuation(line)) {
      last.text = `${last.text} ${line}`;
      return;
    }
    let block: Block;
    if (BULLET_RE.test(line)) block = { type: 'bullet', text: line.replace(BULLET_RE, '') };
    // In job, education and project sections a line that starts a new entry is its title.
    else if (section.kind === 'entries' && (previous === 'heading' || previous === 'bullet')) block = { type: 'entry', text: line };
    else block = { type: 'text', text: line };
    section.blocks.push(block);
    previous = block.type;
  });

  // Headings with no content are left out.
  doc.sections = doc.sections.filter((s) => s.blocks.length > 0);
  return doc;
};

// All text in the document, in order (for checks and tests).
export const documentText = (doc: ResumeDocument) => [
  ...(doc.name ? [doc.name] : []),
  ...doc.details,
  ...doc.sections.flatMap((s) => [s.title, ...s.blocks.map((b) => b.text)]),
];
