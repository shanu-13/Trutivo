USE ai_resume_analyzer;

-- Mock interviews (Step 16).
--
-- interview_sessions: one practice interview owned by one user, created from one
-- of their resume versions and one of their job descriptions. If either is
-- deleted later the session is kept (the link becomes NULL); title and
-- resume_label keep what the session was for. The summary is frozen when the
-- session is completed; completed sessions are read-only.
--
-- interview_questions: the generated questions in order, with the expected
-- points used for feedback (question_data), the latest draft, the last
-- submitted answer and its rule-based evaluation. A draft and a submitted
-- answer are kept separately so a failed evaluation never loses text.
--
-- Run once, after 001-014 (npm run migrate).

CREATE TABLE IF NOT EXISTS interview_sessions (
    id VARCHAR(36) PRIMARY KEY,
    user_id VARCHAR(36) NOT NULL,
    resume_id VARCHAR(36) NULL,
    job_description_id VARCHAR(36) NULL,
    title VARCHAR(300) NOT NULL,
    resume_label VARCHAR(300) NOT NULL,
    interview_type VARCHAR(20) NOT NULL,
    difficulty VARCHAR(20) NOT NULL,
    question_count TINYINT UNSIGNED NOT NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'in_progress',
    current_position TINYINT UNSIGNED NOT NULL DEFAULT 0,
    generator_version VARCHAR(20) NOT NULL,
    -- Notes from question generation, e.g. job skills the resume does not list.
    notes JSON NULL,
    summary JSON NULL,
    created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    updated_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
    completed_at TIMESTAMP(3) NULL,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (resume_id) REFERENCES resumes(id) ON DELETE SET NULL,
    FOREIGN KEY (job_description_id) REFERENCES job_descriptions(id) ON DELETE SET NULL,
    INDEX idx_interview_sessions_user_updated (user_id, updated_at),
    CONSTRAINT chk_interview_type CHECK (interview_type IN ('technical', 'behavioral', 'hr', 'mixed')),
    CONSTRAINT chk_interview_difficulty CHECK (difficulty IN ('beginner', 'intermediate', 'advanced')),
    CONSTRAINT chk_interview_status CHECK (status IN ('in_progress', 'completed')),
    CONSTRAINT chk_interview_completed CHECK ((status = 'completed') = (completed_at IS NOT NULL)),
    CONSTRAINT chk_interview_position CHECK (current_position < question_count)
);

CREATE TABLE IF NOT EXISTS interview_questions (
    id VARCHAR(36) PRIMARY KEY,
    session_id VARCHAR(36) NOT NULL,
    user_id VARCHAR(36) NOT NULL,
    position TINYINT UNSIGNED NOT NULL,
    question_type VARCHAR(20) NOT NULL,
    focus VARCHAR(200) NOT NULL,
    question_text VARCHAR(1000) NOT NULL,
    -- Expected points, grounding and guidance, as returned by the AI service and validated.
    question_data JSON NOT NULL,
    draft_answer TEXT NULL,
    draft_saved_at TIMESTAMP(3) NULL,
    submitted_answer TEXT NULL,
    submitted_at TIMESTAMP(3) NULL,
    evaluation JSON NULL,
    score TINYINT UNSIGNED NULL,
    evaluated_at TIMESTAMP(3) NULL,
    FOREIGN KEY (session_id) REFERENCES interview_sessions(id) ON DELETE CASCADE,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    UNIQUE KEY uq_interview_question_position (session_id, position),
    CONSTRAINT chk_interview_question_type CHECK (question_type IN ('technical', 'behavioral', 'hr')),
    CONSTRAINT chk_interview_score CHECK (score IS NULL OR score <= 100),
    -- A score exists exactly when there is an evaluation.
    CONSTRAINT chk_interview_evaluated CHECK ((score IS NULL) = (evaluation IS NULL) AND (score IS NULL) = (evaluated_at IS NULL))
);
