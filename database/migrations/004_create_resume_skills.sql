USE ai_resume_analyzer;

CREATE TABLE IF NOT EXISTS resume_skills (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    resume_id VARCHAR(36) NOT NULL,
    skill_name VARCHAR(100) NOT NULL,
    skill_category VARCHAR(50) NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (resume_id) REFERENCES resumes(id) ON DELETE CASCADE,
    -- resume_id is the leading column, so this also serves as the resume_id index.
    UNIQUE KEY uq_resume_skill (resume_id, skill_name)
);

-- Distinguishes "skills never extracted" from "extracted, but none found".
ALTER TABLE resumes
ADD COLUMN skills_extracted_at TIMESTAMP NULL AFTER extraction_error;
