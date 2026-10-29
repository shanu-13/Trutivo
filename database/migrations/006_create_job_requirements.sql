USE ai_resume_analyzer;

-- Requirements extracted from a job description (Step 5B). One row per job
-- description: re-running extraction updates the row in place. The job title
-- is not stored here; it lives on job_descriptions.title.
CREATE TABLE IF NOT EXISTS job_requirements (
    id VARCHAR(36) PRIMARY KEY,
    job_description_id VARCHAR(36) NOT NULL,
    -- Optional job details, only set when the text states them explicitly.
    location VARCHAR(200) NULL,
    employment_type VARCHAR(50) NULL,
    work_mode VARCHAR(50) NULL,
    -- JSON arrays of canonical skill names (Step 4B dictionary).
    required_skills JSON NOT NULL,
    preferred_skills JSON NOT NULL,
    mentioned_skills JSON NOT NULL,
    -- JSON arrays of {minimumYears, maximumYears, areas, preferred, text}.
    experience_requirements JSON NOT NULL,
    -- JSON arrays of {degree, fields, preferred, text}.
    education_requirements JSON NOT NULL,
    -- JSON array of strings.
    responsibilities JSON NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (job_description_id) REFERENCES job_descriptions(id) ON DELETE CASCADE,
    -- Also serves as the job_description_id index.
    UNIQUE KEY uq_job_requirements_job_description (job_description_id)
);
