import { Router } from 'express';
import {
  acceptSuggestion,
  createReminder,
  deleteReminder,
  getReminder,
  getSuggestions,
  getSummary,
  listReminders,
  setStatus,
  updateReminder,
} from '../controllers/reminder.controller';
import { requireAuth } from '../middleware/auth.middleware';

const router = Router();

router.use(requireAuth);

router.get('/summary', getSummary);
router.get('/suggestions', getSuggestions);
router.post('/suggestions/accept', acceptSuggestion);
router.get('/', listReminders);
router.post('/', createReminder);
router.get('/:id', getReminder);
router.put('/:id', updateReminder);
router.post('/:id/complete', setStatus('completed', 'Reminder marked as done'));
router.post('/:id/dismiss', setStatus('dismissed', 'Reminder dismissed'));
router.post('/:id/reopen', setStatus('pending', 'Reminder reopened'));
router.delete('/:id', deleteReminder);

export default router;
