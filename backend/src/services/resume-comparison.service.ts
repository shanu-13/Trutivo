import type { StructuredResume } from './ai.service';

// Comparison of two versions of one resume (Step 9B). Everything here works on
// data that already exists: stored skills, stored extracted text, the existing
// rule-based structured analysis and saved match history. Nothing is generated,
// and an item that cannot be found in one version is never reported as removed
// unless that version's data is complete enough to say so.

// "  Node.JS " and "node.js" are the same skill.
export const normalizeLabel = (value: string | null | undefined) =>
  (value ?? '')
    .normalize('NFKC')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[.,;:]+$/, '')
    .toLowerCase();

export type Availability = 'available' | 'unavailable';

export interface ListComparison {
  status: Availability;
  // Why the comparison is unavailable (null when available).
  reason: string | null;
  added: string[];
  removed: string[];
  unchanged: string[];
}

const unavailable = (reason: string): ListComparison => ({ status: 'unavailable', reason, added: [], removed: [], unchanged: [] });

// Compares two lists of items identified by `key`. Items without a key cannot
// be identified and are left out. An empty side is treated as missing data,
// not as "everything was removed".
export const compareLists = <T>(
  older: T[] | null,
  newer: T[] | null,
  key: (item: T) => string,
  label: (item: T) => string,
  emptyReason: string
): ListComparison => {
  if (older === null || newer === null) return unavailable('Not available for both versions.');
  const index = (items: T[]) => {
    const map = new Map<string, string>();
    for (const item of items) {
      const k = key(item);
      if (k && !map.has(k)) map.set(k, label(item));
    }
    return map;
  };
  const a = index(older);
  const b = index(newer);
  if (a.size === 0 || b.size === 0) return unavailable(emptyReason);
  return {
    status: 'available',
    reason: null,
    added: [...b].filter(([k]) => !a.has(k)).map(([, v]) => v),
    removed: [...a].filter(([k]) => !b.has(k)).map(([, v]) => v),
    unchanged: [...b].filter(([k]) => a.has(k)).map(([, v]) => v),
  };
};

export const compareSkills = (older: string[] | null, newer: string[] | null) =>
  compareLists(older, newer, normalizeLabel, (s) => s.replace(/\s+/g, ' ').trim(), 'No skills were found in at least one of the versions.');

const joinKey = (...parts: (string | null)[]) => (parts.every((p) => !normalizeLabel(p)) ? '' : parts.map(normalizeLabel).join('|'));
const dates = (start: string | null, end: string | null, isCurrent: boolean) => {
  const range = [start, isCurrent ? 'Present' : end].filter(Boolean).join(' – ');
  return range ? ` (${range})` : '';
};

type Experience = StructuredResume['experience'][number];
type Education = StructuredResume['education'][number];
type Project = StructuredResume['projects'][number];
type Certification = StructuredResume['certifications'][number];

// Entries are identified by their main fields only, so an entry whose wording
// changed in its description counts as unchanged.
export const compareSections = (older: StructuredResume | null, newer: StructuredResume | null) => ({
  experience: compareLists<Experience>(
    older?.experience ?? null,
    newer?.experience ?? null,
    (e) => joinKey(e.title, e.company),
    (e) => `${[e.title, e.company].filter(Boolean).join(' at ')}${dates(e.startDate, e.endDate, e.isCurrent)}`,
    'No work experience was found in at least one of the versions.'
  ),
  education: compareLists<Education>(
    older?.education ?? null,
    newer?.education ?? null,
    (e) => joinKey(e.degree, e.field, e.institution),
    (e) => [[e.degree, e.field].filter(Boolean).join(' in '), e.institution].filter(Boolean).join(', '),
    'No education was found in at least one of the versions.'
  ),
  projects: compareLists<Project>(
    older?.projects ?? null,
    newer?.projects ?? null,
    (p) => joinKey(p.name),
    (p) => p.name ?? '',
    'No projects were found in at least one of the versions.'
  ),
  certifications: compareLists<Certification>(
    older?.certifications ?? null,
    newer?.certifications ?? null,
    (c) => joinKey(c.name, c.issuer),
    (c) => [c.name, c.issuer].filter(Boolean).join(' — '),
    'No certifications were found in at least one of the versions.'
  ),
});

// Whether the extracted text changed, as counts only: the text itself is not returned.
export const compareText = (older: string | null, newer: string | null) => {
  if (!older || !newer) {
    return { status: 'unavailable' as Availability, changed: null, linesAdded: null, linesRemoved: null, olderWordCount: null, newerWordCount: null };
  }
  const lines = (text: string) =>
    text
      .split('\n')
      .map((line) => line.replace(/\s+/g, ' ').trim())
      .filter(Boolean);
  const a = lines(older);
  const b = lines(newer);
  // Lines are compared as multisets, so moved lines are not counted as changes.
  const counts = new Map<string, number>();
  for (const line of a) counts.set(line, (counts.get(line) ?? 0) + 1);
  let linesAdded = 0;
  for (const line of b) {
    const n = counts.get(line) ?? 0;
    if (n > 0) counts.set(line, n - 1);
    else linesAdded++;
  }
  const linesRemoved = [...counts.values()].reduce((sum, n) => sum + n, 0);
  const words = (l: string[]) => l.join(' ').split(' ').filter(Boolean).length;
  return {
    status: 'available' as Availability,
    changed: a.join('\n') !== b.join('\n'),
    linesAdded,
    linesRemoved,
    olderWordCount: words(a),
    newerWordCount: words(b),
  };
};

export interface SavedScoreRow {
  id: string;
  resumeId: string;
  jobDescriptionId: string;
  jobTitle: string;
  companyName: string | null;
  overallScore: number;
  createdAt: Date | string;
}

// Pairs the latest saved analysis of each version for the same job description.
// `rows` must be ordered newest first. Scores are the stored official (Step 6B)
// scores; jobs analysed with only one of the versions are left out.
export const compareSavedScores = (rows: SavedScoreRow[], olderId: string, newerId: string) => {
  const latest = new Map<string, SavedScoreRow>();
  for (const row of rows) {
    const k = `${row.resumeId}|${row.jobDescriptionId}`;
    if (!latest.has(k)) latest.set(k, row);
  }
  const jobs = [...new Set(rows.map((r) => r.jobDescriptionId))];
  return jobs.flatMap((jobId) => {
    const a = latest.get(`${olderId}|${jobId}`);
    const b = latest.get(`${newerId}|${jobId}`);
    if (!a || !b) return [];
    return [
      {
        jobDescriptionId: jobId,
        jobTitle: b.jobTitle,
        companyName: b.companyName,
        olderScore: a.overallScore,
        newerScore: b.overallScore,
        difference: Math.round((b.overallScore - a.overallScore) * 100) / 100,
        olderMatchId: a.id,
        newerMatchId: b.id,
        olderAnalyzedAt: a.createdAt,
        newerAnalyzedAt: b.createdAt,
      },
    ];
  });
};
