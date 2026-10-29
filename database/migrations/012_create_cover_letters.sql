USE ai_resume_analyzer;

-- Saved cover letters (Step 12).
--
-- A letter is generated on request (rule-based, not stored) and saved only when
-- the user chooses to. The resume version and job description it was written
-- for are kept as references; if either is deleted later, the reference is
-- cleared (ON DELETE SET NULL) and the letter, with its copied role and
-- company names, is kept. Deleting the user deletes their letters.
--
-- Run once, after 001-011.

CREATE TABLE IF NOT EXISTS cover_letters (
    id VARCHAR(36) PRIMARY KEY,
    user_id VARCHAR(36) NOT NULL,
    resume_id VARCHAR(36) NULL,
    job_description_id VARCHAR(36) NULL,
    title VARCHAR(200) NOT NULL,
    role_title VARCHAR(200) NULL,
    company_name VARCHAR(200) NULL,
    content TEXT NOT NULL,
    tone VARCHAR(20) NOT NULL,
    length VARCHAR(20) NOT NULL,
    created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    updated_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (resume_id) REFERENCES resumes(id) ON DELETE SET NULL,
    FOREIGN KEY (job_description_id) REFERENCES job_descriptions(id) ON DELETE SET NULL,
    INDEX idx_cover_letters_user_updated (user_id, updated_at),
    CONSTRAINT chk_cover_letter_tone CHECK (tone IN ('professional', 'confident', 'conversational', 'concise')),
    CONSTRAINT chk_cover_letter_length CHECK (length IN ('short', 'standard', 'detailed'))
);
