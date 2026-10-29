import { Router } from 'express';
import {
  createCoverLetter,
  deleteCoverLetter,
  generateCoverLetter,
  getCoverLetter,
  listCoverLetters,
  updateCoverLetter,
} from '../controllers/cover-letter.controller';
import { requireAuth } from '../middleware/auth.middleware';
import { rateLimitPerUser } from '../middleware/rate-limit.middleware';

const router = Router();

router.use(requireAuth);

// Generation runs the resume analysis and the generator: limited per user.
const GENERATE_PER_MINUTE = Number(process.env.COVER_LETTER_GENERATE_PER_MINUTE) || 10;

router.post('/generate', rateLimitPerUser('cover-letter-generate', GENERATE_PER_MINUTE, 60_000), generateCoverLetter);
router.get('/', listCoverLetters);
router.post('/', createCoverLetter);
router.get('/:id', getCoverLetter);
router.put('/:id', updateCoverLetter);
router.delete('/:id', deleteCoverLetter);

export default router;
