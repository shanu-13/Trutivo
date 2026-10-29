import type { JobRequirements, MatchingResult, StructuredResume } from './ai.service';
import { normalizeLabel } from './resume-comparison.service';

// Job-specific tailoring suggestions (Step 9C). This is a deterministic,
// rule-based engine: no language model is used, and no text is generated
// beyond fixed rewording rules. Every suggestion replaces one existing line of
// the resume text and must pass `introducesNewContent`, so it can only reorder,
// shorten or reword what is already there. The job description decides what is
// relevant; it is never a source of facts about the user.
//
// Resume and job text are data only: nothing in them is interpreted as an instruction.

export type SuggestionCategory = 'skills' | 'experience' | 'projects' | 'structure';

export interface SuggestionDraft {
  category: SuggestionCategory;
  section: 'skills' | 'experience' | 'projects';
  lineIndex: number;
  originalText: string;
  // Empty: remove the line.
  suggestedText: string;
  entryLabel: string | null;
  reason: string;
  relatedRequirements: string[];
}

export type CoverageStatus = 'supported' | 'partial' | 'not_found';

export interface RequirementCoverage {
  requirement: string;
  type: 'required_skill' | 'preferred_skill' | 'experience' | 'education';
  status: CoverageStatus;
  detail: string;
}

export interface TailoringNote {
  section: 'summary' | 'experience' | 'projects';
  lineIndex: number | null;
  lineText: string | null;
  message: string;
}

export interface TailoringInput {
  lines: string[];
  structured: StructuredResume;
  skillsSectionText: string | null;
  requirements: Pick<JobRequirements, 'requiredSkills' | 'preferredSkills'>;
  matching: MatchingResult;
}

export const MAX_LINE_LENGTH = 1000;

const BULLET_RE = /^(\s*(?:[-*•▪◦·‣–]|\d{1,2}[.)])\s+)/;
const splitBullet = (line: string) => {
  const m = line.match(BULLET_RE);
  return m ? { prefix: m[1], body: line.slice(m[1].length) } : { prefix: '', body: line };
};

const words = (text: string) => text.toLowerCase().match(/[a-z0-9]+(?:['’][a-z]+)?/g) ?? [];
const numbers = (text: string) => text.match(/\d+(?:[.,]\d+)?/g) ?? [];

// "Responsible for developing X" -> "Developed X". Only verbs listed here are
// rewritten; anything else is left for the user. "Helped" or "involved in" are
// never upgraded to a stronger claim.
const PAST_TENSE: Record<string, string> = {
  analyzing: 'Analyzed', automating: 'Automated', building: 'Built', coordinating: 'Coordinated', creating: 'Created',
  debugging: 'Debugged', defining: 'Defined', delivering: 'Delivered', deploying: 'Deployed', designing: 'Designed',
  developing: 'Developed', documenting: 'Documented', establishing: 'Established', handling: 'Handled',
  implementing: 'Implemented', integrating: 'Integrated', leading: 'Led', maintaining: 'Maintained', managing: 'Managed',
  migrating: 'Migrated', monitoring: 'Monitored', optimizing: 'Optimized', organizing: 'Organized', overseeing: 'Oversaw',
  planning: 'Planned', preparing: 'Prepared', reviewing: 'Reviewed', running: 'Ran', supporting: 'Supported',
  testing: 'Tested', training: 'Trained', troubleshooting: 'Troubleshot', writing: 'Wrote',
};
// Words a rewrite may introduce: the past-tense verbs and the plain replacements below.
const REWRITE_VOCABULARY = new Set([...Object.values(PAST_TENSE).map((v) => v.toLowerCase()), 'to', 'use', 'used', 'using', 'uses']);

interface Rule {
  pattern: RegExp;
  replace: string | ((...args: string[]) => string);
  explanation: string;
}

const RULES: Rule[] = [
  {
    pattern: /^(?:was\s+)?(?:responsible for|tasked with|in charge of)\s+([a-z]+ing)\b/i,
    replace: (match: string, gerund: string) => PAST_TENSE[gerund.toLowerCase()] ?? match,
    explanation: 'starts with the action instead of a phrase like "Responsible for"',
  },
  { pattern: /\bsuccessfully\s+/gi, replace: '', explanation: 'removes "successfully"' },
  { pattern: /\b(?:various|numerous)\s+/gi, replace: '', explanation: 'removes vague words such as "various"' },
  { pattern: /\bvery\s+/gi, replace: '', explanation: 'removes "very"' },
  { pattern: /\bin order to\b/gi, replace: 'to', explanation: '"in order to" becomes "to"' },
  {
    pattern: /\butiliz(e|es|ed|ing)\b/gi,
    replace: (_m: string, ending: string) => ({ e: 'use', es: 'uses', ed: 'used', ing: 'using' })[ending.toLowerCase()] ?? _m,
    explanation: '"utilize" becomes "use"',
  },
  { pattern: /\b(\w+)\s+\1\b/gi, replace: '$1', explanation: 'removes a repeated word' },
];

// True when `suggested` contains any word or number that `original` does not,
// other than the fixed rewording vocabulary. Used to reject any suggestion that
// could add a claim (a skill, a metric, a technology) to the resume.
export const introducesNewContent = (original: string, suggested: string) => {
  const allowed = new Set(words(original));
  if (words(suggested).some((w) => !allowed.has(w) && !REWRITE_VOCABULARY.has(w))) return true;
  const originalNumbers = new Set(numbers(original));
  return numbers(suggested).some((n) => !originalNumbers.has(n));
};

const capitalize = (text: string) => (text ? text[0].toUpperCase() + text.slice(1) : text);

// Applies the rewording rules to one bullet's text. Returns the new text and
// what changed, or null if nothing did.
export const rewordLine = (body: string): { text: string; changes: string[] } | null => {
  let text = body;
  const changes: string[] = [];
  for (const rule of RULES) {
    const next = text.replace(rule.pattern, rule.replace as never);
    if (next !== text) {
      text = next;
      changes.push(rule.explanation);
    }
  }
  text = capitalize(text.replace(/\s{2,}/g, ' ').trim());
  if (changes.length === 0 || text === body.trim() || !text) return null;
  return { text, changes };
};

const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
// Whole-word, case-insensitive mention of a skill name in a piece of text.
export const mentionsSkill = (text: string, skill: string) =>
  new RegExp(`(^|[^A-Za-z0-9+#])${escapeRegExp(skill)}($|[^A-Za-z0-9+#])`, 'i').test(text);

const compact = (s: string) => normalizeLabel(s).replace(/[^a-z0-9+#]/g, '');

// Lines of the resume text that make up the skills section.
const skillsSectionLines = (lines: string[], sectionText: string | null) => {
  if (!sectionText) return [];
  const sectionLines = new Set(sectionText.split('\n').map((l) => l.trim()).filter(Boolean));
  return lines.map((line, index) => ({ line, index })).filter(({ line }) => sectionLines.has(line.trim()));
};

// Splits "A, B, C" (or | ; •) into items; null unless it is clearly a list.
const splitSkillList = (body: string) => {
  const separator = [', ', ',', ' | ', '|', '; ', ';', ' • '].find((s) => body.includes(s.trim()));
  if (!separator) return null;
  const items = body.split(new RegExp(`\\s*${escapeRegExp(separator.trim())}\\s*`)).map((s) => s.trim());
  if (items.length < 3 || items.some((s) => !s || s.length > 60)) return null;
  const joiner = { ',': ', ', '|': ' | ', ';': '; ', '•': ' • ' }[separator.trim()] ?? ', ';
  return { items, separator: joiner };
};

const skillOrderSuggestions = (input: TailoringInput): SuggestionDraft[] => {
  const required = input.matching.skills.required.matched;
  const preferred = input.matching.skills.preferred.matched;
  const rank = (item: string) => {
    const c = compact(item.replace(/^[^:]{1,40}:\s*/, ''));
    if (required.some((s) => compact(s) === c)) return 0;
    if (preferred.some((s) => compact(s) === c)) return 1;
    return 2;
  };
  const out: SuggestionDraft[] = [];
  for (const { line, index } of skillsSectionLines(input.lines, input.skillsSectionText)) {
    const { prefix, body } = splitBullet(line);
    // "Languages: Python, Go, Rust" keeps its label in place.
    const labelled = body.match(/^([^:,]{1,40}):\s*(.+)$/);
    const head = labelled ? `${labelled[1]}: ` : '';
    const list = splitSkillList(labelled ? labelled[2] : body);
    if (!list) continue;
    const ordered = list.items.map((item, i) => ({ item, i, r: rank(item) })).sort((a, b) => a.r - b.r || a.i - b.i);
    if (ordered.every((o, i) => o.i === i)) continue;
    const suggested = `${prefix}${head}${ordered.map((o) => o.item).join(list.separator)}`;
    // Same items, only reordered.
    if ([...list.items].sort().join('\n') !== ordered.map((o) => o.item).sort().join('\n')) continue;
    const relevant = ordered.filter((o) => o.r < 2).map((o) => o.item);
    out.push({
      category: 'skills',
      section: 'skills',
      lineIndex: index,
      originalText: line,
      suggestedText: suggested,
      entryLabel: labelled ? labelled[1] : null,
      reason: `Moves the skills this job asks for (${relevant.join(', ')}) to the front. No skills are added or removed.`,
      relatedRequirements: relevant,
    });
  }
  return out;
};

const entryLabelOf = (entry: { title?: string | null; company?: string | null; name?: string | null }) =>
  [entry.title, entry.company].filter(Boolean).join(' at ') || entry.name || null;

// Finds the resume line holding each description item (each line used once).
const locateDescriptionLines = (lines: string[], entries: { description: string[]; label: string | null }[]) => {
  const used = new Set<number>();
  const found: { index: number; label: string | null }[] = [];
  for (const entry of entries) {
    for (const item of entry.description) {
      const index = lines.findIndex((line, i) => !used.has(i) && splitBullet(line).body.trim() === item.trim());
      if (index >= 0) {
        used.add(index);
        found.push({ index, label: entry.label });
      }
    }
  }
  return found;
};

// Openers that say little about what the person did (shared with the ATS readiness checks).
export const WEAK_OPENERS = /^(?:worked (?:on|with)|helped(?: to)?|assisted (?:with|in)|involved in|was involved in|participated in|duties included|tasks included)\b/i;

export const buildTailoring = (input: TailoringInput) => {
  const jobSkills = [...input.requirements.requiredSkills, ...input.requirements.preferredSkills];
  const suggestions: SuggestionDraft[] = [...skillOrderSuggestions(input)];
  const notes: TailoringNote[] = [];

  const sources = [
    {
      section: 'experience' as const,
      found: locateDescriptionLines(
        input.lines,
        input.structured.experience.map((e) => ({ description: e.description, label: entryLabelOf(e) }))
      ),
    },
    {
      section: 'projects' as const,
      found: locateDescriptionLines(
        input.lines,
        input.structured.projects.map((p) => ({ description: p.description, label: p.name }))
      ),
    },
  ];

  const seen = new Map<string, number>();
  for (const { section, found } of sources) {
    for (const { index, label } of found) {
      const line = input.lines[index];
      const { prefix, body } = splitBullet(line);
      const related = jobSkills.filter((skill) => mentionsSkill(body, skill));

      // An exact repeat of an earlier bullet can be removed.
      const key = normalizeLabel(body);
      if (key.length >= 15 && seen.has(key)) {
        suggestions.push({
          category: 'structure',
          section,
          lineIndex: index,
          originalText: line,
          suggestedText: '',
          entryLabel: label,
          reason: `Repeats line ${seen.get(key)! + 1} word for word. Removing the repeat makes the section more concise.`,
          relatedRequirements: [],
        });
        continue;
      }
      seen.set(key, index);

      const reworded = rewordLine(body);
      if (reworded && !introducesNewContent(body, reworded.text)) {
        suggestions.push({
          category: section,
          section,
          lineIndex: index,
          originalText: line,
          suggestedText: `${prefix}${reworded.text}`,
          entryLabel: label,
          reason:
            `More concise wording with the same meaning: ${reworded.changes.join('; ')}.` +
            (related.length > 0 ? ` This line mentions ${related.join(', ')}, which the job asks for.` : ''),
          relatedRequirements: related,
        });
      } else if (WEAK_OPENERS.test(body.trim())) {
        notes.push({
          section,
          lineIndex: index,
          lineText: line,
          message:
            'Starts with a general phrase. If it is accurate, describe what you did yourself, starting with an action verb. ' +
            'This needs your own knowledge, so no wording is suggested.',
        });
      }
    }
  }

  // Projects that use what the job asks for (from the project's own technologies and text).
  const projects = input.structured.projects
    .map((p, order) => ({
      name: p.name,
      order,
      skills: jobSkills.filter(
        (skill) => p.technologies.some((t) => compact(t) === compact(skill)) || p.description.some((d) => mentionsSkill(d, skill))
      ),
    }))
    .filter((p) => p.name);
  const best = [...projects].sort((a, b) => b.skills.length - a.skills.length || a.order - b.order)[0];
  if (best && best.skills.length > 0 && best.order > 0) {
    notes.push({
      section: 'projects',
      lineIndex: null,
      lineText: null,
      message: `Consider listing "${best.name}" first: it uses ${best.skills.join(', ')}, which the job asks for. Projects are not reordered automatically.`,
    });
  }

  // A summary that does not mention any of the required skills the resume already shows.
  const summary = input.structured.summary;
  const shown = input.matching.skills.required.matched;
  if (summary && shown.length > 0 && !shown.some((s) => mentionsSkill(summary, s))) {
    notes.push({
      section: 'summary',
      lineIndex: null,
      lineText: null,
      message: `Your summary does not mention ${shown.slice(0, 5).join(', ')}, which your resume shows and the job requires. Consider mentioning the ones you actually use.`,
    });
  }

  suggestions.sort((a, b) => a.lineIndex - b.lineIndex);
  return { suggestions, notes, requirements: buildCoverage(input) };
};

// Which job requirements the resume supports, using the existing matching result.
export const buildCoverage = (input: TailoringInput): RequirementCoverage[] => {
  const evidence = [
    ...input.structured.experience.flatMap((e) => [e.title ?? '', ...e.description]),
    ...input.structured.projects.flatMap((p) => [p.name ?? '', ...p.description, ...p.technologies]),
  ].join('\n');
  const notFound = 'Not found in the resume. You may still have it: add it only if it is true.';
  const skill = (type: 'required_skill' | 'preferred_skill', comparison: MatchingResult['skills']['required']) => [
    ...comparison.matched.map((s): RequirementCoverage => {
      const inWork = mentionsSkill(evidence, s);
      return {
        requirement: s,
        type,
        status: inWork ? 'supported' : 'partial',
        detail: inWork
          ? 'Shown in your experience or projects.'
          : 'Listed in your resume, but not shown in your experience or projects. If you used it there, consider saying so.',
      };
    }),
    ...comparison.missing.map((s): RequirementCoverage => ({ requirement: s, type, status: 'not_found', detail: notFound })),
  ];

  const experience = input.matching.experience.requirements.map((r): RequirementCoverage => ({
    requirement: r.text,
    type: 'experience',
    status: r.meetsRequirement ? 'supported' : (r.candidateYears ?? 0) > 0 ? 'partial' : 'not_found',
    detail: r.meetsRequirement
      ? 'Your dated experience meets this.'
      : r.candidateYears
        ? `Your dated experience comes to about ${r.candidateYears} years.`
        : 'Not evident from the dated experience in the resume.',
  }));
  const education = input.matching.education.requirements.map((r): RequirementCoverage => ({
    requirement: r.text,
    type: 'education',
    status: r.meetsRequirement ? (r.fieldMatch === false ? 'partial' : 'supported') : r.candidateEducation ? 'partial' : 'not_found',
    detail: r.meetsRequirement
      ? r.fieldMatch === false
        ? 'Your degree level meets this, but the field may differ.'
        : 'Your education meets this.'
      : r.candidateEducation
        ? `Your resume lists ${r.candidateEducation}.`
        : 'Not evident from the education in the resume.',
  }));
  return [...skill('required_skill', input.matching.skills.required), ...skill('preferred_skill', input.matching.skills.preferred), ...experience, ...education];
};

export type ReviewStatus = 'pending' | 'accepted' | 'edited' | 'rejected';

export interface ReviewedSuggestion {
  id: string;
  lineIndex: number;
  originalText: string;
  suggestedText: string;
  editedText: string | null;
  status: ReviewStatus;
}

export interface PreviewLine {
  index: number;
  text: string;
  status: 'original' | 'revised' | 'removed';
  originalText: string | null;
  suggestionId: string | null;
}

// The resume text with only accepted (or edited and accepted) suggestions
// applied. A suggestion whose line no longer matches the resume text is skipped
// and reported, never applied to a different line.
export const assemblePreview = (lines: string[], suggestions: ReviewedSuggestion[]) => {
  const changes = new Map<number, ReviewedSuggestion>();
  const stale: string[] = [];
  for (const s of suggestions) {
    if (s.status !== 'accepted' && s.status !== 'edited') continue;
    if (lines[s.lineIndex] !== s.originalText || changes.has(s.lineIndex)) {
      stale.push(s.id);
      continue;
    }
    changes.set(s.lineIndex, s);
  }
  const preview: PreviewLine[] = lines.map((line, index) => {
    const s = changes.get(index);
    if (!s) return { index, text: line, status: 'original', originalText: null, suggestionId: null };
    const text = s.status === 'edited' ? (s.editedText ?? '') : s.suggestedText;
    return { index, text, status: text ? 'revised' : 'removed', originalText: line, suggestionId: s.id };
  });
  const text = preview.filter((l) => l.status !== 'removed').map((l) => l.text).join('\n');
  return { lines: preview, text, appliedCount: changes.size, staleSuggestionIds: stale };
};

// A user's own wording for one line: required, single line, bounded, no control characters.
export const validateEditedText = (value: unknown): { text: string } | { error: string } => {
  if (typeof value !== 'string') return { error: 'Edited text must be text' };
  const text = value.replace(/[ \t]+/g, ' ').trim();
  if (!text) return { error: 'Edited text cannot be empty' };
  if (text.length > MAX_LINE_LENGTH) return { error: `Edited text must be at most ${MAX_LINE_LENGTH} characters` };
  if (/[\u0000-\u001f\u007f]/.test(text)) return { error: 'Edited text must be a single line without control characters' };
  return { text };
};
