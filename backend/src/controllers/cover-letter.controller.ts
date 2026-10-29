import { Request, Response } from 'express';
import { z } from 'zod';
import * as resumeService from '../services/resume.service';
import * as jobDescriptionService from '../services/job-description.service';
import * as aiService from '../services/ai.service';
import * as coverLetters from '../services/cover-letter.service';
import { isValidResumeId as isUuid } from './resume-version.controller';

// Cover letters (Step 12): rule-based generation (not stored) and saved letters.

export const MAX_CONTENT_LENGTH = 10_000;
export const MAX_TITLE_LENGTH = 200;

const unauthorized = (res: Response) =>
  res.status(401).json({ success: false, message: 'Unauthorized', error: { code: 'UNAUTHORIZED', details: null } });
const notFound = (res: Response, message = 'Cover letter not found') =>
  res.status(404).json({ success: false, message, error: { code: 'NOT_FOUND', details: null } });
const invalidId = (res: Response) =>
  res.status(400).json({ success: false, message: 'Invalid cover letter id', error: { code: 'INVALID_ID', details: null } });
const serverError = (res: Response, message: string) =>
  res.status(500).json({ success: false, message, error: { code: 'SERVER_ERROR', details: null } });
const validationError = (res: Response, error: z.ZodError) =>
  res.status(400).json({
    success: false,
    message: 'Invalid request',
    error: { code: 'VALIDATION_ERROR', details: error.issues.map((i) => ({ field: i.path.join('.') || 'body', message: i.message })) },
  });

const uuid = z.string().refine(isUuid, 'Must be a valid id');
const tone = z.enum(['professional', 'confident', 'conversational', 'concise']);
const length = z.enum(['short', 'standard', 'detailed']);
const optionalName = z
  .string()
  .max(MAX_TITLE_LENGTH)
  .transform((s) => s.replace(/\s+/g, ' ').trim() || null)
  .nullable()
  .optional();
// Plain text only: line breaks and tabs are kept, other control characters are refused.
const content = z
  .string()
  .transform((s) => s.replace(/\r\n?/g, '\n'))
  .refine((s) => s.trim().length > 0, 'Cover letter text cannot be empty')
  .refine((s) => s.length <= MAX_CONTENT_LENGTH, `Cover letter text must be at most ${MAX_CONTENT_LENGTH.toLocaleString()} characters`)
  .refine((s) => !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(s), 'Cover letter text contains invalid characters');
const title = z
  .string()
  .transform((s) => s.replace(/\s+/g, ' ').trim())
  .refine((s) => s.length > 0, 'Title is required')
  .refine((s) => s.length <= MAX_TITLE_LENGTH, `Title must be at most ${MAX_TITLE_LENGTH} characters`);

export const generateSchema = z.object({ resumeId: uuid, jobDescriptionId: uuid, tone, length }).strict();
export const createSchema = z
  .object({
    title,
    content,
    tone,
    length,
    roleTitle: optionalName,
    companyName: optionalName,
    resumeId: uuid.nullable().optional(),
    jobDescriptionId: uuid.nullable().optional(),
  })
  .strict();
export const updateSchema = z
  .object({ title: title.optional(), content: content.optional(), tone: tone.optional(), length: length.optional(), roleTitle: optionalName, companyName: optionalName })
  .strict()
  .refine((v) => Object.values(v).some((x) => x !== undefined), 'Nothing to update');

// POST /api/cover-letters/generate  { resumeId, jobDescriptionId, tone, length }
// Returns a draft; nothing is stored until the user saves it.
export const generateCoverLetter = async (req: Request, res: Response) => {
  try {
    const userId = req.user?.id;
    if (!userId) return unauthorized(res);
    const body = generateSchema.safeParse(req.body ?? {});
    if (!body.success) return validationError(res, body.error);

    // Both looked up for this user only; either missing gives the same answer.
    const [resume, job] = await Promise.all([
      resumeService.getResumeTextById(body.data.resumeId, userId),
      jobDescriptionService.getJobDescriptionById(body.data.jobDescriptionId, userId),
    ]);
    if (!resume || !job) return notFound(res, 'Resume or job description not found');
    if (resume.extractionStatus !== 'completed' || !resume.textContent) {
      return res.status(409).json({
        success: false,
        message: 'Resume text is not available. Only processed resumes can be used.',
        error: { code: 'RESUME_TEXT_NOT_AVAILABLE', details: null },
      });
    }
    const requirements = await jobDescriptionService.getJobRequirements(job.id, userId);
    if (!requirements) {
      return res.status(409).json({
        success: false,
        message: 'Job requirements have not been extracted yet. Extract them from the job description first.',
        error: { code: 'JOB_REQUIREMENTS_NOT_AVAILABLE', details: null },
      });
    }

    const analysis = await aiService.analyzeResume(resume.id, resume.textContent);
    const facts = aiService.toCoverLetterFacts(analysis.resume, requirements, { title: job.title, companyName: job.companyName });
    const letter = await aiService.generateCoverLetter(facts, body.data.tone, body.data.length);
    res.json({
      success: true,
      message: 'Cover letter generated successfully',
      data: {
        coverLetter: {
          ...letter,
          title: `${job.title}${job.companyName ? ` — ${job.companyName}` : ''}`.slice(0, MAX_TITLE_LENGTH),
          roleTitle: job.title,
          companyName: job.companyName,
          resumeId: resume.id,
          jobDescriptionId: job.id,
        },
      },
    });
  } catch (error) {
    if (error instanceof aiService.AiServiceError) {
      return res.status(error.statusCode).json({ success: false, message: error.message, error: { code: error.code, details: null } });
    }
    serverError(res, 'Failed to generate the cover letter');
  }
};

// GET /api/cover-letters
export const listCoverLetters = async (req: Request, res: Response) => {
  try {
    const userId = req.user?.id;
    if (!userId) return unauthorized(res);
    res.json({ success: true, message: 'Cover letters retrieved successfully', data: { coverLetters: await coverLetters.listCoverLetters(userId) } });
  } catch (error) {
    serverError(res, 'Failed to retrieve cover letters');
  }
};

// POST /api/cover-letters
export const createCoverLetter = async (req: Request, res: Response) => {
  try {
    const userId = req.user?.id;
    if (!userId) return unauthorized(res);
    const body = createSchema.safeParse(req.body ?? {});
    if (!body.success) return validationError(res, body.error);
    const { resumeId = null, jobDescriptionId = null, roleTitle = null, companyName = null, ...rest } = body.data;
    const id = await coverLetters.createCoverLetter(userId, { ...rest, roleTitle, companyName }, resumeId, jobDescriptionId);
    if (!id) return notFound(res, 'Resume or job description not found');
    res.status(201).json({ success: true, message: 'Cover letter saved successfully', data: { coverLetter: await coverLetters.getCoverLetter(id, userId) } });
  } catch (error) {
    serverError(res, 'Failed to save the cover letter');
  }
};

// GET /api/cover-letters/:id
export const getCoverLetter = async (req: Request, res: Response) => {
  try {
    const userId = req.user?.id;
    if (!userId) return unauthorized(res);
    if (!isUuid(req.params.id)) return invalidId(res);
    const letter = await coverLetters.getCoverLetter(req.params.id, userId);
    if (!letter) return notFound(res);
    res.json({ success: true, message: 'Cover letter retrieved successfully', data: { coverLetter: letter } });
  } catch (error) {
    serverError(res, 'Failed to retrieve the cover letter');
  }
};

// PUT /api/cover-letters/:id  (any of title, content, tone, length, roleTitle, companyName)
export const updateCoverLetter = async (req: Request, res: Response) => {
  try {
    const userId = req.user?.id;
    if (!userId) return unauthorized(res);
    if (!isUuid(req.params.id)) return invalidId(res);
    const body = updateSchema.safeParse(req.body ?? {});
    if (!body.success) return validationError(res, body.error);
    if (!(await coverLetters.updateCoverLetter(req.params.id, userId, body.data))) return notFound(res);
    res.json({ success: true, message: 'Cover letter updated successfully', data: { coverLetter: await coverLetters.getCoverLetter(req.params.id, userId) } });
  } catch (error) {
    serverError(res, 'Failed to update the cover letter');
  }
};

// DELETE /api/cover-letters/:id
export const deleteCoverLetter = async (req: Request, res: Response) => {
  try {
    const userId = req.user?.id;
    if (!userId) return unauthorized(res);
    if (!isUuid(req.params.id)) return invalidId(res);
    if (!(await coverLetters.deleteCoverLetter(req.params.id, userId))) return notFound(res);
    res.json({ success: true, message: 'Cover letter deleted successfully', data: null });
  } catch (error) {
    serverError(res, 'Failed to delete the cover letter');
  }
};
