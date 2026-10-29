import { v4 as uuidv4 } from 'uuid';
import type { PoolConnection } from 'mysql2/promise';
import pool from '../config/database';
import type { InterviewDifficulty, InterviewEvaluation, InterviewQuestion, InterviewType } from './ai.service';

// Mock interviews (Step 16). Every query is scoped to the signed-in user, so
// another user's session or question behaves exactly like one that does not
// exist. Completed sessions are read-only.

export const SCORE_STRONG = 70;
export const SCORE_WEAK = 60;
const AREA_LIMIT = 3;
const CONCEPT_LIMIT = 8;
const STUDY_LIMIT = 6;

type QuestionType = InterviewQuestion['type'];

export interface StoredQuestion {
  id: string;
  position: number;
  type: QuestionType;
  focus: string;
  text: string;
  guidance: string;
  grounding: InterviewQuestion['grounding'];
  draftAnswer: string | null;
  draftSavedAt: Date | null;
  submittedAnswer: string | null;
  submittedAt: Date | null;
  evaluation: InterviewEvaluation | null;
  score: number | null;
  evaluatedAt: Date | null;
}

const json = <T>(value: unknown): T => (typeof value === 'string' ? JSON.parse(value) : value) as T;

const toQuestion = (r: any): StoredQuestion => {
  const data = json<InterviewQuestion>(r.questionData);
  return {
    id: r.id,
    position: Number(r.position),
    type: r.questionType,
    focus: r.focus,
    text: r.questionText,
    guidance: data.guidance ?? '',
    grounding: data.grounding,
    draftAnswer: r.draftAnswer ?? null,
    draftSavedAt: r.draftSavedAt ?? null,
    submittedAnswer: r.submittedAnswer ?? null,
    submittedAt: r.submittedAt ?? null,
    evaluation: r.evaluation ? json<InterviewEvaluation>(r.evaluation) : null,
    score: r.score === null || r.score === undefined ? null : Number(r.score),
    evaluatedAt: r.evaluatedAt ?? null,
  };
};

const QUESTION_COLUMNS = `q.id, q.position, q.question_type as questionType, q.focus, q.question_text as questionText,
  q.question_data as questionData, q.draft_answer as draftAnswer, q.draft_saved_at as draftSavedAt,
  q.submitted_answer as submittedAnswer, q.submitted_at as submittedAt, q.evaluation, q.score, q.evaluated_at as evaluatedAt`;

const SESSION_COLUMNS = `s.id, s.title, s.resume_label as resumeLabel, s.interview_type as interviewType, s.difficulty,
  s.question_count as questionCount, s.status, s.current_position as currentPosition, s.generator_version as generatorVersion,
  s.notes, s.summary, s.created_at as createdAt, s.updated_at as updatedAt, s.completed_at as completedAt,
  r.id as resumeId, jd.id as jobDescriptionId`;
// Links are shown only while they still point at the same user's records.
const SESSION_FROM = `FROM interview_sessions s
  LEFT JOIN resumes r ON r.id = s.resume_id AND r.user_id = s.user_id
  LEFT JOIN job_descriptions jd ON jd.id = s.job_description_id AND jd.user_id = s.user_id`;

const toSession = (r: any) => ({
  id: r.id as string,
  title: r.title as string,
  resumeLabel: r.resumeLabel as string,
  interviewType: r.interviewType as InterviewType,
  difficulty: r.difficulty as InterviewDifficulty,
  questionCount: Number(r.questionCount),
  status: r.status as 'in_progress' | 'completed',
  currentPosition: Number(r.currentPosition),
  generatorVersion: r.generatorVersion as string,
  notes: (r.notes ? json<string[]>(r.notes) : []) as string[],
  resumeId: (r.resumeId ?? null) as string | null,
  jobDescriptionId: (r.jobDescriptionId ?? null) as string | null,
  createdAt: r.createdAt as Date,
  updatedAt: r.updatedAt as Date,
  completedAt: (r.completedAt ?? null) as Date | null,
});

const transaction = async <T>(work: (db: PoolConnection) => Promise<T>) => {
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const result = await work(connection);
    await connection.commit();
    return result;
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
};

export interface NewSession {
  resumeId: string;
  jobDescriptionId: string;
  title: string;
  resumeLabel: string;
  interviewType: InterviewType;
  difficulty: InterviewDifficulty;
  generatorVersion: string;
  notes: string[];
  questions: InterviewQuestion[];
}

export const createSession = (userId: string, s: NewSession) =>
  transaction(async (db) => {
    const id = uuidv4();
    await db.execute(
      `INSERT INTO interview_sessions (id, user_id, resume_id, job_description_id, title, resume_label, interview_type, difficulty,
         question_count, generator_version, notes) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [id, userId, s.resumeId, s.jobDescriptionId, s.title.slice(0, 300), s.resumeLabel.slice(0, 300), s.interviewType, s.difficulty, s.questions.length, s.generatorVersion, JSON.stringify(s.notes)]
    );
    for (const [position, q] of s.questions.entries()) {
      await db.execute(
        `INSERT INTO interview_questions (id, session_id, user_id, position, question_type, focus, question_text, question_data)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [uuidv4(), id, userId, position, q.type, q.focus, q.text, JSON.stringify(q)]
      );
    }
    return id;
  });

export const listSessions = async (userId: string, page: number, limit: number) => {
  const [countRows]: any = await pool.execute('SELECT COUNT(*) as total FROM interview_sessions WHERE user_id = ?', [userId]);
  // query() rather than execute(): MySQL prepared statements reject LIMIT/OFFSET placeholders.
  const [rows]: any = await pool.query(
    `SELECT ${SESSION_COLUMNS},
            (SELECT COUNT(*) FROM interview_questions q WHERE q.session_id = s.id AND q.score IS NOT NULL) as evaluatedCount,
            (SELECT AVG(q.score) FROM interview_questions q WHERE q.session_id = s.id AND q.score IS NOT NULL) as averageScore
       ${SESSION_FROM} WHERE s.user_id = ? ORDER BY s.updated_at DESC, s.id DESC LIMIT ? OFFSET ?`,
    [userId, limit, (page - 1) * limit]
  );
  const total = Number(countRows[0].total);
  return {
    items: rows.map((r: any) => ({
      ...toSession(r),
      evaluatedCount: Number(r.evaluatedCount),
      // Only from evaluated answers; null when there are none.
      averageScore: r.averageScore === null ? null : Math.round(Number(r.averageScore)),
    })) as (ReturnType<typeof toSession> & { evaluatedCount: number; averageScore: number | null })[],
    pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
  };
};

export const getSession = async (userId: string, id: string) => {
  const [rows]: any = await pool.execute(`SELECT ${SESSION_COLUMNS} ${SESSION_FROM} WHERE s.id = ? AND s.user_id = ?`, [id, userId]);
  if (!rows[0]) return null;
  const [questionRows]: any = await pool.execute(
    `SELECT ${QUESTION_COLUMNS} FROM interview_questions q WHERE q.session_id = ? AND q.user_id = ? ORDER BY q.position`,
    [id, userId]
  );
  const questions = questionRows.map(toQuestion) as StoredQuestion[];
  const session = toSession(rows[0]);
  const stored = rows[0].summary ? json<Summary>(rows[0].summary) : null;
  return { session, questions, summary: stored ?? computeSummary(questions) };
};

type Locked = { status: string; questionCount: number } | null;
const lockSession = async (db: PoolConnection, userId: string, id: string): Promise<Locked> => {
  const [rows]: any = await db.execute(
    'SELECT status, question_count as questionCount FROM interview_sessions WHERE id = ? AND user_id = ? FOR UPDATE',
    [id, userId]
  );
  return rows[0] ? { status: rows[0].status, questionCount: Number(rows[0].questionCount) } : null;
};

export type WriteOutcome = 'not_found' | 'completed' | 'ok';

// The question as stored, for evaluation; null unless both the session and question are the user's.
export const getQuestionForAnswer = async (userId: string, sessionId: string, questionId: string) => {
  const [rows]: any = await pool.execute(
    `SELECT s.status, q.question_data as questionData FROM interview_questions q
       JOIN interview_sessions s ON s.id = q.session_id AND s.user_id = q.user_id
      WHERE q.id = ? AND q.session_id = ? AND q.user_id = ?`,
    [questionId, sessionId, userId]
  );
  return rows[0] ? { status: rows[0].status as string, question: json<unknown>(rows[0].questionData) } : null;
};

export const saveDraft = (userId: string, sessionId: string, questionId: string, answer: string): Promise<WriteOutcome> =>
  transaction(async (db) => {
    const session = await lockSession(db, userId, sessionId);
    if (!session) return 'not_found';
    if (session.status !== 'in_progress') return 'completed';
    const [result]: any = await db.execute(
      'UPDATE interview_questions SET draft_answer = ?, draft_saved_at = CURRENT_TIMESTAMP(3) WHERE id = ? AND session_id = ? AND user_id = ?',
      [answer, questionId, sessionId, userId]
    );
    if (result.affectedRows === 0) return 'not_found';
    await db.execute('UPDATE interview_sessions SET updated_at = CURRENT_TIMESTAMP(3) WHERE id = ? AND user_id = ?', [sessionId, userId]);
    return 'ok';
  });

// Stores a successful evaluation together with the answer it was made for.
export const recordEvaluation = (userId: string, sessionId: string, questionId: string, answer: string, evaluation: InterviewEvaluation): Promise<WriteOutcome> =>
  transaction(async (db) => {
    const session = await lockSession(db, userId, sessionId);
    if (!session) return 'not_found';
    if (session.status !== 'in_progress') return 'completed';
    const [result]: any = await db.execute(
      `UPDATE interview_questions
          SET draft_answer = ?, draft_saved_at = CURRENT_TIMESTAMP(3), submitted_answer = ?, submitted_at = CURRENT_TIMESTAMP(3),
              evaluation = ?, score = ?, evaluated_at = CURRENT_TIMESTAMP(3)
        WHERE id = ? AND session_id = ? AND user_id = ?`,
      [answer, answer, JSON.stringify(evaluation), evaluation.score, questionId, sessionId, userId]
    );
    if (result.affectedRows === 0) return 'not_found';
    await db.execute('UPDATE interview_sessions SET updated_at = CURRENT_TIMESTAMP(3) WHERE id = ? AND user_id = ?', [sessionId, userId]);
    return 'ok';
  });

export const setPosition = (userId: string, sessionId: string, position: number): Promise<WriteOutcome | 'out_of_range'> =>
  transaction(async (db) => {
    const session = await lockSession(db, userId, sessionId);
    if (!session) return 'not_found';
    if (session.status !== 'in_progress') return 'completed';
    if (position >= session.questionCount) return 'out_of_range';
    await db.execute('UPDATE interview_sessions SET current_position = ? WHERE id = ? AND user_id = ?', [position, sessionId, userId]);
    return 'ok';
  });

// Freezes the summary. Completing an already completed session changes nothing.
export const completeSession = (userId: string, sessionId: string): Promise<'not_found' | 'ok'> =>
  transaction(async (db) => {
    const session = await lockSession(db, userId, sessionId);
    if (!session) return 'not_found';
    if (session.status === 'completed') return 'ok';
    const [rows]: any = await db.execute(
      `SELECT ${QUESTION_COLUMNS} FROM interview_questions q WHERE q.session_id = ? AND q.user_id = ? ORDER BY q.position`,
      [sessionId, userId]
    );
    const summary = computeSummary(rows.map(toQuestion));
    await db.execute(
      `UPDATE interview_sessions SET status = 'completed', completed_at = CURRENT_TIMESTAMP(3), summary = ? WHERE id = ? AND user_id = ?`,
      [JSON.stringify(summary), sessionId, userId]
    );
    return 'ok';
  });

export const deleteSession = async (userId: string, id: string) => {
  const [result]: any = await pool.execute('DELETE FROM interview_sessions WHERE id = ? AND user_id = ?', [id, userId]);
  return result.affectedRows > 0;
};

// ---- Summary ----

type Area = { focus: string; type: QuestionType; score: number };

// Statistics are calculated exactly from stored scores; the "feedback" part
// gathers the automated feedback (areas and missed concepts) across answers.
export const computeSummary = (questions: Pick<StoredQuestion, 'type' | 'focus' | 'score' | 'evaluation' | 'draftAnswer'>[]) => {
  const evaluated = questions.filter((q) => q.score !== null && q.evaluation);
  const scores = evaluated.map((q) => q.score as number);
  const average = (list: number[]) => (list.length ? Math.round(list.reduce((a, b) => a + b, 0) / list.length) : null);
  const byType = Object.fromEntries(
    (['technical', 'behavioral', 'hr'] as const)
      .filter((t) => questions.some((q) => q.type === t))
      .map((t) => {
        const ofType = questions.filter((q) => q.type === t);
        const s = ofType.filter((q) => q.score !== null).map((q) => q.score as number);
        return [t, { questions: ofType.length, evaluated: s.length, averageScore: average(s) }];
      })
  );

  const areas: Area[] = evaluated.map((q) => ({ focus: q.focus, type: q.type, score: q.score as number }));
  const strongest = areas.filter((a) => a.score >= SCORE_STRONG).sort((a, b) => b.score - a.score).slice(0, AREA_LIMIT);
  const weakest = areas.filter((a) => a.score < SCORE_WEAK).sort((a, b) => a.score - b.score).slice(0, AREA_LIMIT);

  const counts = new Map<string, number>();
  for (const q of evaluated) for (const c of new Set(q.evaluation!.conceptsToReview)) counts.set(c, (counts.get(c) ?? 0) + 1);
  // Most often missed first; ties keep the order they first appeared in.
  const missed = [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, CONCEPT_LIMIT).map(([concept, count]) => ({ concept, count }));

  const studyNext = [...new Set([...weakest.map((a) => (a.type === 'technical' ? a.focus : `${a.focus} (practise with a real example)`)), ...missed.map((m) => m.concept)])].slice(0, STUDY_LIMIT);

  return {
    statistics: {
      totalQuestions: questions.length,
      evaluated: evaluated.length,
      draftOnly: questions.filter((q) => q.score === null && q.draftAnswer && q.draftAnswer.trim()).length,
      unanswered: questions.filter((q) => q.score === null && !(q.draftAnswer && q.draftAnswer.trim())).length,
      // Average, highest and lowest come only from evaluated answers; null when there are none.
      averageScore: average(scores),
      highestScore: scores.length ? Math.max(...scores) : null,
      lowestScore: scores.length ? Math.min(...scores) : null,
      byType,
    },
    feedback: {
      strongestAreas: strongest,
      areasToImprove: weakest,
      frequentlyMissedConcepts: missed,
      studyNext,
    },
  };
};
export type Summary = ReturnType<typeof computeSummary>;
