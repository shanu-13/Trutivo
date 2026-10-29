import type { StructuredResume } from './ai.service';
import { headingKind, knownHeadingKind } from './resume-document.service';
import { WEAK_OPENERS } from './resume-tailoring.service';

// ATS readiness checks (Step 11).
//
// Deterministic, explainable checks of a resume's extracted text and of the
// existing rule-based structured analysis. The score estimates how well the
// resume's text can be read and understood; it does not predict what any
// employer's applicant tracking system will do, and it is separate from the
// job match score. Every check can lose points once, and each deduction comes
// with exactly one recommendation, so the same problem is never counted twice.
// A check that does not apply (for example, measurable results for someone
// without work experience) costs nothing.

export const RULES_VERSION = '1.0';

export type CategoryId = 'structure' | 'content' | 'parsing' | 'contact';

// Points per check. Each category's checks add up to its weight; all categories add up to 100.
export const CHECK_WEIGHTS = {
  structure: { name: 5, headings: 8, coreSections: 7, sectionContent: 5 },
  content: { summary: 5, experienceDetail: 8, actionLanguage: 7, measurableResults: 5, datesAndTitles: 5, skills: 5 },
  parsing: { textAmount: 8, cleanText: 6, paragraphLength: 5, dateFormats: 6 },
  contact: { email: 6, phone: 4, links: 5 },
} as const;

export const CATEGORY_NAMES: Record<CategoryId, string> = {
  structure: 'Resume structure',
  content: 'Content quality',
  parsing: 'Parsing and formatting',
  contact: 'Contact and links',
};

export const categoryWeight = (category: CategoryId) =>
  Object.values(CHECK_WEIGHTS[category] as Record<string, number>).reduce((sum, w) => sum + w, 0);

// Guidance bands for this application, not industry standards.
export const BANDS = [
  { min: 85, id: 'strong', label: 'Strong readiness indicators' },
  { min: 70, id: 'good', label: 'Good foundation, with improvements recommended' },
  { min: 50, id: 'fair', label: 'Several improvements recommended' },
  { min: 0, id: 'weak', label: 'Significant improvements recommended' },
] as const;
export type BandId = (typeof BANDS)[number]['id'];
export const bandFor = (score: number) => BANDS.find((b) => score >= b.min)!;

// Below this many words the text is treated as not (or not properly) extracted.
export const MIN_WORDS = 40;

export type CheckStatus = 'pass' | 'partial' | 'fail' | 'not_applicable' | 'not_evaluated';
export type Severity = 'high' | 'medium' | 'low';

export interface CheckResult {
  id: string;
  category: CategoryId;
  title: string;
  status: CheckStatus;
  earned: number;
  available: number;
  detail: string;
}

export interface Recommendation {
  id: string;
  checkId: string;
  category: CategoryId;
  severity: Severity;
  title: string;
  explanation: string;
  whyItMatters: string;
  action: string;
  example: string | null;
}

export interface CategoryResult {
  id: CategoryId;
  name: string;
  earned: number;
  available: number;
  evaluated: boolean;
}

export interface AtsResult {
  rulesVersion: string;
  // null when the evaluation is incomplete (too little text, or structured analysis unavailable).
  score: number | null;
  band: { id: BandId; label: string } | null;
  complete: boolean;
  incompleteReason: string | null;
  categories: CategoryResult[];
  checks: CheckResult[];
  strengths: string[];
  recommendations: Recommendation[];
  stats: { wordCount: number; lineCount: number; sectionsFound: string[] };
}

export interface AtsInput {
  text: string;
  // The existing structured analysis; null when it could not be produced.
  structured: StructuredResume | null;
}

interface Finding {
  status: CheckStatus;
  earned: number;
  detail: string;
  strength?: string;
  issue?: Omit<Recommendation, 'id' | 'checkId' | 'category'>;
}

const words = (text: string) => text.match(/[\p{L}\p{N}][\p{L}\p{N}'’.+#-]*/gu) ?? [];
const BULLET_RE = /^\s*(?:[-*•▪◦·‣–]|\d{1,2}[.)])\s+/;
const EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}/;
// Anything that looks like an attempt at an e-mail address.
const EMAIL_LIKE_RE = /\S+@\S*/g;
const PHONE_RE = /\+?\(?\d[\d\s().-]{7,18}\d/g;
const URL_LIKE_RE = /(?:https?:?\/{0,2}|www[.,])\S+|\b(?:linkedin|github)\s?\.\s?com\S*/gi;

// "j***@example.com": enough to recognise, without repeating the address.
const maskEmail = (value: string) => value.replace(/^([^@]?)[^@]*/, '$1***').slice(0, 60);

const isPhone = (candidate: string) => {
  const digits = candidate.replace(/\D/g, '');
  const groups = candidate.match(/\d+/g) ?? [];
  // Year ranges such as "2016 - 2020" are not phone numbers.
  return digits.length >= 10 && digits.length <= 15 && !groups.every((g) => /^(19|20)\d\d$/.test(g));
};

const MONTHS = 'jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec';
const MONTHS_FULL = 'january|february|march|april|may|june|july|august|september|october|november|december';
const DATE_TOKEN = `(?:(?:${MONTHS_FULL}|${MONTHS})\\.?\\s+\\d{4}|\\d{1,2}[/.-]\\d{4}|\\d{4}[/.-]\\d{1,2}|\\d{4})`;
const DATE_RANGE_RE = new RegExp(`(${DATE_TOKEN})\\s*(?:-|–|—|to)\\s*(${DATE_TOKEN}|present|current|now|till date|ongoing)`, 'gi');

type DateStyle = 'month-short' | 'month-full' | 'numeric' | 'year';
const dateStyle = (token: string): { style: DateStyle; valid: boolean } => {
  const t = token.toLowerCase().replace(/\.(?=\s)/, '');
  // "May 2022" is both the short and the full form, so it fits either style.
  if (/^may\s+\d{4}$/.test(t)) return { style: 'year', valid: true };
  if (new RegExp(`^(?:${MONTHS_FULL})\\s+\\d{4}$`).test(t)) return { style: 'month-full', valid: true };
  if (new RegExp(`^(?:${MONTHS})\\s+\\d{4}$`).test(t)) return { style: 'month-short', valid: true };
  const numeric = t.match(/^(\d{1,4})[/.-](\d{1,4})$/);
  if (numeric) {
    const [a, b] = [Number(numeric[1]), Number(numeric[2])];
    const month = numeric[1].length === 4 ? b : a;
    return { style: 'numeric', valid: month >= 1 && month <= 12 };
  }
  return { style: 'year', valid: true };
};

const issue = (
  severity: Severity,
  title: string,
  explanation: string,
  whyItMatters: string,
  action: string,
  example: string | null = null
) => ({ severity, title, explanation, whyItMatters, action, example });

// ---------------------------------------------------------------- structure

const checkName = (lines: string[], structured: StructuredResume | null): Finding => {
  const first = lines[0]?.trim() ?? '';
  const looksLikeName =
    // All-capital names ("PRIYA RAMAN") are fine; only a recognised section name is not a name.
    /^[\p{L}][\p{L}'’. -]{1,60}$/u.test(first) && first.split(/\s+/).length >= 2 && first.split(/\s+/).length <= 6 && !knownHeadingKind(first);
  if (structured?.personalInformation.name || looksLikeName) {
    return { status: 'pass', earned: CHECK_WEIGHTS.structure.name, detail: 'A name appears at the top.', strength: 'Your name is at the top of the resume.' };
  }
  return {
    status: 'fail',
    earned: 0,
    detail: 'No name could be identified at the top of the extracted text.',
    issue: issue(
      'medium',
      'Put your name on the first line',
      'The first line of the extracted text does not look like a name.',
      'Systems and recruiters expect the candidate name first; a missing or buried name can leave the profile unnamed.',
      'Make your full name the first line of the resume, as plain text (not inside an image or a header area).',
      'Priya Raman'
    ),
  };
};

const sectionHeadings = (lines: string[]) =>
  lines.map((l) => ({ line: l.trim(), kind: knownHeadingKind(l) })).filter((h): h is { line: string; kind: NonNullable<typeof h.kind> } => h.kind !== null);

const checkHeadings = (lines: string[]): Finding => {
  const found = sectionHeadings(lines);
  const w = CHECK_WEIGHTS.structure.headings;
  if (found.length >= 3) {
    return { status: 'pass', earned: w, detail: `${found.length} standard section headings found.`, strength: `Clear section headings: ${found.slice(0, 5).map((h) => h.line.replace(/:$/, '')).join(', ')}.` };
  }
  return {
    status: found.length === 2 ? 'partial' : 'fail',
    earned: found.length === 2 ? Math.round(w / 2) : 0,
    detail: `${found.length} standard section heading(s) found.`,
    issue: issue(
      found.length === 2 ? 'medium' : 'high',
      'Use recognizable section headings',
      found.length === 0
        ? 'No standard section headings (such as Experience, Education or Skills) were found in the extracted text.'
        : 'Only a few standard section headings were found.',
      'Applicant tracking systems use headings to decide which part of the resume is experience, education or skills.',
      'Give each section a short, common heading on its own line.',
      'Summary · Experience · Projects · Education · Skills'
    ),
  };
};

const checkCoreSections = (lines: string[]): Finding => {
  const w = CHECK_WEIGHTS.structure.coreSections;
  const kinds = new Set(sectionHeadings(lines).map((h) => h.kind));
  // Experience, projects or education: any of them is enough, so entry-level resumes are not penalised.
  if (kinds.has('entries')) return { status: 'pass', earned: w, detail: 'An experience, projects or education section is present.' };
  return {
    status: 'fail',
    earned: 0,
    detail: 'No experience, projects or education section was recognised.',
    issue: issue(
      'high',
      'Add an experience, projects or education section',
      'The resume has no recognisable section describing your work, projects or education.',
      'This is the part of a resume that systems and recruiters read most closely.',
      'Add the sections that apply to you. Without work experience, a Projects or Education section works well.',
      'PROJECTS\nInventory Tracker\n- Built a stock-tracking web app with React and Node.js'
    ),
  };
};

const checkSectionContent = (lines: string[]): Finding => {
  const w = CHECK_WEIGHTS.structure.sectionContent;
  const empty: string[] = [];
  lines.forEach((line, i) => {
    // The first line is the name, never a section, even when written in capitals.
    if (i === 0 || !headingKind(line)) return;
    const next = lines.slice(i + 1).find((l) => l.trim());
    if (!next || headingKind(next)) empty.push(line.trim().replace(/:$/, ''));
  });
  if (empty.length === 0) return { status: 'pass', earned: w, detail: 'Every section heading is followed by content.' };
  return {
    status: empty.length === 1 ? 'partial' : 'fail',
    earned: empty.length === 1 ? 3 : 0,
    detail: `Heading(s) without content: ${empty.join(', ')}.`,
    issue: issue(
      'low',
      'Fill in or remove empty sections',
      `These headings have no content under them in the extracted text: ${empty.join(', ')}.`,
      'An empty section makes the resume look incomplete, or suggests content was lost during extraction.',
      'Add the content that belongs there, or remove the heading. If the content is in your file, check that it is real text and not an image.'
    ),
  };
};

// ------------------------------------------------------------------ content

const allBullets = (s: StructuredResume) => [...s.experience.flatMap((e) => e.description), ...s.projects.flatMap((p) => p.description)];

const checkSummary = (s: StructuredResume): Finding => {
  const w = CHECK_WEIGHTS.content.summary;
  const count = words(s.summary ?? '').length;
  if (count >= 12) return { status: 'pass', earned: w, detail: `A ${count}-word summary is present.`, strength: 'A professional summary introduces your profile.' };
  return {
    status: count > 0 ? 'partial' : 'fail',
    earned: count > 0 ? 3 : 0,
    detail: count > 0 ? `The summary is very short (${count} words).` : 'No professional summary was found.',
    issue: issue(
      'low',
      count > 0 ? 'Expand your professional summary' : 'Consider adding a short professional summary',
      count > 0 ? 'Your summary is only a few words long.' : 'The resume has no summary or profile section.',
      'A two- or three-sentence summary tells a reader (and a search) what kind of role you are aiming for.',
      'Write 2–3 sentences about your focus, your strongest relevant skills and the kind of role you want. Only include what is true.',
      'Backend developer with 3 years of experience building REST APIs in Node.js and MySQL, looking for a backend role in a product team.'
    ),
  };
};

const checkExperienceDetail = (s: StructuredResume): Finding => {
  const w = CHECK_WEIGHTS.content.experienceDetail;
  if (s.experience.length === 0) {
    return { status: 'not_applicable', earned: w, detail: 'No work experience entries; not penalised (projects and education are checked instead).' };
  }
  const described = s.experience.filter((e) => e.description.length > 0).length;
  const share = described / s.experience.length;
  if (share >= 0.8) return { status: 'pass', earned: w, detail: `${described} of ${s.experience.length} roles have descriptions.`, strength: 'Your roles include descriptions of what you did.' };
  return {
    status: share >= 0.5 ? 'partial' : 'fail',
    earned: share >= 0.5 ? 4 : 0,
    detail: `${described} of ${s.experience.length} roles have descriptions.`,
    issue: issue(
      share >= 0.5 ? 'medium' : 'high',
      'Describe each role',
      `${s.experience.length - described} of your ${s.experience.length} roles have no description lines.`,
      'A job title alone gives little to match against; descriptions are where your skills and responsibilities show.',
      'Add 2–4 bullet points per role about what you were responsible for and what you delivered.',
      '- Built and maintained REST APIs for the orders service using Node.js and MySQL'
    ),
  };
};

const checkActionLanguage = (s: StructuredResume): Finding => {
  const w = CHECK_WEIGHTS.content.actionLanguage;
  const bullets = allBullets(s);
  if (bullets.length < 3) return { status: 'not_applicable', earned: w, detail: 'Fewer than three description lines to assess.' };
  const weak = bullets.filter((b) => WEAK_OPENERS.test(b.trim()));
  const share = weak.length / bullets.length;
  if (share <= 0.2) return { status: 'pass', earned: w, detail: `${bullets.length - weak.length} of ${bullets.length} lines start with specific wording.`, strength: 'Most description lines say specifically what you did.' };
  return {
    status: share <= 0.5 ? 'partial' : 'fail',
    earned: share <= 0.5 ? 4 : 0,
    detail: `${weak.length} of ${bullets.length} description lines start with general phrases such as "Worked on" or "Helped".`,
    issue: issue(
      'medium',
      'Make vague description lines specific',
      `${weak.length} of your ${bullets.length} description lines start with general phrases such as "Worked on", "Helped" or "Involved in".`,
      'Specific responsibilities and outcomes are easier to match to a job and more convincing to read.',
      'Rewrite those lines to say what you actually did and, where you know it, the result. Keep them truthful: if you helped, say what your part was.',
      '"Worked on the payment API" → "Added refund support to the payment API"'
    ),
  };
};

const checkMeasurableResults = (s: StructuredResume): Finding => {
  const w = CHECK_WEIGHTS.content.measurableResults;
  const bullets = s.experience.flatMap((e) => e.description);
  if (bullets.length < 4) return { status: 'not_applicable', earned: w, detail: 'Only checked when there are several work-experience lines.' };
  if (bullets.some((b) => /\d|%/.test(b))) return { status: 'pass', earned: w, detail: 'Some experience lines include figures.', strength: 'Some achievements include concrete figures.' };
  return {
    status: 'partial',
    earned: 2,
    detail: 'No experience line includes a number, percentage or other figure.',
    issue: issue(
      'low',
      'Add real figures where you have them',
      'None of your experience lines include a number, percentage, size or time frame.',
      'Concrete figures make achievements easier to understand. They are optional: not every role has measurable results.',
      'Where you genuinely know a figure (users, requests, time saved, team size), add it. Never estimate or invent numbers.',
      '- Reduced report generation time from 10 minutes to 2 by caching queries'
    ),
  };
};

const checkDatesAndTitles = (s: StructuredResume): Finding => {
  const w = CHECK_WEIGHTS.content.datesAndTitles;
  if (s.experience.length === 0) return { status: 'not_applicable', earned: w, detail: 'No work experience entries.' };
  const incomplete = s.experience.filter((e) => !e.title || !e.startDate);
  if (incomplete.length === 0) return { status: 'pass', earned: w, detail: 'Every role has a title and a start date.', strength: 'Every role has a clear title and dates.' };
  return {
    status: incomplete.length < s.experience.length ? 'partial' : 'fail',
    earned: incomplete.length < s.experience.length ? 2 : 0,
    detail: `${incomplete.length} of ${s.experience.length} roles have no recognisable title or start date.`,
    issue: issue(
      'medium',
      'Give every role a title and dates',
      `${incomplete.length} of your ${s.experience.length} roles have no recognisable job title or start date.`,
      'Titles and dates are used to work out what you did and for how long.',
      'Put the job title, employer and date range on their own lines at the start of each role.',
      'Software Developer\nABC Technologies\nJan 2022 – Dec 2025'
    ),
  };
};

const checkSkills = (s: StructuredResume, lines: string[]): Finding => {
  const w = CHECK_WEIGHTS.content.skills;
  const count = Object.values(s.skills).reduce((n, list) => n + list.length, 0);
  const hasHeading = sectionHeadings(lines).some((h) => h.kind === 'skills');
  if (count >= 5 && hasHeading) return { status: 'pass', earned: w, detail: `${count} skills recognised, with a skills section.`, strength: `A skills section lists ${count} recognisable skills.` };
  if (count >= 5) {
    return {
      status: 'partial',
      earned: 2,
      detail: `${count} skills recognised, but there is no skills section.`,
      issue: issue(
        'medium',
        'Add a clearly labelled Skills section',
        'Your resume mentions skills, but they are not collected under a Skills heading.',
        'A skills section is the easiest place for systems and recruiters to find your skills.',
        'Add a "Skills" section listing the tools and technologies you actually use, separated by commas.',
        'SKILLS\nJavaScript, Node.js, MySQL, Git, Docker'
      ),
    };
  }
  return {
    status: 'fail',
    earned: hasHeading ? 2 : 0,
    detail: `Only ${count} recognisable skill(s) found.`,
    issue: issue(
      'medium',
      'List your skills clearly',
      `Only ${count} recognisable skill(s) were found${hasHeading ? ', even though there is a skills section' : ''}.`,
      'Skills are one of the main things searched for; skills written in unusual ways or inside sentences can be missed.',
      'List the skills you actually have under a "Skills" heading, using their common names.',
      'SKILLS\nPython, SQL, Excel, Tableau'
    ),
  };
};

// ------------------------------------------------------------------ parsing

const checkTextAmount = (wordCount: number): Finding => {
  const w = CHECK_WEIGHTS.parsing.textAmount;
  if (wordCount >= 150) return { status: 'pass', earned: w, detail: `${wordCount} words extracted.`, strength: 'The resume text was extracted in full.' };
  if (wordCount >= 80) {
    return {
      status: 'partial',
      earned: 5,
      detail: `Only ${wordCount} words extracted.`,
      issue: issue(
        'medium',
        'The resume looks short',
        `Only ${wordCount} words of text were found.`,
        'A very short resume, or one whose text was only partly extracted, gives little to match against.',
        'Check that all of your content is real text (not images), and consider adding detail to your experience, projects or skills.'
      ),
    };
  }
  return {
    status: 'fail',
    earned: wordCount >= MIN_WORDS ? 2 : 0,
    detail: `Only ${wordCount} words extracted.`,
    issue: issue(
      'high',
      'Very little text could be read',
      wordCount === 0 ? 'No readable text was extracted from this resume.' : `Only ${wordCount} words of text were extracted from this resume.`,
      'If text cannot be extracted, an applicant tracking system cannot read it either.',
      'Export your resume as a text-based PDF from Word or Google Docs (not a scan or a photo), then upload it again.'
    ),
  };
};

const checkCleanText = (text: string): Finding => {
  const w = CHECK_WEIGHTS.parsing.cleanText;
  const garbled = (text.match(/�|\(cid:\d+\)|[-]/g) ?? []).length;
  const spacedOut = (text.match(/(?:\b\p{L} ){5,}\p{L}\b/gu) ?? []).length;
  const wideGaps = text.split('\n').filter((l) => / {4,}\S/.test(l.trim())).length;
  if (garbled === 0 && spacedOut === 0 && wideGaps < 3) return { status: 'pass', earned: w, detail: 'No unreadable characters or broken spacing found.' };
  const severe = garbled >= 3;
  const problems = [
    garbled ? `${garbled} unreadable character(s)` : null,
    spacedOut ? `${spacedOut} word(s) with letters split by spaces` : null,
    wideGaps >= 3 ? `${wideGaps} lines with large gaps between words` : null,
  ].filter(Boolean);
  return {
    status: severe ? 'fail' : 'partial',
    earned: severe ? 0 : 3,
    detail: `Found ${problems.join(', ')}.`,
    issue: issue(
      severe ? 'high' : 'medium',
      'Some text may not be read correctly',
      `The extracted text contains ${problems.join(', ')}.`,
      'This usually comes from special fonts, symbols or complex layouts; affected words may be misread or missed.',
      'Use a standard font, avoid decorative symbols and letter spacing, and check the extracted text (Resume Sections on the resume page) after uploading.'
    ),
  };
};

const checkParagraphLength = (lines: string[]): Finding => {
  const w = CHECK_WEIGHTS.parsing.paragraphLength;
  const long = lines.filter((l) => words(l).length > 80).length;
  if (long === 0) return { status: 'pass', earned: w, detail: 'No overly long paragraphs.' };
  return {
    status: long === 1 ? 'partial' : 'fail',
    earned: long === 1 ? 3 : 0,
    detail: `${long} paragraph(s) longer than 80 words.`,
    issue: issue(
      'low',
      'Break up long paragraphs',
      `${long} block(s) of text run longer than 80 words without a line break.`,
      'Long paragraphs are hard to scan, and missing line breaks can blur where one section ends and the next begins.',
      'Split long descriptions into short bullet points, one idea per line.'
    ),
  };
};

const checkDateFormats = (text: string): Finding => {
  const w = CHECK_WEIGHTS.parsing.dateFormats;
  const tokens = [...text.matchAll(DATE_RANGE_RE)].flatMap((m) => [m[1], m[2]]).filter((t) => /\d/.test(t));
  if (tokens.length === 0) return { status: 'not_applicable', earned: w, detail: 'No date ranges found.' };
  const styles = tokens.map(dateStyle);
  const invalid = tokens.filter((_, i) => !styles[i].valid);
  // Year-only dates mix with any style (common for education); other styles should not be mixed.
  const kinds = [...new Set(styles.filter((s) => s.valid && s.style !== 'year').map((s) => s.style))];
  if (invalid.length === 0 && kinds.length <= 1) return { status: 'pass', earned: w, detail: 'Dates use one consistent format.', strength: 'Dates are written consistently.' };
  if (invalid.length > 0) {
    return {
      status: 'fail',
      earned: 0,
      detail: `Date(s) that cannot be valid: ${invalid.slice(0, 3).join(', ')}.`,
      issue: issue(
        'medium',
        'Correct invalid dates',
        `These dates cannot be valid: ${invalid.slice(0, 3).join(', ')}.`,
        'Dates are used to work out how long you held each role; an invalid date may be ignored or misread.',
        'Fix the dates and use one format throughout, such as "Jan 2022 – Mar 2024".'
      ),
    };
  }
  const minorOnly = kinds.every((k) => k === 'month-short' || k === 'month-full');
  return {
    status: 'partial',
    earned: minorOnly ? 4 : 2,
    detail: `Dates are written in ${kinds.length} different formats.`,
    issue: issue(
      minorOnly ? 'low' : 'medium',
      'Use one date format',
      'Your dates mix formats (for example "Jan 2022" and "01/2022").',
      'Consistent dates are easier for systems to interpret and look more polished.',
      'Pick one format and use it everywhere.',
      'Jan 2022 – Mar 2024'
    ),
  };
};

// ------------------------------------------------------------------ contact

const checkEmail = (text: string): Finding => {
  const w = CHECK_WEIGHTS.contact.email;
  if (EMAIL_RE.test(text)) return { status: 'pass', earned: w, detail: 'An e-mail address is present.', strength: 'Your e-mail address can be found.' };
  const malformed = (text.match(EMAIL_LIKE_RE) ?? []).filter((t) => t.length > 1);
  return {
    status: 'fail',
    earned: 0,
    detail: malformed.length ? `An e-mail address looks malformed (${maskEmail(malformed[0])}).` : 'No e-mail address was found.',
    issue: malformed.length
      ? issue(
          'high',
          'Check your e-mail address',
          `Something that looks like an e-mail address could not be read as one (${maskEmail(malformed[0])}).`,
          'A recruiter must be able to contact you; a mistyped address cannot be used.',
          'Correct the address and write it as plain text, for example name@example.com.'
        )
      : issue(
          'high',
          'Add an e-mail address',
          'No e-mail address was found in the extracted text.',
          'Recruiters need a way to contact you; contact details are usually read from the top of the resume.',
          'Add your e-mail address as plain text near your name (not in an image or a page header).',
          'priya.raman@example.com | +91 90000 00000'
        ),
  };
};

const checkPhone = (text: string): Finding => {
  const w = CHECK_WEIGHTS.contact.phone;
  if ((text.match(PHONE_RE) ?? []).some(isPhone)) return { status: 'pass', earned: w, detail: 'A phone number is present.' };
  return {
    status: 'fail',
    earned: 0,
    detail: 'No phone number was found.',
    issue: issue(
      'medium',
      'Consider adding a phone number',
      'No phone number was found in the extracted text.',
      'Many recruiters prefer to call; a phone number is a standard part of resume contact details.',
      'If you are comfortable sharing it, add your phone number with the country code next to your e-mail address.'
    ),
  };
};

const malformedUrl = (url: string) =>
  /^https?:\/?(?!\/)/i.test(url) || /^https?\/\//i.test(url) || /^https?:\/\/\/+/i.test(url) || /^www,/i.test(url) || /\s/.test(url) || /\.\./.test(url);

const checkLinks = (text: string): Finding => {
  const w = CHECK_WEIGHTS.contact.links;
  const links = (text.match(URL_LIKE_RE) ?? []).map((l) => l.replace(/[),.;]+$/, ''));
  if (links.length === 0) return { status: 'not_applicable', earned: w, detail: 'No web links found (they are optional).' };
  const bad = links.filter(malformedUrl);
  if (bad.length === 0) return { status: 'pass', earned: w, detail: `${links.length} link(s) look well-formed.`, strength: 'Your links look well-formed.' };
  return {
    status: 'fail',
    earned: 0,
    detail: `${bad.length} link(s) look malformed.`,
    issue: issue(
      'medium',
      'Check your links',
      `These links look malformed or were broken during extraction: ${bad.slice(0, 3).map((b) => b.slice(0, 80)).join(', ')}.`,
      'A broken link cannot be followed, and a link split by spaces may not be recognised at all.',
      'Write each link in full on one line, without spaces, for example https://github.com/your-name or linkedin.com/in/your-name.'
    ),
  };
};

// ------------------------------------------------------------------ result

interface CheckDef {
  id: string;
  category: CategoryId;
  title: string;
  available: number;
  // null: needs the structured analysis, which is unavailable.
  run: (() => Finding) | null;
}

const SEVERITY_ORDER: Record<Severity, number> = { high: 0, medium: 1, low: 2 };

export const evaluateAtsReadiness = ({ text, structured }: AtsInput): AtsResult => {
  const lines = text.split('\n').filter((l) => l.trim());
  const wordCount = words(text).length;
  const insufficient = wordCount < MIN_WORDS;
  const s = structured;
  const W = CHECK_WEIGHTS;

  const defs: CheckDef[] = [
    { id: 'name', category: 'structure', title: 'Name at the top', available: W.structure.name, run: () => checkName(lines, s) },
    { id: 'headings', category: 'structure', title: 'Recognizable section headings', available: W.structure.headings, run: () => checkHeadings(lines) },
    { id: 'coreSections', category: 'structure', title: 'Experience, projects or education section', available: W.structure.coreSections, run: () => checkCoreSections(lines) },
    { id: 'sectionContent', category: 'structure', title: 'Sections have content', available: W.structure.sectionContent, run: () => checkSectionContent(lines) },
    { id: 'summary', category: 'content', title: 'Professional summary', available: W.content.summary, run: s ? () => checkSummary(s) : null },
    { id: 'experienceDetail', category: 'content', title: 'Roles have descriptions', available: W.content.experienceDetail, run: s ? () => checkExperienceDetail(s) : null },
    { id: 'actionLanguage', category: 'content', title: 'Specific, action-oriented descriptions', available: W.content.actionLanguage, run: s ? () => checkActionLanguage(s) : null },
    { id: 'measurableResults', category: 'content', title: 'Concrete results where available', available: W.content.measurableResults, run: s ? () => checkMeasurableResults(s) : null },
    { id: 'datesAndTitles', category: 'content', title: 'Job titles and dates', available: W.content.datesAndTitles, run: s ? () => checkDatesAndTitles(s) : null },
    { id: 'skills', category: 'content', title: 'Skills presented clearly', available: W.content.skills, run: s ? () => checkSkills(s, lines) : null },
    { id: 'textAmount', category: 'parsing', title: 'Text extracted', available: W.parsing.textAmount, run: () => checkTextAmount(wordCount) },
    { id: 'cleanText', category: 'parsing', title: 'Readable characters and spacing', available: W.parsing.cleanText, run: () => checkCleanText(text) },
    { id: 'paragraphLength', category: 'parsing', title: 'Paragraph length', available: W.parsing.paragraphLength, run: () => checkParagraphLength(lines) },
    { id: 'dateFormats', category: 'parsing', title: 'Consistent, valid date formats', available: W.parsing.dateFormats, run: () => checkDateFormats(text) },
    { id: 'email', category: 'contact', title: 'E-mail address', available: W.contact.email, run: () => checkEmail(text) },
    { id: 'phone', category: 'contact', title: 'Phone number', available: W.contact.phone, run: () => checkPhone(text) },
    { id: 'links', category: 'contact', title: 'Well-formed links', available: W.contact.links, run: () => checkLinks(text) },
  ];

  const checks: CheckResult[] = [];
  const strengths: string[] = [];
  const recommendations: Recommendation[] = [];
  for (const def of defs) {
    // With almost no text, everything else would fail for the same reason: only the text check is reported.
    const runnable = def.run && (!insufficient || def.id === 'textAmount');
    if (!runnable) {
      checks.push({
        id: def.id,
        category: def.category,
        title: def.title,
        status: 'not_evaluated',
        earned: 0,
        available: def.available,
        detail: insufficient ? 'Not evaluated: too little text was extracted.' : 'Not evaluated: the structured analysis is unavailable.',
      });
      continue;
    }
    const f = def.run!();
    checks.push({ id: def.id, category: def.category, title: def.title, status: f.status, earned: f.earned, available: def.available, detail: f.detail });
    if (f.strength && f.status === 'pass') strengths.push(f.strength);
    if (f.issue && f.earned < def.available) recommendations.push({ id: `rec-${def.id}`, checkId: def.id, category: def.category, ...f.issue });
  }

  const lost = (r: Recommendation) => {
    const c = checks.find((x) => x.id === r.checkId)!;
    return c.available - c.earned;
  };
  recommendations.sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity] || lost(b) - lost(a));

  const categories: CategoryResult[] = (Object.keys(CATEGORY_NAMES) as CategoryId[]).map((id) => {
    const own = checks.filter((c) => c.category === id);
    return {
      id,
      name: CATEGORY_NAMES[id],
      earned: own.reduce((n, c) => n + c.earned, 0),
      available: categoryWeight(id),
      evaluated: own.every((c) => c.status !== 'not_evaluated'),
    };
  });

  const complete = checks.every((c) => c.status !== 'not_evaluated');
  const score = complete ? categories.reduce((n, c) => n + c.earned, 0) : null;
  const band = score === null ? null : (({ id, label }) => ({ id, label }))(bandFor(score));
  return {
    rulesVersion: RULES_VERSION,
    score,
    band,
    complete,
    incompleteReason: complete
      ? null
      : insufficient
        ? 'Too little text could be extracted from this resume to evaluate it.'
        : 'The structured resume analysis is unavailable right now, so content checks were skipped. Try again later.',
    categories,
    checks,
    strengths,
    recommendations,
    stats: { wordCount, lineCount: lines.length, sectionsFound: sectionHeadings(lines).map((h) => h.line.replace(/:$/, '')) },
  };
};
