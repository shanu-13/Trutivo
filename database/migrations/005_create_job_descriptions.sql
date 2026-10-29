USE ai_resume_analyzer;

CREATE TABLE IF NOT EXISTS job_descriptions (
    id VARCHAR(36) PRIMARY KEY,
    user_id VARCHAR(36) NOT NULL,
    title VARCHAR(200) NOT NULL,
    company_name VARCHAR(200) NULL,
    -- The complete original text, as entered by the user.
    description_text LONGTEXT NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    -- user_id is the leading column, so this serves ownership lookups as well as
    -- listing a user's job descriptions newest first.
    INDEX idx_job_descriptions_user_created (user_id, created_at)
);
