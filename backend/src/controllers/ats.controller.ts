import { Request, Response } from 'express';
import { z } from 'zod';
import * as resumeService from '../services/resume.service';
import * as jobDescriptionService from '../services/job-description.service';
import * as aiService from '../services/ai.service';
import { evaluateAtsReadiness, BANDS, CATEGORY_NAMES, CHECK_WEIGHTS, MIN_WORDS, RULES_VERSION } from '../services/ats-readiness.service';
import { getAtsChecks, saveAtsCheck } from '../services/ats-check.service';
import { buildCoverage, type RequirementCoverage } from '../services/resume-tailoring.service';
import { isValidResumeId } from './resume-version.controller';

// ATS readiness (Step 11): deterministic checks of a resume version, stored per
// run, plus an optional job relevance view that is computed on request only
// and never part of the readiness score.

const unauthorized = (res: Response) =>
  res.status(401).json({ success: false, message: 'Unauthorized', error: { code: 'UNAUTHORIZED', details: null } });
const invalidId = (res: Response) =>
  res.status(400).json({ success: false, message: 'Invalid id', error: { code: 'INVALID_ID', details: null } });
const notFound = (res: Response, message = 'Resume not found') =>
  res.status(404).json({ success: false, message, error: { code: 'NOT_FOUND', details: null } });
const serverError = (res: Response, message: string) =>
  res.status(500).json({ success: false, message, error: { code: 'SERVER_ERROR', details: null } });

export const SCORING = {
  rulesVersion: RULES_VERSION,
  weights: CHECK_WEIGHTS,
  categories: CATEGORY_NAMES,
  bands: BANDS,
  disclaimer:
    'This is an estimate based on the checks listed here. Applicant tracking systems differ, and no score can predict whether a particular employer’s system will accept a resume.',
};

const requestSchema = z.object({ jobDescriptionId: z.string().optional() }).strict();

type Relevance =
  | { status: 'available'; jobDescriptionId: string; jobTitle: string; companyName: string | null; requirements: RequirementCoverage[]; suggestions: string[] }
  | { status: 'unavailable'; jobDescriptionId: string; reason: string };

// Truthful alignment advice from requirement coverage: never "add X" for something the resume does not show.
const relevanceSuggestions = (coverage: RequirementCoverage[]) => {
  const partial = coverage.filter((c) => c.status === 'partial' && c.type.endsWith('skill')).map((c) => c.requirement);
  const missing = coverage.filter((c) => c.status === 'not_found' && c.type === 'required_skill').map((c) => c.requirement);
  const out: string[] = [];
  if (partial.length) {
    out.push(`${partial.join(', ')} ${partial.length === 1 ? 'is' : 'are'} listed but not shown in your experience or projects. If you used ${partial.length === 1 ? 'it' : 'them'} there, say where and how.`);
  }
  if (missing.length) {
    out.push(
      `The job asks for ${missing.join(', ')}, which your resume does not mention. If you have real experience with ${missing.length === 1 ? 'it' : 'any of them'}, add it where it applies; if not, leave ${missing.length === 1 ? 'it' : 'them'} out.`
    );
  }
  if (!out.length) out.push('Your resume already shows the skills this job lists. Keep the most relevant ones easy to find.');
  return out;
};

// POST /api/resumes/:id/ats-check  { jobDescriptionId? }
export const runAtsCheck = async (req: Request, res: Response) => {
  try {
    const userId = req.user?.id;
    if (!userId) return unauthorized(res);
    if (!isValidResumeId(req.params.id)) return invalidId(res);
    const body = requestSchema.safeParse(req.body ?? {});
    if (!body.success || (body.data.jobDescriptionId !== undefined && !isValidResumeId(body.data.jobDescriptionId))) {
      return res.status(400).json({
        success: false,
        message: 'Invalid request',
        error: { code: 'VALIDATION_ERROR', details: [{ field: 'jobDescriptionId', message: 'Must be a valid job description id' }] },
      });
    }

    const resume = await resumeService.getResumeTextById(req.params.id, userId);
    if (!resume) return notFound(res);
    if (resume.extractionStatus === 'pending' || resume.extractionStatus === 'processing') {
      return res.status(409).json({
        success: false,
        message: 'Text extraction is still in progress. Try again in a moment.',
        error: { code: 'RESUME_NOT_READY', details: null },
      });
    }
    const jobId = body.data.jobDescriptionId ?? null;
    const job = jobId ? await jobDescriptionService.getJobDescriptionById(jobId, userId) : null;
    if (jobId && !job) return notFound(res, 'Job description not found');

    // A resume whose text could not be extracted is evaluated as empty text.
    const text: string = resume.extractionStatus === 'completed' ? resume.textContent ?? '' : '';
    const wordCount = (text.match(/\S+/g) ?? []).length;
    // The existing rule-based structured analysis; content checks are skipped if it is unavailable.
    let structured: aiService.StructuredResume | null = null;
    if (wordCount >= MIN_WORDS) {
      try {
        structured = (await aiService.analyzeResume(resume.id, text)).resume;
      } catch {
        structured = null;
      }
    }
    const result = evaluateAtsReadiness({ text, structured });

    let relevance: Relevance | null = null;
    if (job) {
      const requirements = await jobDescriptionService.getJobRequirements(job.id, userId);
      if (!requirements) {
        relevance = { status: 'unavailable', jobDescriptionId: job.id, reason: 'Requirements have not been extracted for this job description yet.' };
      } else if (!structured) {
        relevance = { status: 'unavailable', jobDescriptionId: job.id, reason: 'The resume could not be analysed right now.' };
      } else {
        try {
          const matching = await aiService.analyzeResumeJobMatch(
            resume.id,
            job.id,
            aiService.toMatchResumeInput(structured),
            aiService.toMatchJobRequirementsInput(requirements)
          );
          const coverage = buildCoverage({ lines: [], structured, skillsSectionText: null, requirements, matching });
          relevance = {
            status: 'available',
            jobDescriptionId: job.id,
            jobTitle: job.title,
            companyName: job.companyName,
            requirements: coverage,
            suggestions: relevanceSuggestions(coverage),
          };
        } catch {
          relevance = { status: 'unavailable', jobDescriptionId: job.id, reason: 'Job relevance could not be calculated right now.' };
        }
      }
    }

    const id = await saveAtsCheck(userId, resume.id, text, result);
    if (!id) return notFound(res);
    res.status(201).json({
      success: true,
      message: 'ATS readiness checked successfully',
      data: { check: { id, createdAt: new Date().toISOString(), stale: false, result }, relevance, scoring: SCORING },
    });
  } catch (error) {
    serverError(res, 'Failed to check ATS readiness');
  }
};

// GET /api/resumes/:id/ats-check: the latest stored result (marked stale when
// the resume text or the rules changed since) and recent history.
export const getAtsCheck = async (req: Request, res: Response) => {
  try {
    const userId = req.user?.id;
    if (!userId) return unauthorized(res);
    if (!isValidResumeId(req.params.id)) return invalidId(res);
    const resume = await resumeService.getResumeTextById(req.params.id, userId);
    if (!resume) return notFound(res);
    const text = resume.extractionStatus === 'completed' ? resume.textContent ?? '' : '';
    const { latest, history } = await getAtsChecks(resume.id, userId, text);
    res.json({ success: true, message: 'ATS readiness retrieved successfully', data: { check: latest, history, scoring: SCORING } });
  } catch (error) {
    serverError(res, 'Failed to retrieve ATS readiness');
  }
};
