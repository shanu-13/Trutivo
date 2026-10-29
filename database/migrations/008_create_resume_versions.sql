USE ai_resume_analyzer;

-- Resume versions (Step 9B).
--
-- Every upload stays its own `resumes` row (file, extracted text, skills and
-- saved matches are untouched). Uploads that are versions of the same resume
-- share a `resume_groups` row.
--
-- Rules enforced by the schema:
--   * a group belongs to one user, and a resume can only be in a group of the
--     same user (composite foreign key on (resume_group_id, user_id));
--   * version numbers are unique within a group;
--   * at most one version per group is current (unique index on a generated column).
-- The application decides which version is current: the newest version whose
-- text extraction completed.
--
-- Run once, after 001-007. Existing resumes each get their own group as
-- version 1; nothing is merged.

CREATE TABLE IF NOT EXISTS resume_groups (
    id VARCHAR(36) PRIMARY KEY,
    user_id VARCHAR(36) NOT NULL,
    -- Highest version number ever assigned, so numbers are never reused after a deletion.
    latest_version_number INT UNSIGNED NOT NULL DEFAULT 1,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    -- Target of the composite foreign key below; also the user_id index.
    UNIQUE KEY uq_resume_groups_user (user_id, id)
);

ALTER TABLE resumes
    ADD COLUMN resume_group_id VARCHAR(36) NULL AFTER user_id,
    ADD COLUMN version_number INT UNSIGNED NULL AFTER resume_group_id,
    ADD COLUMN version_label VARCHAR(100) NULL AFTER version_number,
    ADD COLUMN is_current TINYINT(1) NOT NULL DEFAULT 0 AFTER version_label;

-- Backfill: one group per existing resume, reusing the resume id as the group id
-- so the mapping is unambiguous. A resume with extracted text is current.
INSERT INTO resume_groups (id, user_id, created_at)
SELECT r.id, r.user_id, r.created_at
  FROM resumes r
 WHERE r.resume_group_id IS NULL;

UPDATE resumes
   SET resume_group_id = id,
       version_number = 1,
       is_current = IF(extraction_status = 'completed', 1, 0)
 WHERE resume_group_id IS NULL;

ALTER TABLE resumes
    MODIFY resume_group_id VARCHAR(36) NOT NULL,
    MODIFY version_number INT UNSIGNED NOT NULL,
    -- The group id when this row is current, else NULL (NULLs never collide).
    ADD COLUMN current_in_group VARCHAR(36) AS (IF(is_current = 1, resume_group_id, NULL)) VIRTUAL,
    ADD UNIQUE KEY uq_resumes_group_version (resume_group_id, version_number),
    ADD UNIQUE KEY uq_resumes_one_current (current_in_group),
    ADD CONSTRAINT fk_resumes_group_owner FOREIGN KEY (user_id, resume_group_id)
        REFERENCES resume_groups (user_id, id) ON DELETE CASCADE;
