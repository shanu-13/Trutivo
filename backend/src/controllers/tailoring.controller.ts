import { Request, Response } from 'express';
import { z } from 'zod';
import * as resumeService from '../services/resume.service';
import * as jobDescriptionService from '../services/job-description.service';
import * as aiService from '../services/ai.service';
import * as tailoringSessions from '../services/tailoring-session.service';
import { assemblePreview, buildTailoring, validateEditedText, type ReviewStatus } from '../services/resume-tailoring.service';
import { isValidResumeId } from './resume-version.controller';
import { toResumeSummary } from './resume.controller';

// Job-specific resume tailoring (Step 9C): rule-based suggestions the user
// reviews one by one. Nothing changes the source resume; saving creates a new
// version only on request.

const unauthorized = (res: Response) =>
  res.status(401).json({ success: false, message: 'Unauthorized', error: { code: 'UNAUTHORIZED', details: null } });
const invalidId = (res: Response) =>
  res.status(400).json({ success: false, message: 'Invalid id', error: { code: 'INVALID_ID', details: null } });
const notFound = (res: Response, message = 'Tailoring session not found') =>
  res.status(404).json({ success: false, message, error: { code: 'NOT_FOUND', details: null } });
const validationError = (res: Response, field: string, message: string) =>
  res.status(400).json({ success: false, message, error: { code: 'VALIDATION_ERROR', details: [{ field, message }] } });
const serverError = (res: Response, message: string) =>
  res.status(500).json({ success: false, message, error: { code: 'SERVER_ERROR', details: null } });

const createSchema = z.object({ jobDescriptionId: z.string() }).strict();

// POST /api/resumes/:id/tailoring  { jobDescriptionId }
export const createTailoring = async (req: Request, res: Response) => {
  try {
    const userId = req.user?.id;
    if (!userId) return unauthorized(res);
    if (!isValidResumeId(req.params.id)) return invalidId(res);
    const body = createSchema.safeParse(req.body ?? {});
    if (!body.success || !isValidResumeId(body.data.jobDescriptionId)) {
      return validationError(res, 'jobDescriptionId', 'A valid job description id is required');
    }

    // Both are looked up for this user only; either missing gives the same answer.
    const [resume, jobDescription] = await Promise.all([
      resumeService.getResumeTextById(req.params.id, userId),
      jobDescriptionService.getJobDescriptionById(body.data.jobDescriptionId, userId),
    ]);
    if (!resume || !jobDescription) return notFound(res, 'Resource not found');
    if (resume.extractionStatus !== 'completed' || !resume.textContent) {
      return res.status(409).json({
        success: false,
        message: 'Resume text is not available. Only processed resumes can be tailored.',
        error: { code: 'RESUME_TEXT_NOT_AVAILABLE', details: null },
      });
    }
    const requirements = await jobDescriptionService.getJobRequirements(jobDescription.id, userId);
    if (!requirements) {
      return res.status(409).json({
        success: false,
        message: 'Job requirements have not been extracted yet. Extract them from the job description first.',
        error: { code: 'JOB_REQUIREMENTS_NOT_AVAILABLE', details: null },
      });
    }

    // The existing structured analysis, sections and deterministic matching.
    // Nothing is stored unless all of them succeed.
    const [analysis, sections] = await Promise.all([
      aiService.analyzeResume(resume.id, resume.textContent),
      aiService.extractResumeSections(resume.id, resume.textContent),
    ]);
    const matching = await aiService.analyzeResumeJobMatch(
      resume.id,
      jobDescription.id,
      aiService.toMatchResumeInput(analysis.resume),
      aiService.toMatchJobRequirementsInput(requirements)
    );
    const result = buildTailoring({
      lines: resume.textContent.split('\n'),
      structured: analysis.resume,
      skillsSectionText: sections.sections.skills ?? null,
      requirements,
      matching,
    });

    const sessionId = await tailoringSessions.createSession(userId, resume.id, jobDescription.id, result);
    if (!sessionId) return notFound(res, 'Resource not found');
    const session = await tailoringSessions.getSession(sessionId, resume.id, userId);
    res.status(201).json({ success: true, message: 'Tailoring suggestions generated successfully', data: { session } });
  } catch (error) {
    if (error instanceof aiService.AiServiceError) {
      return res.status(error.statusCode).json({ success: false, message: error.message, error: { code: error.code, details: null } });
    }
    serverError(res, 'Failed to generate tailoring suggestions');
  }
};

// GET /api/resumes/:id/tailoring
export const listTailoring = async (req: Request, res: Response) => {
  try {
    const userId = req.user?.id;
    if (!userId) return unauthorized(res);
    if (!isValidResumeId(req.params.id)) return invalidId(res);
    const sessions = await tailoringSessions.listSessions(req.params.id, userId);
    res.json({ success: true, message: 'Tailoring sessions retrieved successfully', data: { sessions } });
  } catch (error) {
    serverError(res, 'Failed to retrieve tailoring sessions');
  }
};

const validIds = (req: Request) => isValidResumeId(req.params.id) && isValidResumeId(req.params.sessionId);

// GET /api/resumes/:id/tailoring/:sessionId
export const getTailoring = async (req: Request, res: Response) => {
  try {
    const userId = req.user?.id;
    if (!userId) return unauthorized(res);
    if (!validIds(req)) return invalidId(res);
    const session = await tailoringSessions.getSession(req.params.sessionId, req.params.id, userId);
    if (!session) return notFound(res);
    res.json({ success: true, message: 'Tailoring session retrieved successfully', data: { session } });
  } catch (error) {
    serverError(res, 'Failed to retrieve the tailoring session');
  }
};

const reviewSchema = z
  .object({ action: z.enum(['accept', 'edit', 'reject', 'reset']), editedText: z.string().optional() })
  .strict();
const REVIEW_STATUS: Record<z.infer<typeof reviewSchema>['action'], ReviewStatus> = {
  accept: 'accepted',
  edit: 'edited',
  reject: 'rejected',
  reset: 'pending',
};

// PATCH /api/resumes/:id/tailoring/:sessionId/suggestions/:suggestionId
// { action: accept | edit (with editedText) | reject | reset }
export const reviewTailoringSuggestion = async (req: Request, res: Response) => {
  try {
    const userId = req.user?.id;
    if (!userId) return unauthorized(res);
    if (!validIds(req) || !isValidResumeId(req.params.suggestionId)) return invalidId(res);
    const body = reviewSchema.safeParse(req.body ?? {});
    if (!body.success) return validationError(res, 'action', 'action must be accept, edit, reject or reset');

    let editedText: string | null = null;
    if (body.data.action === 'edit') {
      const edited = validateEditedText(body.data.editedText);
      if ('error' in edited) return validationError(res, 'editedText', edited.error);
      editedText = edited.text;
    } else if (body.data.editedText !== undefined) {
      return validationError(res, 'editedText', 'editedText is only accepted with the edit action');
    }

    const outcome = await tailoringSessions.reviewSuggestion(
      req.params.sessionId,
      req.params.id,
      req.params.suggestionId,
      userId,
      REVIEW_STATUS[body.data.action],
      editedText
    );
    if (outcome === 'not_found') return notFound(res, 'Suggestion not found');
    if (outcome === 'saved') {
      return res.status(409).json({
        success: false,
        message: 'This tailoring session was already saved and can no longer be changed',
        error: { code: 'TAILORING_ALREADY_SAVED', details: null },
      });
    }
    res.json({ success: true, message: 'Suggestion updated successfully', data: { suggestion: outcome.suggestion } });
  } catch (error) {
    serverError(res, 'Failed to update the suggestion');
  }
};

// The source resume's text with the session's accepted suggestions applied.
const buildPreview = async (sessionId: string, resumeId: string, userId: string) => {
  const session = await tailoringSessions.getSession(sessionId, resumeId, userId);
  if (!session) return null;
  const resume = await resumeService.getResumeTextById(resumeId, userId);
  if (!resume?.textContent) return null;
  return { session, preview: assemblePreview(resume.textContent.split('\n'), session.suggestions) };
};

// GET /api/resumes/:id/tailoring/:sessionId/preview (read-only)
export const previewTailoring = async (req: Request, res: Response) => {
  try {
    const userId = req.user?.id;
    if (!userId) return unauthorized(res);
    if (!validIds(req)) return invalidId(res);
    const built = await buildPreview(req.params.sessionId, req.params.id, userId);
    if (!built) return notFound(res);
    const { lines, appliedCount, staleSuggestionIds } = built.preview;
    res.json({
      success: true,
      message: 'Tailored preview generated successfully',
      data: { preview: { lines, appliedCount, staleSuggestionIds } },
    });
  } catch (error) {
    serverError(res, 'Failed to build the preview');
  }
};

// POST /api/resumes/:id/tailoring/:sessionId/save
export const saveTailoring = async (req: Request, res: Response) => {
  try {
    const userId = req.user?.id;
    if (!userId) return unauthorized(res);
    if (!validIds(req)) return invalidId(res);
    const { sessionId, id: resumeId } = req.params;

    const outcome = await tailoringSessions.saveTailoredCopy(sessionId, resumeId, userId, async () => {
      const built = await buildPreview(sessionId, resumeId, userId);
      if (!built) return { text: '', appliedCount: 0, jobTitle: '', sourceFilename: '' };
      return {
        text: built.preview.text,
        appliedCount: built.preview.appliedCount,
        jobTitle: built.session.jobTitle,
        sourceFilename: built.session.resumeFilename,
      };
    });
    if (outcome === 'not_found') return notFound(res);
    if (outcome === 'nothing_accepted') {
      return res.status(409).json({
        success: false,
        message: 'Accept at least one suggestion before saving a tailored copy',
        error: { code: 'NO_ACCEPTED_SUGGESTIONS', details: null },
      });
    }
    const resume = await resumeService.getResumeById(outcome.resumeId, userId);
    res.status(outcome.created ? 201 : 200).json({
      success: true,
      message: outcome.created ? 'Tailored copy saved as a new resume version' : 'This tailored copy was already saved',
      data: { resume: resume ? toResumeSummary(resume) : null, created: outcome.created },
    });
  } catch (error) {
    serverError(res, 'Failed to save the tailored copy');
  }
};
