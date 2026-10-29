USE ai_resume_analyzer;

-- Saved resume <-> job match results (Step 8A).
--
-- Each row is a snapshot of one completed analysis, as it was when it ran:
-- opening it never recalculates anything, and later edits to the resume or job
-- description do not change it. The labels are copied for the same reason.
--
-- Deletion policy: deleting the user, the resume or the job description deletes
-- its saved matches (ON DELETE CASCADE). Deleting a saved match deletes nothing else.
--
-- The snapshot holds the structured results only: no PDF, file path, raw resume
-- or job-description text, or embedding vectors.
CREATE TABLE IF NOT EXISTS resume_job_matches (
    id VARCHAR(36) PRIMARY KEY,
    user_id VARCHAR(36) NOT NULL,
    resume_id VARCHAR(36) NOT NULL,
    job_description_id VARCHAR(36) NOT NULL,
    resume_filename_snapshot VARCHAR(255) NOT NULL,
    job_title_snapshot VARCHAR(200) NOT NULL,
    company_name_snapshot VARCHAR(200) NULL,
    -- The Step 6B score; NULL when no score could be calculated.
    overall_score DECIMAL(5, 2) NULL,
    result_json JSON NOT NULL,
    -- Millisecond precision keeps newest-first ordering stable for quick successive runs.
    created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (resume_id) REFERENCES resumes(id) ON DELETE CASCADE,
    FOREIGN KEY (job_description_id) REFERENCES job_descriptions(id) ON DELETE CASCADE,
    -- A user's history, newest first (id breaks ties).
    INDEX idx_resume_job_matches_user_created (user_id, created_at, id)
);
