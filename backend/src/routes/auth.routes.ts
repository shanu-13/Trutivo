import { Router } from 'express';
import { register, login, logout, getCurrentUser } from '../controllers/auth.controller';
import { requireAuth } from '../middleware/auth.middleware';
import { rateLimitPerIp } from '../middleware/rate-limit.middleware';

const router = Router();

// Slows down password guessing and mass sign-ups (per client IP, per backend process).
const LOGIN_PER_15_MIN = Number(process.env.LOGIN_ATTEMPTS_PER_15_MIN) || 20;
const REGISTER_PER_HOUR = Number(process.env.REGISTRATIONS_PER_HOUR) || 10;

router.post('/register', rateLimitPerIp('register', REGISTER_PER_HOUR, 60 * 60_000), register);
router.post('/login', rateLimitPerIp('login', LOGIN_PER_15_MIN, 15 * 60_000), login);
router.post('/logout', logout);
router.get('/me', requireAuth, getCurrentUser);

export default router;
