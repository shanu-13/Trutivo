USE ai_resume_analyzer;

-- ATS readiness checks (Step 11).
--
-- Each row is one run of the deterministic readiness checks for one resume
-- version: the score (NULL when the evaluation was incomplete), the rules
-- version, a SHA-256 of the extracted text that was checked, and the result
-- (categories, checks, strengths, recommendations; contact details masked).
-- When the version's text changes (re-extraction) or the rules change, the
-- stored result is shown as out of date until the user checks again.
-- Optional job relevance is computed on request and not stored here.
--
-- Deletion: deleting the user or the resume version deletes its checks.
-- Run once, after 001-010.

CREATE TABLE IF NOT EXISTS resume_ats_checks (
    id VARCHAR(36) PRIMARY KEY,
    user_id VARCHAR(36) NOT NULL,
    resume_id VARCHAR(36) NOT NULL,
    score TINYINT UNSIGNED NULL,
    band VARCHAR(20) NULL,
    complete TINYINT(1) NOT NULL,
    rules_version VARCHAR(10) NOT NULL,
    text_sha256 CHAR(64) NOT NULL,
    result_json JSON NOT NULL,
    created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (resume_id) REFERENCES resumes(id) ON DELETE CASCADE,
    INDEX idx_ats_checks_user_resume (user_id, resume_id, created_at),
    CONSTRAINT chk_ats_score CHECK (score IS NULL OR score <= 100)
);
