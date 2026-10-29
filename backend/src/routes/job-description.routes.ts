import { Router } from 'express';
import {
  createJobDescription,
  listJobDescriptions,
  getJobDescription,
  updateJobDescription,
  deleteJobDescription,
  processJobDescription,
  extractRequirements,
  getRequirements,
} from '../controllers/job-description.controller';
import { requireAuth } from '../middleware/auth.middleware';

const router = Router();

router.use(requireAuth);

router.post('/', createJobDescription);
router.get('/', listJobDescriptions);
router.get('/:id', getJobDescription);
router.put('/:id', updateJobDescription);
router.delete('/:id', deleteJobDescription);
router.post('/:id/process', processJobDescription);
router.post('/:id/extract-requirements', extractRequirements);
router.get('/:id/requirements', getRequirements);

export default router;
