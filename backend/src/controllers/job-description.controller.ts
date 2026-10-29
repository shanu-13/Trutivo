import { Request, Response } from 'express';
import { z } from 'zod';
import * as jobDescriptionService from '../services/job-description.service';
import * as aiService from '../services/ai.service';

export const MAX_TITLE_LENGTH = 200;
export const MAX_COMPANY_NAME_LENGTH = 200;
// Must not exceed the AI service's MAX_JOB_DESCRIPTION_TEXT_LENGTH.
export const MAX_DESCRIPTION_LENGTH = 50000;

// Whitespace and invisible characters (zero-width spaces, BOM, soft hyphen) carry no content.
const INVISIBLE_RE = /[\s​-‍⁠﻿­]/g;
const hasVisibleText = (value: string) => value.replace(INVISIBLE_RE, '').length > 0;

const titleSchema = z
  .string({ error: 'Job title must be text' })
  .trim()
  .min(1, 'Job title is required')
  .max(MAX_TITLE_LENGTH, `Job title must be at most ${MAX_TITLE_LENGTH} characters`);

const companyNameSchema = z
  .string({ error: 'Company name must be text' })
  .trim()
  .max(MAX_COMPANY_NAME_LENGTH, `Company name must be at most ${MAX_COMPANY_NAME_LENGTH} characters`)
  .nullable()
  .transform((value) => (value ? value : null));

// The description is stored exactly as entered: it is checked, never trimmed or truncated.
const descriptionTextSchema = z
  .string({ error: 'Job description must be text' })
  .max(MAX_DESCRIPTION_LENGTH, `Job description must be at most ${MAX_DESCRIPTION_LENGTH} characters`)
  .refine(hasVisibleText, 'Job description is required');

// Unknown fields (including any user id) are dropped: the owner always comes from the session.
export const createJobDescriptionSchema = z.object({
  title: titleSchema,
  companyName: companyNameSchema.optional().transform((value) => value ?? null),
  descriptionText: descriptionTextSchema,
});

export const updateJobDescriptionSchema = z
  .object({
    title: titleSchema.optional(),
    companyName: companyNameSchema.optional(),
    descriptionText: descriptionTextSchema.optional(),
  })
  .refine(
    (changes) => Object.values(changes).some((value) => value !== undefined),
    'Provide at least one of title, companyName or descriptionText'
  );

const validationError = (res: Response, error: z.ZodError) =>
  // Only field names and messages are returned, never the submitted values.
  res.status(400).json({
    success: false,
    message: 'Invalid job description',
    error: {
      code: 'JOB_DESCRIPTION_VALIDATION_ERROR',
      details: error.issues.map((issue) => ({ field: issue.path.join('.') || null, message: issue.message })),
    },
  });

const unauthorized = (res: Response) =>
  res.status(401).json({ success: false, message: 'Unauthorized', error: { code: 'UNAUTHORIZED', details: null } });

const notFound = (res: Response) =>
  res.status(404).json({
    success: false,
    message: 'Job description not found',
    error: { code: 'JOB_DESCRIPTION_NOT_FOUND', details: null },
  });

const serverError = (res: Response, message: string) =>
  res.status(500).json({ success: false, message, error: { code: 'SERVER_ERROR', details: null } });

const toDetail = (row: any) => ({
  id: row.id,
  title: row.title,
  companyName: row.companyName,
  descriptionText: row.descriptionText,
  createdAt: row.createdAt,
  updatedAt: row.updatedAt,
});

export const createJobDescription = async (req: Request, res: Response) => {
  try {
    const userId = req.user?.id;
    if (!userId) return unauthorized(res);

    const parsed = createJobDescriptionSchema.safeParse(req.body ?? {});
    if (!parsed.success) return validationError(res, parsed.error);

    const id = await jobDescriptionService.createJobDescription(userId, parsed.data);
    const created = await jobDescriptionService.getJobDescriptionById(id, userId);

    res.status(201).json({
      success: true,
      message: 'Job description created successfully',
      data: { jobDescription: toDetail(created) },
    });
  } catch (error) {
    serverError(res, 'Failed to create job description');
  }
};

export const listJobDescriptions = async (req: Request, res: Response) => {
  try {
    const userId = req.user?.id;
    if (!userId) return unauthorized(res);

    const rows = await jobDescriptionService.getUserJobDescriptions(userId);

    res.json({
      success: true,
      message: 'Job descriptions retrieved successfully',
      data: {
        jobDescriptions: rows.map((row: any) => ({
          id: row.id,
          title: row.title,
          companyName: row.companyName,
          createdAt: row.createdAt,
          updatedAt: row.updatedAt,
          requirementsExtractedAt: row.requirementsExtractedAt ?? null,
        })),
      },
    });
  } catch (error) {
    serverError(res, 'Failed to retrieve job descriptions');
  }
};

export const getJobDescription = async (req: Request, res: Response) => {
  try {
    const userId = req.user?.id;
    if (!userId) return unauthorized(res);

    const row = await jobDescriptionService.getJobDescriptionById(req.params.id, userId);
    if (!row) return notFound(res);

    res.json({
      success: true,
      message: 'Job description retrieved successfully',
      data: { jobDescription: toDetail(row) },
    });
  } catch (error) {
    serverError(res, 'Failed to retrieve job description');
  }
};

export const updateJobDescription = async (req: Request, res: Response) => {
  try {
    const userId = req.user?.id;
    if (!userId) return unauthorized(res);

    const parsed = updateJobDescriptionSchema.safeParse(req.body ?? {});
    if (!parsed.success) return validationError(res, parsed.error);

    const updated = await jobDescriptionService.updateJobDescription(req.params.id, userId, parsed.data);
    if (!updated) return notFound(res);

    const row = await jobDescriptionService.getJobDescriptionById(req.params.id, userId);
    if (!row) return notFound(res);

    res.json({
      success: true,
      message: 'Job description updated successfully',
      data: { jobDescription: toDetail(row) },
    });
  } catch (error) {
    serverError(res, 'Failed to update job description');
  }
};

export const deleteJobDescription = async (req: Request, res: Response) => {
  try {
    const userId = req.user?.id;
    if (!userId) return unauthorized(res);

    const deleted = await jobDescriptionService.deleteJobDescription(req.params.id, userId);
    if (!deleted) return notFound(res);

    res.json({ success: true, message: 'Job description deleted successfully', data: null });
  } catch (error) {
    serverError(res, 'Failed to delete job description');
  }
};

export const processJobDescription = async (req: Request, res: Response) => {
  try {
    const userId = req.user?.id;
    if (!userId) return unauthorized(res);

    // The text always comes from the database, never from the request.
    const row = await jobDescriptionService.getJobDescriptionById(req.params.id, userId);
    if (!row) return notFound(res);

    const result = await aiService.preprocessJobDescription(row.id, row.descriptionText);

    res.json({
      success: true,
      message: 'Job description processed successfully',
      data: {
        jobDescription: {
          id: row.id,
          processedText: result.processedText,
          originalLength: row.descriptionText.length,
          processedLength: result.processedText.length,
        },
      },
    });
  } catch (error) {
    if (error instanceof aiService.AiServiceError) {
      return res.status(error.statusCode).json({
        success: false,
        message: error.message,
        error: { code: error.code, details: null },
      });
    }
    serverError(res, 'Failed to process job description');
  }
};

// Stored requirements in the API shape. The job title is always the one the
// user saved on the job description, so it stays current after a rename.
const toRequirements = (jobDescription: any, row: any) => ({
  jobTitle: jobDescription.title,
  location: row.location,
  employmentType: row.employmentType,
  workMode: row.workMode,
  requiredSkills: row.requiredSkills,
  preferredSkills: row.preferredSkills,
  mentionedSkills: row.mentionedSkills,
  experienceRequirements: row.experienceRequirements,
  educationRequirements: row.educationRequirements,
  responsibilities: row.responsibilities,
});

export const extractRequirements = async (req: Request, res: Response) => {
  try {
    const userId = req.user?.id;
    if (!userId) return unauthorized(res);

    // The text always comes from the database, never from the request.
    const jobDescription = await jobDescriptionService.getJobDescriptionById(req.params.id, userId);
    if (!jobDescription) return notFound(res);

    const requirements = await aiService.extractJobRequirements(
      jobDescription.id,
      jobDescription.descriptionText,
      jobDescription.title
    );

    const saved = await jobDescriptionService.saveJobRequirements(
      jobDescription.id,
      userId,
      jobDescription.descriptionText,
      requirements
    );
    if (saved === 'not_found') return notFound(res);
    if (saved === 'stale') {
      return res.status(409).json({
        success: false,
        message: 'The job description changed during extraction. Please try again.',
        error: { code: 'JOB_DESCRIPTION_CHANGED', details: null },
      });
    }

    const [current, row] = await Promise.all([
      jobDescriptionService.getJobDescriptionById(jobDescription.id, userId),
      jobDescriptionService.getJobRequirements(jobDescription.id, userId),
    ]);
    if (!current || !row) return notFound(res);

    res.json({
      success: true,
      message: 'Job requirements extracted successfully',
      data: {
        jobDescriptionId: current.id,
        requirements: toRequirements(current, row),
        extractedAt: row.extractedAt,
      },
    });
  } catch (error) {
    if (error instanceof aiService.AiServiceError) {
      return res.status(error.statusCode).json({
        success: false,
        message: error.message,
        error: { code: error.code, details: null },
      });
    }
    serverError(res, 'Failed to extract job requirements');
  }
};

export const getRequirements = async (req: Request, res: Response) => {
  try {
    const userId = req.user?.id;
    if (!userId) return unauthorized(res);

    const jobDescription = await jobDescriptionService.getJobDescriptionById(req.params.id, userId);
    if (!jobDescription) return notFound(res);

    const row = await jobDescriptionService.getJobRequirements(jobDescription.id, userId);

    res.json({
      success: true,
      message: 'Job requirements retrieved successfully',
      data: {
        jobDescriptionId: jobDescription.id,
        // null until requirements have been extracted (or after the text was edited).
        requirements: row ? toRequirements(jobDescription, row) : null,
        extractedAt: row ? row.extractedAt : null,
      },
    });
  } catch (error) {
    serverError(res, 'Failed to retrieve job requirements');
  }
};
