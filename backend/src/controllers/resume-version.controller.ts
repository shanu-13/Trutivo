import { Request, Response, NextFunction } from 'express';
import * as resumeService from '../services/resume.service';
import * as aiService from '../services/ai.service';
import * as matchHistoryService from '../services/match-history.service';
import { compareSavedScores, compareSections, compareSkills, compareText } from '../services/resume-comparison.service';
import { toResumeSummary } from './resume.controller';

// Resume versions (Step 9B). Every query is scoped to the signed-in user, so a
// resume of another user behaves exactly like one that does not exist.

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isValidResumeId = (value: unknown): value is string => typeof value === 'string' && UUID_RE.test(value);

const unauthorized = (res: Response) =>
  res.status(401).json({ success: false, message: 'Unauthorized', error: { code: 'UNAUTHORIZED', details: null } });
const invalidId = (res: Response) =>
  res.status(400).json({ success: false, message: 'Invalid resume id', error: { code: 'INVALID_RESUME_ID', details: null } });
const notFound = (res: Response) =>
  res.status(404).json({ success: false, message: 'Resume not found', error: { code: 'NOT_FOUND', details: null } });
const serverError = (res: Response, message: string) =>
  res.status(500).json({ success: false, message, error: { code: 'SERVER_ERROR', details: null } });

// Runs before the upload middleware, so nothing is written to disk for a
// resume the user does not own. The upload itself checks ownership again.
export const requireOwnedResume = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const userId = req.user?.id;
    if (!userId) return unauthorized(res);
    if (!isValidResumeId(req.params.id)) return invalidId(res);
    if (!(await resumeService.getResumeById(req.params.id, userId))) return notFound(res);
    next();
  } catch (error) {
    serverError(res, 'Failed to upload resume');
  }
};

// GET /api/resumes/:id/versions
export const listVersions = async (req: Request, res: Response) => {
  try {
    const userId = req.user?.id;
    if (!userId) return unauthorized(res);
    if (!isValidResumeId(req.params.id)) return invalidId(res);

    const rows = await resumeService.getResumeVersions(req.params.id, userId);
    if (!rows) return notFound(res);
    const versions = rows.map(toResumeSummary);
    res.json({
      success: true,
      message: 'Resume versions retrieved successfully',
      data: { resumeGroupId: versions[0].resumeGroupId, versions },
    });
  } catch (error) {
    serverError(res, 'Failed to retrieve resume versions');
  }
};

// PATCH /api/resumes/:id/current: makes this version the current one.
export const makeCurrentVersion = async (req: Request, res: Response) => {
  try {
    const userId = req.user?.id;
    if (!userId) return unauthorized(res);
    if (!isValidResumeId(req.params.id)) return invalidId(res);

    const result = await resumeService.setCurrentVersion(req.params.id, userId);
    if (result === 'not_found') return notFound(res);
    if (result === 'not_ready') {
      return res.status(409).json({
        success: false,
        message: 'Only a version whose text has been extracted can be made current',
        error: { code: 'RESUME_VERSION_NOT_READY', details: null },
      });
    }
    const resume = await resumeService.getResumeById(req.params.id, userId);
    res.json({ success: true, message: 'Current resume version updated successfully', data: { resume: toResumeSummary(resume) } });
  } catch (error) {
    serverError(res, 'Failed to update the current resume version');
  }
};

const flattenSkills = (skills: Record<string, string[]>) => Object.values(skills).flat();

// Runs the existing rule-based structured analysis on a version's stored text.
// Returns null when it cannot (no text, or the AI service is unavailable).
const analyze = async (resumeId: string, text: string | null) => {
  if (!text) return null;
  try {
    return (await aiService.analyzeResume(resumeId, text)).resume;
  } catch {
    return null;
  }
};

// GET /api/resumes/:id/versions/:otherId/compare
export const compareVersions = async (req: Request, res: Response) => {
  try {
    const userId = req.user?.id;
    if (!userId) return unauthorized(res);
    const { id, otherId } = req.params;
    if (!isValidResumeId(id) || !isValidResumeId(otherId)) return invalidId(res);
    if (id === otherId) {
      return res.status(400).json({
        success: false,
        message: 'Choose two different versions to compare',
        error: { code: 'VALIDATION_ERROR', details: [{ field: 'otherId', message: 'Choose two different versions' }] },
      });
    }

    // Both must be in the same group of this user's; anything else is "not found".
    const versions = await resumeService.getResumeVersions(id, userId);
    const other = versions?.find((v: any) => v.id === otherId);
    if (!versions || !other) return notFound(res);
    const current = versions.find((v: any) => v.id === id);
    const [older, newer] = [current, other].sort((a: any, b: any) => a.versionNumber - b.versionNumber);

    const [olderText, newerText] = await Promise.all([
      resumeService.getResumeTextById(older.id, userId),
      resumeService.getResumeTextById(newer.id, userId),
    ]);
    const textOf = (row: any) => (row?.extractionStatus === 'completed' ? row.textContent : null);
    const [olderAnalysis, newerAnalysis, scoreRows] = await Promise.all([
      analyze(older.id, textOf(olderText)),
      analyze(newer.id, textOf(newerText)),
      matchHistoryService.getSavedScoresForResumes(userId, [older.id, newer.id]),
    ]);

    // Stored skills when both versions have them; otherwise the skills found by
    // the structured analysis of both. Sources are never mixed.
    let skills;
    let skillsSource: 'stored' | 'analysis' | null = null;
    if (older.skillsExtractedAt && newer.skillsExtractedAt) {
      const [a, b] = await Promise.all([
        resumeService.getResumeSkills(older.id, userId),
        resumeService.getResumeSkills(newer.id, userId),
      ]);
      skills = compareSkills(flattenSkills(a), flattenSkills(b));
      skillsSource = 'stored';
    } else if (olderAnalysis && newerAnalysis) {
      skills = compareSkills(flattenSkills(olderAnalysis.skills), flattenSkills(newerAnalysis.skills));
      skillsSource = 'analysis';
    } else {
      skills = compareSkills(null, null);
    }

    const summary = (v: any) => ({
      resumeId: v.id,
      versionNumber: Number(v.versionNumber),
      versionLabel: v.versionLabel ?? null,
      filename: v.originalFilename,
      extractionStatus: v.extractionStatus,
      isCurrent: Number(v.isCurrent) === 1,
      createdAt: v.createdAt,
    });
    const matchScoreComparison = compareSavedScores(scoreRows, older.id, newer.id);

    res.json({
      success: true,
      message: 'Resume versions compared successfully',
      data: {
        olderVersion: summary(older),
        newerVersion: summary(newer),
        skills: { ...skills, source: skillsSource },
        sections: {
          ...compareSections(olderAnalysis, newerAnalysis),
          // Why sections may be unavailable for both versions at once.
          analysisAvailable: Boolean(olderAnalysis && newerAnalysis),
        },
        text: compareText(textOf(olderText), textOf(newerText)),
        matchScoreComparison,
        matchScoreMessage:
          matchScoreComparison.length === 0
            ? 'No job description has saved analyses for both versions, so no same-job score comparison is available.'
            : null,
      },
    });
  } catch (error) {
    serverError(res, 'Failed to compare resume versions');
  }
};
