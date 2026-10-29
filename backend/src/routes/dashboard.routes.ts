import { Router } from 'express';
import { getDashboardAnalytics } from '../controllers/dashboard.controller';
import { requireAuth } from '../middleware/auth.middleware';

const router = Router();

router.use(requireAuth);

router.get('/analytics', getDashboardAnalytics);

export default router;
