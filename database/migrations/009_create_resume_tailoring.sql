USE ai_resume_analyzer;

-- Job-specific resume tailoring (Step 9C).
--
-- A tailoring session holds rule-based suggestions for one resume and one job
-- description, and the user's decision on each. Suggestions reference single
-- lines of the resume's extracted text; the resume itself is never changed.
-- Saving a session creates a new resume version ("tailored" source type) that
-- contains the extracted text with the accepted changes applied.
--
-- Deletion policy: deleting the user, the source resume or the job description
-- deletes its sessions (ON DELETE CASCADE). A saved tailored copy is a separate
-- resume version and is kept; deleting it only clears the session's link.
--
-- Run once, after 001-008.

-- 'upload' for uploaded files, 'tailored' for copies saved from a tailoring
-- session. Tailored copies are never made current automatically.
ALTER TABLE resumes
    ADD COLUMN source_type VARCHAR(20) NOT NULL DEFAULT 'upload' AFTER is_current,
    ADD CONSTRAINT chk_resumes_source_type CHECK (source_type IN ('upload', 'tailored'));

CREATE TABLE IF NOT EXISTS resume_tailoring_sessions (
    id VARCHAR(36) PRIMARY KEY,
    user_id VARCHAR(36) NOT NULL,
    resume_id VARCHAR(36) NOT NULL,
    job_description_id VARCHAR(36) NOT NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'draft',
    -- Requirement coverage and advice computed with the suggestions (no full resume text).
    requirements_json JSON NOT NULL,
    notes_json JSON NOT NULL,
    -- The tailored copy saved from this session; unique so one session saves at most one copy.
    saved_resume_id VARCHAR(36) NULL,
    created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    updated_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (resume_id) REFERENCES resumes(id) ON DELETE CASCADE,
    FOREIGN KEY (job_description_id) REFERENCES job_descriptions(id) ON DELETE CASCADE,
    FOREIGN KEY (saved_resume_id) REFERENCES resumes(id) ON DELETE SET NULL,
    UNIQUE KEY uq_tailoring_saved_resume (saved_resume_id),
    INDEX idx_tailoring_user_resume (user_id, resume_id, created_at),
    CONSTRAINT chk_tailoring_status CHECK (status IN ('draft', 'saved'))
);

CREATE TABLE IF NOT EXISTS resume_tailoring_suggestions (
    id VARCHAR(36) PRIMARY KEY,
    session_id VARCHAR(36) NOT NULL,
    position INT UNSIGNED NOT NULL,
    category VARCHAR(20) NOT NULL,
    section VARCHAR(20) NOT NULL,
    -- The line of the resume text this suggestion replaces, and that line as it was.
    line_index INT UNSIGNED NOT NULL,
    original_text TEXT NOT NULL,
    -- The proposed line; empty means "remove this line".
    suggested_text TEXT NOT NULL,
    -- The user's own wording, when they edited the suggestion before accepting it.
    edited_text TEXT NULL,
    entry_label VARCHAR(300) NULL,
    reason VARCHAR(600) NOT NULL,
    related_requirements JSON NOT NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'pending',
    created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    updated_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
    FOREIGN KEY (session_id) REFERENCES resume_tailoring_sessions(id) ON DELETE CASCADE,
    UNIQUE KEY uq_tailoring_suggestion_position (session_id, position),
    CONSTRAINT chk_tailoring_suggestion_status CHECK (status IN ('pending', 'accepted', 'edited', 'rejected')),
    CONSTRAINT chk_tailoring_suggestion_category CHECK (category IN ('skills', 'experience', 'projects', 'structure'))
);
