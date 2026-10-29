import { Router } from 'express';
import {
  completeInterview,
  createInterview,
  deleteInterview,
  getInterview,
  getSummary,
  listInterviews,
  saveDraft,
  setPosition,
  submitAnswer,
} from '../controllers/interview.controller';
import { requireAuth } from '../middleware/auth.middleware';
import { rateLimitPerUser } from '../middleware/rate-limit.middleware';

const router = Router();

router.use(requireAuth);

// Creating runs the resume analysis and question generation; evaluating calls the AI service.
const CREATE_PER_MINUTE = Number(process.env.INTERVIEW_CREATE_PER_MINUTE) || 5;
const EVALUATE_PER_MINUTE = Number(process.env.INTERVIEW_EVALUATE_PER_MINUTE) || 30;
const DRAFTS_PER_MINUTE = Number(process.env.INTERVIEW_DRAFTS_PER_MINUTE) || 120;

router.get('/', listInterviews);
router.post('/', rateLimitPerUser('interview-create', CREATE_PER_MINUTE, 60_000), createInterview);
router.get('/:id', getInterview);
router.get('/:id/summary', getSummary);
router.put('/:id/questions/:questionId/draft', rateLimitPerUser('interview-draft', DRAFTS_PER_MINUTE, 60_000), saveDraft);
router.post('/:id/questions/:questionId/submit', rateLimitPerUser('interview-evaluate', EVALUATE_PER_MINUTE, 60_000), submitAnswer);
router.patch('/:id/position', setPosition);
router.post('/:id/complete', completeInterview);
router.delete('/:id', deleteInterview);

export default router;
