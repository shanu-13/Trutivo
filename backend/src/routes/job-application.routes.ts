import { Router } from 'express';
import {
  createApplication,
  deleteApplication,
  getApplication,
  getHistory,
  getInsights,
  getMetrics,
  listApplications,
  updateApplication,
} from '../controllers/job-application.controller';
import { requireAuth } from '../middleware/auth.middleware';

const router = Router();

router.use(requireAuth);

router.get('/metrics', getMetrics);
router.get('/insights', getInsights);
router.get('/', listApplications);
router.post('/', createApplication);
router.get('/:id', getApplication);
router.get('/:id/history', getHistory);
router.put('/:id', updateApplication);
router.delete('/:id', deleteApplication);

export default router;
