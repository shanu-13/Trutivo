USE ai_resume_analyzer;

ALTER TABLE resumes 
ADD COLUMN text_content LONGTEXT NULL AFTER mime_type,
ADD COLUMN extraction_status VARCHAR(50) DEFAULT 'pending' AFTER text_content,
ADD COLUMN extraction_error TEXT NULL AFTER extraction_status;
