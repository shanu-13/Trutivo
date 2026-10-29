import { Request, Response } from 'express';
import { z } from 'zod';
import * as resumeService from '../services/resume.service';
import * as jobDescriptionService from '../services/job-description.service';
import * as aiService from '../services/ai.service';
import * as interviews from '../services/interview.service';
import { INTERVIEW_DIFFICULTIES, INTERVIEW_TYPES } from '../services/ai.service';
import { isValidResumeId as isUuid } from './resume-version.controller';
import { DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE, fromZod } from './job-application.controller';

// Mock interviews (Step 16): questions and feedback come from the rule-based AI
// service; sessions, answers and the summary are stored here.

const envInt = (name: string, fallback: number, min: number, max: number) => {
  const n = Number(process.env[name]);
  return Number.isInteger(n) && n >= min && n <= max ? n : fallback;
};
// The AI service accepts at most 15.
export const MAX_QUESTIONS = envInt('INTERVIEW_MAX_QUESTIONS', 10, 1, 15);
export const MAX_ANSWER_CHARS = envInt('INTERVIEW_ANSWER_MAX_CHARS', 5000, 100, 10_000);

const unauthorized = (res: Response) =>
  res.status(401).json({ success: false, message: 'Unauthorized', error: { code: 'UNAUTHORIZED', details: null } });
const notFound = (res: Response, message = 'Interview not found') =>
  res.status(404).json({ success: false, message, error: { code: 'NOT_FOUND', details: null } });
const invalidId = (res: Response) =>
  res.status(400).json({ success: false, message: 'Invalid id', error: { code: 'INVALID_ID', details: null } });
const serverError = (res: Response, message: string) =>
  res.status(500).json({ success: false, message, error: { code: 'SERVER_ERROR', details: null } });
const validationError = (res: Response, issues: { field: string; message: string }[]) =>
  res.status(400).json({ success: false, message: 'Please correct the highlighted fields', error: { code: 'VALIDATION_ERROR', details: issues } });
const completed = (res: Response) =>
  res.status(409).json({ success: false, message: 'This interview is completed and can no longer be changed.', error: { code: 'INTERVIEW_COMPLETED', details: null } });
const aiError = (res: Response, error: aiService.AiServiceError, extra: Record<string, unknown> | null = null) =>
  res.status(error.statusCode).json({ success: false, message: error.message, error: { code: error.code, details: extra } });

const uuid = z.string().refine(isUuid, 'Must be a valid id');
export const createSchema = z
  .object({
    resumeId: uuid,
    jobDescriptionId: uuid,
    interviewType: z.enum(INTERVIEW_TYPES),
    difficulty: z.enum(INTERVIEW_DIFFICULTIES),
    questionCount: z.number().int().min(1, 'At least 1 question').max(MAX_QUESTIONS, `At most ${MAX_QUESTIONS} questions`),
  })
  .strict();

// Line breaks kept, other control characters refused.
const answerText = z
  .string()
  .transform((s) => s.replace(/\r\n?/g, '\n'))
  .refine((s) => !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(s), 'Contains invalid characters')
  .refine((s) => s.length <= MAX_ANSWER_CHARS, `Must be at most ${MAX_ANSWER_CHARS.toLocaleString()} characters`);
// A draft may be empty (clearing it); a submitted answer may not.
export const draftSchema = z.object({ answer: answerText }).strict();
export const submitSchema = z.object({ answer: answerText.refine((s) => s.trim().length > 0, 'Write an answer before submitting') }).strict();
export const positionSchema = z.object({ position: z.number().int().min(0) }).strict();

const ids = (req: Request) => [req.params.id, req.params.questionId].filter((v) => v !== undefined).every(isUuid);

// POST /api/interviews  { resumeId, jobDescriptionId, interviewType, difficulty, questionCount }
export const createInterview = async (req: Request, res: Response) => {
  try {
    const userId = req.user?.id;
    if (!userId) return unauthorized(res);
    const body = createSchema.safeParse(req.body ?? {});
    if (!body.success) return validationError(res, fromZod(body.error));
    const { resumeId, jobDescriptionId, interviewType, difficulty, questionCount } = body.data;

    // Both looked up for this user only; either missing gives the same answer.
    const [resume, resumeText, job] = await Promise.all([
      resumeService.getResumeById(resumeId, userId),
      resumeService.getResumeTextById(resumeId, userId),
      jobDescriptionService.getJobDescriptionById(jobDescriptionId, userId),
    ]);
    if (!resume || !resumeText || !job) return notFound(res, 'Resume or job description not found');
    if (resumeText.extractionStatus !== 'completed' || !resumeText.textContent) {
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

    const analysis = await aiService.analyzeResume(resumeText.id, resumeText.textContent);
    const facts = aiService.toCoverLetterFacts(analysis.resume, requirements, { title: job.title, companyName: job.companyName });
    const set = await aiService.generateInterviewQuestions(facts, { interviewType, difficulty, count: questionCount });
    const id = await interviews.createSession(userId, {
      resumeId,
      jobDescriptionId,
      title: `${job.title}${job.companyName ? ` — ${job.companyName}` : ''}`,
      resumeLabel: `${resume.originalFilename} (version ${resume.versionNumber})`,
      interviewType,
      difficulty,
      generatorVersion: set.generatorVersion,
      notes: set.notes,
      questions: set.questions,
    });
    res.status(201).json({ success: true, message: 'Mock interview created successfully', data: await interviews.getSession(userId, id) });
  } catch (error) {
    if (error instanceof aiService.AiServiceError) return aiError(res, error);
    serverError(res, 'Failed to create the mock interview');
  }
};

// GET /api/interviews?page=&limit=
export const listInterviews = async (req: Request, res: Response) => {
  try {
    const userId = req.user?.id;
    if (!userId) return unauthorized(res);
    const page = req.query.page === undefined ? 1 : Number(req.query.page);
    const limit = req.query.limit === undefined ? DEFAULT_PAGE_SIZE : Number(req.query.limit);
    const issues = [];
    if (!Number.isInteger(page) || page < 1 || page > 100_000) issues.push({ field: 'page', message: 'Must be a whole number from 1 to 100000' });
    if (!Number.isInteger(limit) || limit < 1 || limit > MAX_PAGE_SIZE) issues.push({ field: 'limit', message: `Must be a whole number from 1 to ${MAX_PAGE_SIZE}` });
    if (issues.length) return validationError(res, issues);
    res.json({ success: true, message: 'Mock interviews retrieved successfully', data: { ...(await interviews.listSessions(userId, page, limit)), limits: { maxQuestions: MAX_QUESTIONS, maxAnswerChars: MAX_ANSWER_CHARS } } });
  } catch (error) {
    serverError(res, 'Failed to retrieve mock interviews');
  }
};

// GET /api/interviews/:id  (session, questions with drafts and feedback, summary so far)
export const getInterview = async (req: Request, res: Response) => {
  try {
    const userId = req.user?.id;
    if (!userId) return unauthorized(res);
    if (!ids(req)) return invalidId(res);
    const data = await interviews.getSession(userId, req.params.id);
    if (!data) return notFound(res);
    res.json({ success: true, message: 'Mock interview retrieved successfully', data: { ...data, limits: { maxAnswerChars: MAX_ANSWER_CHARS } } });
  } catch (error) {
    serverError(res, 'Failed to retrieve the mock interview');
  }
};

// GET /api/interviews/:id/summary  (final once completed; a running summary before)
export const getSummary = async (req: Request, res: Response) => {
  try {
    const userId = req.user?.id;
    if (!userId) return unauthorized(res);
    if (!ids(req)) return invalidId(res);
    const data = await interviews.getSession(userId, req.params.id);
    if (!data) return notFound(res);
    res.json({ success: true, message: 'Interview summary retrieved successfully', data: { summary: data.summary, final: data.session.status === 'completed' } });
  } catch (error) {
    serverError(res, 'Failed to retrieve the interview summary');
  }
};

// PUT /api/interviews/:id/questions/:questionId/draft  { answer }
export const saveDraft = async (req: Request, res: Response) => {
  try {
    const userId = req.user?.id;
    if (!userId) return unauthorized(res);
    if (!ids(req)) return invalidId(res);
    const body = draftSchema.safeParse(req.body ?? {});
    if (!body.success) return validationError(res, fromZod(body.error));
    const outcome = await interviews.saveDraft(userId, req.params.id, req.params.questionId, body.data.answer);
    if (outcome === 'not_found') return notFound(res, 'Question not found');
    if (outcome === 'completed') return completed(res);
    res.json({ success: true, message: 'Draft saved', data: { savedAt: new Date().toISOString() } });
  } catch (error) {
    serverError(res, 'Failed to save the draft');
  }
};

// POST /api/interviews/:id/questions/:questionId/submit  { answer }
export const submitAnswer = async (req: Request, res: Response) => {
  try {
    const userId = req.user?.id;
    if (!userId) return unauthorized(res);
    if (!ids(req)) return invalidId(res);
    const body = submitSchema.safeParse(req.body ?? {});
    if (!body.success) return validationError(res, fromZod(body.error));
    const { id, questionId } = req.params;
    const stored = await interviews.getQuestionForAnswer(userId, id, questionId);
    if (!stored) return notFound(res, 'Question not found');
    if (stored.status !== 'in_progress') return completed(res);
    const question = aiService.parseInterviewQuestion(stored.question);
    if (!question.success) return serverError(res, 'This question cannot be evaluated');

    let evaluation;
    try {
      evaluation = await aiService.evaluateInterviewAnswer(question.data, body.data.answer);
    } catch (error) {
      if (!(error instanceof aiService.AiServiceError)) throw error;
      // Nothing is scored, but the answer is kept as a draft so it is not lost.
      const kept = (await interviews.saveDraft(userId, id, questionId, body.data.answer)) === 'ok';
      return aiError(res, error, { draftSaved: kept });
    }
    const outcome = await interviews.recordEvaluation(userId, id, questionId, body.data.answer, evaluation);
    if (outcome === 'not_found') return notFound(res, 'Question not found');
    if (outcome === 'completed') return completed(res);
    res.json({ success: true, message: 'Answer evaluated', data: { evaluation, score: evaluation.score } });
  } catch (error) {
    serverError(res, 'Failed to evaluate the answer');
  }
};

// PATCH /api/interviews/:id/position  { position }  (where to continue later)
export const setPosition = async (req: Request, res: Response) => {
  try {
    const userId = req.user?.id;
    if (!userId) return unauthorized(res);
    if (!ids(req)) return invalidId(res);
    const body = positionSchema.safeParse(req.body ?? {});
    if (!body.success) return validationError(res, fromZod(body.error));
    const outcome = await interviews.setPosition(userId, req.params.id, body.data.position);
    if (outcome === 'not_found') return notFound(res);
    if (outcome === 'completed') return completed(res);
    if (outcome === 'out_of_range') return validationError(res, [{ field: 'position', message: 'No question at this position' }]);
    res.json({ success: true, message: 'Position saved', data: { position: body.data.position } });
  } catch (error) {
    serverError(res, 'Failed to save the position');
  }
};

// POST /api/interviews/:id/complete  (idempotent; unanswered questions are allowed)
export const completeInterview = async (req: Request, res: Response) => {
  try {
    const userId = req.user?.id;
    if (!userId) return unauthorized(res);
    if (!ids(req)) return invalidId(res);
    if ((await interviews.completeSession(userId, req.params.id)) === 'not_found') return notFound(res);
    res.json({ success: true, message: 'Mock interview completed', data: await interviews.getSession(userId, req.params.id) });
  } catch (error) {
    serverError(res, 'Failed to complete the mock interview');
  }
};

// DELETE /api/interviews/:id
export const deleteInterview = async (req: Request, res: Response) => {
  try {
    const userId = req.user?.id;
    if (!userId) return unauthorized(res);
    if (!ids(req)) return invalidId(res);
    if (!(await interviews.deleteSession(userId, req.params.id))) return notFound(res);
    res.json({ success: true, message: 'Mock interview deleted', data: null });
  } catch (error) {
    serverError(res, 'Failed to delete the mock interview');
  }
};
