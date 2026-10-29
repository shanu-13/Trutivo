USE ai_resume_analyzer;

-- Reminders (Step 14).
--
-- One row per reminder, owned by one user, optionally linked to one of that
-- user's job applications.
--   * due_at is the moment the reminder is due, in UTC (DATETIME without time zone).
--   * time_zone is the IANA time zone the user chose (e.g. "Europe/London"). The
--     server converts the user's local date and time to due_at with it, and the
--     local time is shown back in that zone; it is never changed silently.
--   * status is pending, completed or dismissed. "Overdue" is not stored: it is a
--     pending reminder whose due_at has passed, worked out when read.
--   * source / source_key identify reminders created from an application's
--     interview or follow-up date. The unique key on (application_id, source_key)
--     means the same suggestion can only be saved once, however often it is accepted.
--   * application_removed is set when the linked application is deleted. The
--     reminder is kept (application_id becomes NULL) so nothing disappears
--     silently; the user can dismiss or delete it.
-- Delivery is in-app only: there is no e-mail or push delivery, so no delivery
-- status is stored.
--
-- Run once, after 001-013.

CREATE TABLE IF NOT EXISTS reminders (
    id VARCHAR(36) PRIMARY KEY,
    user_id VARCHAR(36) NOT NULL,
    application_id VARCHAR(36) NULL,
    reminder_type VARCHAR(20) NOT NULL,
    title VARCHAR(200) NOT NULL,
    notes TEXT NULL,
    due_at DATETIME NOT NULL,
    time_zone VARCHAR(64) NOT NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'pending',
    completed_at TIMESTAMP(3) NULL,
    dismissed_at TIMESTAMP(3) NULL,
    source VARCHAR(30) NOT NULL DEFAULT 'manual',
    -- e.g. "interview:2026-11-02T09:30:00Z" or "follow_up:2026-11-05"; NULL for manual reminders.
    source_key VARCHAR(100) NULL,
    application_removed TINYINT(1) NOT NULL DEFAULT 0,
    created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    updated_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (application_id) REFERENCES job_applications(id) ON DELETE SET NULL,
    UNIQUE KEY uq_reminders_source (application_id, source_key),
    INDEX idx_reminders_user_status_due (user_id, status, due_at),
    INDEX idx_reminders_user_due (user_id, due_at),
    CONSTRAINT chk_reminder_type CHECK (reminder_type IN ('follow_up', 'interview', 'assessment', 'recruiter_contact', 'custom')),
    CONSTRAINT chk_reminder_status CHECK (status IN ('pending', 'completed', 'dismissed')),
    CONSTRAINT chk_reminder_source CHECK (source IN ('manual', 'application_interview', 'application_follow_up')),
    -- Completion and dismissal times match the status.
    CONSTRAINT chk_reminder_completed CHECK ((status = 'completed') = (completed_at IS NOT NULL)),
    CONSTRAINT chk_reminder_dismissed CHECK ((status = 'dismissed') = (dismissed_at IS NOT NULL))
);
