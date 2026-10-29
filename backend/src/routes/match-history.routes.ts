import { Router } from 'express';
import { listMatchHistory, getMatchHistory, deleteMatchHistory } from '../controllers/match-history.controller';
import { requireAuth } from '../middleware/auth.middleware';

const router = Router();

router.use(requireAuth);

router.get('/', listMatchHistory);
router.get('/:id', getMatchHistory);
router.delete('/:id', deleteMatchHistory);

export default router;
