USE ai_resume_analyzer;

-- Job application tracker (Step 13).
--
-- job_applications: one row per application the user tracks. Only the job
-- title and company are required. The application date is only ever what the
-- user entered (never set automatically). The current interview and follow-up
-- are optional columns; earlier values are kept in the history.
--   * interview_at is stored in UTC (DATETIME without time zone).
--   * applied_on and follow_up_on are calendar dates as the user entered them.
-- Links to a job description, resume version and cover letter are optional and
-- cleared (ON DELETE SET NULL) if those are deleted; the application is kept.
--
-- job_application_events: append-only history written by the server
-- (created, status changes, interview and follow-up changes, edited fields).
-- It stores field names and statuses, not the text of notes or contact details.
-- Deleting an application deletes its history; changing its status never does.
--
-- Run once, after 001-012.

CREATE TABLE IF NOT EXISTS job_applications (
    id VARCHAR(36) PRIMARY KEY,
    user_id VARCHAR(36) NOT NULL,
    job_title VARCHAR(200) NOT NULL,
    company_name VARCHAR(200) NOT NULL,
    posting_url VARCHAR(2048) NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'wishlist',
    applied_on DATE NULL,
    location VARCHAR(200) NULL,
    employment_type VARCHAR(20) NULL,
    compensation_notes VARCHAR(500) NULL,
    contact_name VARCHAR(200) NULL,
    contact_email VARCHAR(254) NULL,
    contact_phone VARCHAR(50) NULL,
    notes TEXT NULL,
    interview_at DATETIME NULL,
    interview_type VARCHAR(20) NULL,
    interview_stage VARCHAR(100) NULL,
    interviewer_name VARCHAR(200) NULL,
    interview_notes TEXT NULL,
    follow_up_on DATE NULL,
    follow_up_notes VARCHAR(1000) NULL,
    job_description_id VARCHAR(36) NULL,
    resume_id VARCHAR(36) NULL,
    cover_letter_id VARCHAR(36) NULL,
    created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    updated_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (job_description_id) REFERENCES job_descriptions(id) ON DELETE SET NULL,
    FOREIGN KEY (resume_id) REFERENCES resumes(id) ON DELETE SET NULL,
    FOREIGN KEY (cover_letter_id) REFERENCES cover_letters(id) ON DELETE SET NULL,
    INDEX idx_applications_user_updated (user_id, updated_at),
    INDEX idx_applications_user_status (user_id, status),
    INDEX idx_applications_user_applied (user_id, applied_on),
    INDEX idx_applications_user_company (user_id, company_name),
    CONSTRAINT chk_application_status CHECK (status IN ('wishlist', 'preparing', 'applied', 'assessment', 'interview', 'offer', 'rejected', 'withdrawn')),
    CONSTRAINT chk_application_employment CHECK (employment_type IS NULL OR employment_type IN ('full_time', 'part_time', 'contract', 'internship', 'temporary', 'freelance', 'other')),
    CONSTRAINT chk_application_interview_type CHECK (interview_type IS NULL OR interview_type IN ('phone', 'video', 'in_person', 'other'))
);

CREATE TABLE IF NOT EXISTS job_application_events (
    id VARCHAR(36) PRIMARY KEY,
    -- Insertion order: events written in the same transaction share a timestamp.
    seq BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    application_id VARCHAR(36) NOT NULL,
    user_id VARCHAR(36) NOT NULL,
    event_type VARCHAR(30) NOT NULL,
    from_status VARCHAR(20) NULL,
    to_status VARCHAR(20) NULL,
    -- Small structured detail (interview time and type, follow-up date, names of edited fields).
    details JSON NULL,
    created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    FOREIGN KEY (application_id) REFERENCES job_applications(id) ON DELETE CASCADE,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    UNIQUE KEY uq_application_events_seq (seq),
    INDEX idx_application_events (application_id, seq),
    CONSTRAINT chk_application_event_type CHECK (event_type IN (
        'created', 'status_changed', 'interview_scheduled', 'interview_updated', 'interview_cleared',
        'follow_up_set', 'follow_up_cleared', 'details_updated'))
);
