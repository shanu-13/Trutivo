// Loads and validates the environment first; exits with a clear message if it is invalid.
import { config } from './config/env';
import express from 'express';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import authRoutes from './routes/auth.routes';
import resumeRoutes from './routes/resume.routes';
import jobDescriptionRoutes from './routes/job-description.routes';
import matchHistoryRoutes from './routes/match-history.routes';
import dashboardRoutes from './routes/dashboard.routes';
import coverLetterRoutes from './routes/cover-letter.routes';
import jobApplicationRoutes from './routes/job-application.routes';
import reminderRoutes from './routes/reminder.routes';
import interviewRoutes from './routes/interview.routes';
import { checkAiServiceHealth } from './services/ai.service';

const app = express();
const port = process.env.PORT || 5000;

app.disable('x-powered-by');
app.set('trust proxy', config.trustProxy);
// Baseline security headers for a JSON API (no new dependency needed).
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Content-Security-Policy', "default-src 'none'; frame-ancestors 'none'");
  res.setHeader('Cross-Origin-Resource-Policy', 'same-site');
  if (config.cookieSecure) res.setHeader('Strict-Transport-Security', 'max-age=15552000; includeSubDomains');
  next();
});

app.use(cors({
  // FRONTEND_URL may list several origins separated by commas.
  origin: config.frontendOrigins,
  credentials: true,
  // Lets the frontend read the safe filename of downloaded files.
  exposedHeaders: ['Content-Disposition']
}));
// Job descriptions can be up to 50,000 characters, which exceeds the 100kb default in UTF-8.
app.use(express.json({ limit: '1mb' }));
app.use(cookieParser());

app.use('/api/auth', authRoutes);
app.use('/api/resumes', resumeRoutes);
app.use('/api/job-descriptions', jobDescriptionRoutes);
app.use('/api/match-history', matchHistoryRoutes);
app.use('/api/dashboard', dashboardRoutes);
app.use('/api/cover-letters', coverLetterRoutes);
app.use('/api/applications', jobApplicationRoutes);
app.use('/api/reminders', reminderRoutes);
app.use('/api/interviews', interviewRoutes);

app.get('/api/health', (req, res) => {
  res.json({
    success: true,
    message: "Backend is running"
  });
});

app.get('/api/health/ai', async (req, res) => {
  if (await checkAiServiceHealth()) {
    return res.json({
      success: true,
      message: "AI service is healthy",
      data: { status: "healthy" }
    });
  }
  res.status(503).json({
    success: false,
    message: "AI service is unavailable",
    error: { code: "AI_SERVICE_UNAVAILABLE", details: null }
  });
});

import pool from './config/database';
import { v4 as uuidv4 } from 'uuid';

app.get('/api/health/db', async (req, res) => {
  try {
    const connection = await pool.getConnection();
    connection.release();
    res.json({
      success: true,
      message: "Database connection successful",
      data: null
    });
  } catch (error: any) {
    res.status(500).json({
      success: false,
      message: "Database connection failed",
      error: {
        code: "DATABASE_ERROR",
        details: null // Prevent exposing credentials
      }
    });
  }
});

// Development-only self-test that writes to the users table: never registered in
// production, and only with ENABLE_TEST_ROUTES=true otherwise.
if (config.enableTestRoutes) app.get('/api/test/db-ops', async (req, res) => {
  try {
    const testId = uuidv4();
    const testEmail = `test_${Date.now()}@example.com`;
    const testPasswordHash = 'dummy_hash_do_not_use';
    
    // 1 & 2. Insert test user
    const [insertResult] = await pool.execute(
      'INSERT INTO users (id, name, email, password_hash) VALUES (?, ?, ?, ?)',
      [testId, 'Test User', testEmail, testPasswordHash]
    );

    // 3. Retrieve test user
    const [rows]: any = await pool.execute('SELECT id, name, email FROM users WHERE id = ?', [testId]);
    const retrievedUser = rows[0];

    // 4. Duplicate email test
    let duplicateError = false;
    try {
      await pool.execute(
        'INSERT INTO users (id, name, email, password_hash) VALUES (?, ?, ?, ?)',
        [uuidv4(), 'Duplicate User', testEmail, 'another_hash']
      );
    } catch (err) {
      duplicateError = true;
    }

    // 5. Cleanup
    await pool.execute('DELETE FROM users WHERE id = ?', [testId]);

    res.json({
      success: true,
      message: "Database operations verified",
      data: {
        inserted: true,
        retrievedUser,
        duplicatePrevented: duplicateError,
        cleanedUp: true
      }
    });
  } catch (error: any) {
    res.status(500).json({
      success: false,
      message: "Database operations test failed",
      error: {
        code: error.code || "DB_TEST_ERROR",
        details: null
      }
    });
  }
});

// Unknown API routes answer in the standard JSON error format.
app.use('/api', (req, res) => {
  res.status(404).json({ success: false, message: 'Not found', error: { code: 'NOT_FOUND', details: null } });
});

app.use((err: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
  // Body-parser errors are client mistakes; answer them without logging the request body.
  if (err?.type === 'entity.parse.failed') {
    return res.status(400).json({ success: false, message: 'Invalid JSON body', error: { code: 'INVALID_JSON', details: null } });
  }
  if (err?.type === 'entity.too.large') {
    return res.status(413).json({ success: false, message: 'Request body is too large', error: { code: 'PAYLOAD_TOO_LARGE', details: null } });
  }
  console.error(err.stack);
  res.status(500).json({ success: false, message: 'Internal Server Error' });
});

app.listen(port, () => {
  console.log(`Server is running on port ${port}`);
});
