USE ai_resume_analyzer;

-- Professional PDF export (Step 9D).
--
-- PDFs are generated on demand for download and are not stored. When the user
-- explicitly chooses "Save as Version", the generated PDF becomes a new resume
-- version with source_type 'exported': the PDF file, its approved text as the
-- extracted text, the template, and where it came from. Exported versions are
-- never made current automatically (same rule as tailored copies).
--
-- export_fingerprint (SHA-256 of template + approved text) is unique within a
-- group, so saving the same content with the same template twice returns the
-- existing version instead of creating a duplicate.
--
-- Run once, after 001-009.

ALTER TABLE resumes
    DROP CHECK chk_resumes_source_type,
    ADD CONSTRAINT chk_resumes_source_type CHECK (source_type IN ('upload', 'tailored', 'exported')),
    ADD COLUMN export_template VARCHAR(20) NULL AFTER source_type,
    ADD COLUMN export_fingerprint CHAR(64) NULL AFTER export_template,
    -- The version and tailoring session the export was built from (kept if those are deleted).
    ADD COLUMN exported_from_resume_id VARCHAR(36) NULL AFTER export_fingerprint,
    ADD COLUMN exported_from_session_id VARCHAR(36) NULL AFTER exported_from_resume_id,
    ADD UNIQUE KEY uq_resumes_group_export (resume_group_id, export_fingerprint),
    ADD CONSTRAINT fk_resumes_exported_from_resume FOREIGN KEY (exported_from_resume_id)
        REFERENCES resumes (id) ON DELETE SET NULL,
    ADD CONSTRAINT fk_resumes_exported_from_session FOREIGN KEY (exported_from_session_id)
        REFERENCES resume_tailoring_sessions (id) ON DELETE SET NULL;
