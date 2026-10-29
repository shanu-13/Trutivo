import { Request, Response } from 'express';
import * as resumeService from '../services/resume.service';
import { extractTextFromPdf } from '../services/pdf-extraction.service';
import * as aiService from '../services/ai.service';
import * as jobDescriptionService from '../services/job-description.service';
import * as matchHistoryService from '../services/match-history.service';
import fs from 'fs';

// Applies the current-version policy once extraction has finished. A failure
// here is logged (without resume content) and never changes the extraction result.
const reconcileCurrentVersion = async (resumeId: string) => {
  try {
    await resumeService.reconcileCurrentVersion(resumeId);
  } catch (error: any) {
    console.error(`Failed to update the current resume version: ${error?.code ?? 'unknown error'}`);
  }
};

const runExtractionProcess = async (resumeId: string, filePath: string) => {
  try {
    await resumeService.updateExtractionStatus(resumeId, 'processing');
    const extractedText = await extractTextFromPdf(filePath);
    await resumeService.updateExtractionStatus(resumeId, 'completed', extractedText, null);
  } catch (error: any) {
    let errorMsg = 'Failed to extract text from PDF';
    let status = 'failed';
    
    if (error.message === 'NO_TEXT') {
      errorMsg = 'This PDF does not contain extractable text.';
      status = 'no_text';
    } else if (error.message === 'FILE_NOT_FOUND') {
      errorMsg = 'Resume file is missing from server.';
    }

    await resumeService.updateExtractionStatus(resumeId, status, null, errorMsg);
  }
  await reconcileCurrentVersion(resumeId);
};

// The fields a resume (version) exposes: no stored filename, path or text.
export const toResumeSummary = (r: any) => ({
  id: r.id,
  originalFilename: r.originalFilename,
  fileSize: r.fileSize,
  mimeType: r.mimeType,
  extractionStatus: r.extractionStatus,
  skillsExtractedAt: r.skillsExtractedAt,
  createdAt: r.createdAt,
  resumeGroupId: r.resumeGroupId,
  versionNumber: Number(r.versionNumber),
  versionLabel: r.versionLabel ?? null,
  isCurrent: Number(r.isCurrent) === 1,
  versionCount: Number(r.versionCount),
  sourceType: r.sourceType ?? 'upload',
  exportTemplate: r.exportTemplate ?? null,
});

export const MAX_VERSION_LABEL_LENGTH = 100;

// An optional short label for a new version ("Tailored for backend roles").
export const parseVersionLabel = (value: unknown): { label: string | null } | { error: string } => {
  if (value === undefined || value === null) return { label: null };
  if (typeof value !== 'string') return { error: 'Version label must be text' };
  const label = value.replace(/\s+/g, ' ').trim();
  if (!label) return { label: null };
  if (label.length > MAX_VERSION_LABEL_LENGTH) return { error: `Version label must be at most ${MAX_VERSION_LABEL_LENGTH} characters` };
  if (/[\u0000-\u001f\u007f]/.test(label)) return { error: 'Version label contains invalid characters' };
  return { label };
};

// PDF files start with "%PDF-" (allowing a few leading bytes, as PDF readers do).
export const hasPdfSignature = async (filePath: string) => {
  const handle = await fs.promises.open(filePath, 'r').catch(() => null);
  if (!handle) return false;
  try {
    const { buffer, bytesRead } = await handle.read(Buffer.alloc(1024), 0, 1024, 0);
    return buffer.subarray(0, bytesRead).includes('%PDF-');
  } finally {
    await handle.close();
  }
};

const removeUploadedFile = (filePath: string) => {
  fs.promises.unlink(filePath).catch(() => {});
};

// Shared by first uploads and new versions: the file has already passed the
// upload middleware's type and size checks and been stored under a generated name.
const saveUploadedResume = async (req: Request, res: Response, versionOf?: string) => {
  const userId = req.user?.id;
  if (!userId) {
    if (req.file) removeUploadedFile(req.file.path);
    return res.status(401).json({ success: false, message: "Unauthorized", error: { code: "UNAUTHORIZED", details: null } });
  }

  if (!req.file) {
    return res.status(400).json({ success: false, message: "No file uploaded", error: { code: "NO_FILE", details: null } });
  }

  const { originalname, filename, path, size, mimetype } = req.file;
  // The name and declared type were checked on upload; the content must really be a PDF.
  if (size === 0 || !(await hasPdfSignature(path))) {
    removeUploadedFile(path);
    return res.status(400).json({
      success: false,
      message: size === 0 ? "The file is empty" : "Only PDF files are allowed",
      error: { code: size === 0 ? "EMPTY_FILE" : "INVALID_FILE_TYPE", details: null }
    });
  }
  try {
    const label = parseVersionLabel(req.body?.versionLabel);
    if ('error' in label) {
      removeUploadedFile(path);
      return res.status(400).json({
        success: false,
        message: label.error,
        error: { code: "VALIDATION_ERROR", details: [{ field: "versionLabel", message: label.error }] }
      });
    }

    const created = await resumeService.createResume(userId, originalname, filename, path, size, mimetype, {
      versionOf,
      versionLabel: versionOf ? label.label : null,
    });
    if (!created) {
      removeUploadedFile(path);
      return res.status(404).json({ success: false, message: "Resume not found", error: { code: "NOT_FOUND", details: null } });
    }

    // Trigger asynchronous extraction
    runExtractionProcess(created.id, path).catch(console.error);

    res.status(201).json({
      success: true,
      message: versionOf ? "New resume version uploaded successfully" : "Resume uploaded successfully",
      data: {
        resume: {
          id: created.id,
          originalFilename: originalname,
          fileSize: size,
          mimeType: mimetype,
          extractionStatus: 'pending',
          skillsExtractedAt: null,
          createdAt: new Date().toISOString(),
          resumeGroupId: created.resumeGroupId,
          versionNumber: created.versionNumber,
          versionLabel: versionOf ? label.label : null,
          isCurrent: false,
          sourceType: 'upload',
          exportTemplate: null,
        }
      }
    });
  } catch (error) {
    // Nothing was saved, so the stored file would be an orphan.
    removeUploadedFile(path);
    res.status(500).json({ success: false, message: "Failed to upload resume", error: { code: "SERVER_ERROR", details: null } });
  }
};

export const upload = async (req: Request, res: Response) => saveUploadedResume(req, res);

// POST /api/resumes/:id/versions: the upload becomes the next version of :id's group.
export const uploadVersion = async (req: Request, res: Response) => saveUploadedResume(req, res, req.params.id);

export const extractText = async (req: Request, res: Response) => {
  try {
    const userId = req.user?.id;
    const resumeId = req.params.id;

    if (!userId) {
      return res.status(401).json({ success: false, message: "Unauthorized", error: { code: "UNAUTHORIZED", details: null } });
    }

    const resume = await resumeService.getResumeById(resumeId, userId);
    if (!resume) {
      return res.status(404).json({ success: false, message: "Resume not found", error: { code: "NOT_FOUND", details: null } });
    }
    // Tailored and exported versions were saved with their approved text; re-extracting
    // it from their file could change it, so extraction is for uploads only.
    if (resume.sourceType !== 'upload') {
      return res.status(409).json({
        success: false,
        message: "Text extraction is only available for uploaded files",
        error: { code: "EXTRACTION_NOT_SUPPORTED", details: null }
      });
    }

    await resumeService.updateExtractionStatus(resumeId, 'processing');
    
    try {
      const extractedText = await extractTextFromPdf(resume.filePath);
      await resumeService.updateExtractionStatus(resumeId, 'completed', extractedText, null);
      await reconcileCurrentVersion(resumeId);
      
      res.json({
        success: true,
        message: "Resume text extracted successfully",
        data: {
          resume: {
            id: resumeId,
            extractionStatus: "completed"
          }
        }
      });
    } catch (error: any) {
      let errorMsg = 'Failed to extract text from PDF';
      let status = 'failed';
      
      if (error.message === 'NO_TEXT') {
        errorMsg = 'This PDF does not contain extractable text.';
        status = 'no_text';
      } else if (error.message === 'FILE_NOT_FOUND') {
        errorMsg = 'Resume file is missing from server.';
      }
  
      await resumeService.updateExtractionStatus(resumeId, status, null, errorMsg);
      await reconcileCurrentVersion(resumeId);

      return res.status(400).json({
        success: false,
        message: "Unable to extract text from resume",
        error: { code: "PDF_EXTRACTION_FAILED", details: null }
      });
    }

  } catch (error) {
    res.status(500).json({ success: false, message: "Failed to trigger extraction", error: { code: "SERVER_ERROR", details: null } });
  }
};

export const preprocessResume = async (req: Request, res: Response) => {
  try {
    const userId = req.user?.id;
    const resumeId = req.params.id;

    if (!userId) {
      return res.status(401).json({ success: false, message: "Unauthorized", error: { code: "UNAUTHORIZED", details: null } });
    }

    // Ownership is enforced by the query: only the user's own resume text is ever sent.
    const resume = await resumeService.getResumeTextById(resumeId, userId);
    if (!resume) {
      return res.status(404).json({ success: false, message: "Resume not found", error: { code: "NOT_FOUND", details: null } });
    }

    if (resume.extractionStatus !== 'completed' || !resume.textContent) {
      return res.status(409).json({
        success: false,
        message: "Resume text has not been extracted yet",
        error: { code: "TEXT_NOT_EXTRACTED", details: null }
      });
    }

    const result = await aiService.preprocessResumeText(resume.id, resume.textContent);

    res.json({
      success: true,
      message: "Resume text preprocessed successfully",
      data: {
        resume: {
          id: resume.id,
          preprocessedText: result.text,
          originalLength: resume.textContent.length,
          preprocessedLength: result.text.length
        }
      }
    });
  } catch (error) {
    if (error instanceof aiService.AiServiceError) {
      return res.status(error.statusCode).json({
        success: false,
        message: error.message,
        error: { code: error.code, details: null }
      });
    }
    res.status(500).json({ success: false, message: "Failed to preprocess resume", error: { code: "SERVER_ERROR", details: null } });
  }
};

const countSkills = (skills: aiService.SkillsByCategory) =>
  Object.values(skills).reduce((sum, names) => sum + names.length, 0);

export const extractSkills = async (req: Request, res: Response) => {
  try {
    const userId = req.user?.id;
    const resumeId = req.params.id;

    if (!userId) {
      return res.status(401).json({ success: false, message: "Unauthorized", error: { code: "UNAUTHORIZED", details: null } });
    }

    // Ownership is enforced by the query, and the text always comes from the database,
    // never from the request, so only the user's own resume is analysed.
    const resume = await resumeService.getResumeTextById(resumeId, userId);
    if (!resume) {
      return res.status(404).json({ success: false, message: "Resume not found", error: { code: "NOT_FOUND", details: null } });
    }

    if (resume.extractionStatus !== 'completed' || !resume.textContent) {
      return res.status(409).json({
        success: false,
        message: "Resume text is not available",
        error: { code: "RESUME_TEXT_NOT_AVAILABLE", details: null }
      });
    }

    const result = await aiService.extractResumeSkills(resume.id, resume.textContent);

    const stored = await resumeService.replaceResumeSkills(resume.id, userId, result.skills);
    if (!stored) {
      // The resume was deleted while extraction was running.
      return res.status(404).json({ success: false, message: "Resume not found", error: { code: "NOT_FOUND", details: null } });
    }

    res.json({
      success: true,
      message: "Resume skills extracted successfully",
      data: {
        resumeId: resume.id,
        skills: result.skills,
        totalSkills: result.totalSkills
      }
    });
  } catch (error) {
    if (error instanceof aiService.AiServiceError) {
      return res.status(error.statusCode).json({
        success: false,
        message: error.message,
        error: { code: error.code, details: null }
      });
    }
    res.status(500).json({ success: false, message: "Failed to extract resume skills", error: { code: "SERVER_ERROR", details: null } });
  }
};

export const getSkills = async (req: Request, res: Response) => {
  try {
    const userId = req.user?.id;
    const resumeId = req.params.id;

    if (!userId) {
      return res.status(401).json({ success: false, message: "Unauthorized", error: { code: "UNAUTHORIZED", details: null } });
    }

    const resume = await resumeService.getResumeById(resumeId, userId);
    if (!resume) {
      return res.status(404).json({ success: false, message: "Resume not found", error: { code: "NOT_FOUND", details: null } });
    }

    const skills = await resumeService.getResumeSkills(resume.id, userId);

    res.json({
      success: true,
      message: "Resume skills retrieved successfully",
      data: {
        resumeId: resume.id,
        skills,
        totalSkills: countSkills(skills),
        skillsExtractedAt: resume.skillsExtractedAt
      }
    });
  } catch (error) {
    res.status(500).json({ success: false, message: "Failed to retrieve resume skills", error: { code: "SERVER_ERROR", details: null } });
  }
};

export const extractSections = async (req: Request, res: Response) => {
  try {
    const userId = req.user?.id;
    const resumeId = req.params.id;

    if (!userId) {
      return res.status(401).json({ success: false, message: "Unauthorized", error: { code: "UNAUTHORIZED", details: null } });
    }

    // Ownership is enforced by the query, and the text always comes from the database,
    // never from the request, so only the user's own resume is analysed.
    const resume = await resumeService.getResumeTextById(resumeId, userId);
    if (!resume) {
      return res.status(404).json({ success: false, message: "Resume not found", error: { code: "NOT_FOUND", details: null } });
    }

    if (resume.extractionStatus !== 'completed' || !resume.textContent) {
      return res.status(409).json({
        success: false,
        message: "Resume text is not available",
        error: { code: "RESUME_TEXT_NOT_AVAILABLE", details: null }
      });
    }

    const result = await aiService.extractResumeSections(resume.id, resume.textContent);

    res.json({
      success: true,
      message: "Resume sections extracted successfully",
      data: {
        resumeId: resume.id,
        sections: result.sections
      }
    });
  } catch (error) {
    if (error instanceof aiService.AiServiceError) {
      return res.status(error.statusCode).json({
        success: false,
        message: error.message,
        error: { code: error.code, details: null }
      });
    }
    res.status(500).json({ success: false, message: "Failed to extract resume sections", error: { code: "SERVER_ERROR", details: null } });
  }
};

export const analyzeResume = async (req: Request, res: Response) => {
  try {
    const userId = req.user?.id;
    const resumeId = req.params.id;

    if (!userId) {
      return res.status(401).json({ success: false, message: "Unauthorized", error: { code: "UNAUTHORIZED", details: null } });
    }

    // Ownership is enforced by the query, and the text always comes from the database,
    // never from the request, so only the user's own resume is analysed.
    const resume = await resumeService.getResumeTextById(resumeId, userId);
    if (!resume) {
      return res.status(404).json({ success: false, message: "Resume not found", error: { code: "NOT_FOUND", details: null } });
    }

    if (resume.extractionStatus !== 'completed' || !resume.textContent) {
      return res.status(409).json({
        success: false,
        message: "Resume text is not available",
        error: { code: "RESUME_TEXT_NOT_AVAILABLE", details: null }
      });
    }

    const result = await aiService.analyzeResume(resume.id, resume.textContent);

    res.json({
      success: true,
      message: "Resume analyzed successfully",
      data: {
        resumeId: resume.id,
        resume: result.resume,
        metadata: result.metadata
      }
    });
  } catch (error) {
    if (error instanceof aiService.AiServiceError) {
      return res.status(error.statusCode).json({
        success: false,
        message: error.message,
        error: { code: error.code, details: null }
      });
    }
    res.status(500).json({ success: false, message: "Failed to analyze resume", error: { code: "SERVER_ERROR", details: null } });
  }
};

export const matchResumeToJob = async (req: Request, res: Response) => {
  try {
    const userId = req.user?.id;
    const { resumeId, jobDescriptionId } = req.params;

    if (!userId) {
      return res.status(401).json({ success: false, message: "Unauthorized", error: { code: "UNAUTHORIZED", details: null } });
    }

    // Both lookups are scoped to the signed-in user, so one user's resume can never be
    // paired with another user's job. The same response is used whichever is missing,
    // so it does not reveal whether another user's record exists.
    const [resume, jobDescription] = await Promise.all([
      resumeService.getResumeTextById(resumeId, userId),
      jobDescriptionService.getJobDescriptionById(jobDescriptionId, userId),
    ]);
    if (!resume || !jobDescription) {
      return res.status(404).json({ success: false, message: "Resource not found", error: { code: "RESOURCE_NOT_FOUND", details: null } });
    }

    if (resume.extractionStatus !== 'completed' || !resume.textContent) {
      return res.status(409).json({
        success: false,
        message: "Resume text is not available",
        error: { code: "RESUME_TEXT_NOT_AVAILABLE", details: null }
      });
    }

    const requirements = await jobDescriptionService.getJobRequirements(jobDescription.id, userId);
    if (!requirements) {
      return res.status(409).json({
        success: false,
        message: "Job requirements have not been extracted yet. Extract them from the job description first.",
        error: { code: "JOB_REQUIREMENTS_NOT_AVAILABLE", details: null }
      });
    }

    // The structured resume comes from the stored resume text (Step 4D analysis).
    const analysis = await aiService.analyzeResume(resume.id, resume.textContent);
    const structured = analysis.resume;

    // Deterministic matching (Steps 6A/6B) and semantic similarity (Step 6C) run in
    // parallel. Semantic similarity is supplementary: if it fails, the deterministic
    // result is still returned and the failure is reported alongside it.
    const [matchingOutcome, semanticOutcome] = await Promise.allSettled([
      aiService.analyzeResumeJobMatch(
        resume.id,
        jobDescription.id,
        aiService.toMatchResumeInput(structured),
        aiService.toMatchJobRequirementsInput(requirements)
      ),
      aiService.analyzeSemanticMatch(
        resume.id,
        jobDescription.id,
        {
          // Professional content only: personal information is never sent for embedding.
          summary: structured.summary,
          experience: structured.experience.map((job) => ({
            title: job.title,
            company: job.company,
            description: job.description,
            rawText: job.title || job.company || job.description.length > 0 ? '' : job.rawText,
          })),
          projects: structured.projects.map((project) => ({
            name: project.name,
            description: project.description,
            technologies: project.technologies,
          })),
          skills: structured.skills,
          education: structured.education.map((entry) => ({
            degree: entry.degree,
            field: entry.field,
            institution: entry.institution,
          })),
        },
        {
          title: jobDescription.title,
          description: jobDescription.descriptionText,
          responsibilities: requirements.responsibilities,
          requiredSkills: requirements.requiredSkills,
          preferredSkills: requirements.preferredSkills,
          experienceRequirements: requirements.experienceRequirements.map((r: { text: string }) => ({ text: r.text })),
          educationRequirements: requirements.educationRequirements.map((r: { text: string }) => ({ text: r.text })),
        }
      ),
    ]);

    if (matchingOutcome.status === 'rejected') throw matchingOutcome.reason;

    let semanticMatch: aiService.SemanticMatch | null = null;
    let semanticError: { code: string; message: string } | null = null;
    if (semanticOutcome.status === 'fulfilled') {
      semanticMatch = semanticOutcome.value;
    } else {
      const reason = semanticOutcome.reason;
      semanticError =
        reason instanceof aiService.AiServiceError
          ? { code: reason.code, message: reason.message }
          : { code: 'SEMANTIC_MATCHING_FAILED', message: 'Semantic matching failed' };
      if (reason instanceof aiService.AiServiceError && reason.code === 'EMBEDDING_MODEL_UNAVAILABLE') {
        semanticError.message = 'Semantic matching service is currently unavailable.';
      }
    }

    // Step 7A explains the results above; it never recomputes them. Like semantic
    // matching it is supplementary, so a failure here does not fail the match.
    let matchAnalysis: aiService.MatchAnalysis | null = null;
    let analysisError: { code: string; message: string } | null = null;
    try {
      matchAnalysis = await aiService.analyzeMatchResults(matchingOutcome.value, semanticMatch, semanticError);
    } catch (error) {
      analysisError =
        error instanceof aiService.AiServiceError
          ? { code: error.code, message: error.message }
          : { code: 'MATCH_ANALYSIS_FAILED', message: 'Match analysis failed' };
    }

    // Step 7B builds on the Step 7A analysis; without it there is nothing to recommend from.
    let recommendations: aiService.ResumeRecommendations | null = null;
    let recommendationsError: { code: string; message: string } | null = null;
    if (!matchAnalysis) {
      recommendationsError = {
        code: 'RECOMMENDATIONS_UNAVAILABLE',
        message: 'Recommendations could not be generated because the match analysis was not available.',
      };
    } else {
      try {
        recommendations = await aiService.generateRecommendations(matchingOutcome.value, matchAnalysis, {
          experience: structured.experience.map((job) => ({
            title: job.title,
            company: job.company,
            startDate: job.startDate,
            endDate: job.endDate,
            isCurrent: job.isCurrent,
            description: job.description,
          })),
          projects: structured.projects.map((project) => ({
            name: project.name,
            description: project.description,
            technologies: project.technologies,
          })),
        });
      } catch (error) {
        recommendationsError =
          error instanceof aiService.AiServiceError
            ? { code: error.code, message: error.message }
            : { code: 'RECOMMENDATIONS_FAILED', message: 'Recommendation generation failed' };
      }
    }

    // Step 8A: save the completed result to match history. A result counts as complete
    // when matching, analysis and recommendations all succeeded; semantic similarity
    // is optional and saved as unavailable when it was. An incomplete result is still
    // returned, but not saved. A failed save fails the request: it is never reported
    // as saved when it was not.
    let matchId: string | null = null;
    let historyError: { code: string; message: string } | null = null;
    if (matchAnalysis && recommendations) {
      let saved: string | null;
      try {
        const snapshot = matchHistoryService.buildMatchSnapshot({
          matching: matchingOutcome.value,
          semanticMatch,
          semanticError,
          analysis: matchAnalysis,
          recommendations,
        });
        saved = await matchHistoryService.saveMatchHistory(userId, resume.id, jobDescription.id, snapshot);
      } catch (error) {
        // Never log the snapshot: it is derived from resume content.
        console.error(`Saving match history failed: ${error instanceof Error ? error.name : 'unknown error'}`);
        return res.status(500).json({
          success: false,
          message: "The match result could not be saved to history",
          error: { code: "MATCH_HISTORY_SAVE_FAILED", details: null }
        });
      }
      if (!saved) {
        // The resume or job description was deleted while the match was running.
        return res.status(404).json({ success: false, message: "Resource not found", error: { code: "RESOURCE_NOT_FOUND", details: null } });
      }
      matchId = saved;
    } else {
      historyError = {
        code: 'MATCH_HISTORY_NOT_SAVED',
        message: 'This result was not saved to match history because the analysis was incomplete.',
      };
    }

    res.json({
      success: true,
      message: "Resume and job requirements analyzed successfully",
      data: {
        matchId,
        historyError,
        matching: matchingOutcome.value,
        semanticMatch,
        semanticError,
        analysis: matchAnalysis,
        analysisError,
        recommendations,
        recommendationsError
      }
    });
  } catch (error) {
    if (error instanceof aiService.AiServiceError) {
      return res.status(error.statusCode).json({
        success: false,
        message: error.message,
        error: { code: error.code, details: null }
      });
    }
    res.status(500).json({ success: false, message: "Failed to match resume with job", error: { code: "SERVER_ERROR", details: null } });
  }
};

export const listResumes = async (req: Request, res: Response) => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({ success: false, message: "Unauthorized", error: { code: "UNAUTHORIZED", details: null } });
    }

    const resumes = await resumeService.getUserResumes(userId);

    const safeResumes = resumes.map(toResumeSummary);

    res.json({
      success: true,
      message: "Resumes retrieved successfully",
      data: { resumes: safeResumes }
    });
  } catch (error) {
    res.status(500).json({ success: false, message: "Failed to retrieve resumes", error: { code: "SERVER_ERROR", details: null } });
  }
};

export const getResume = async (req: Request, res: Response) => {
  try {
    const userId = req.user?.id;
    const resumeId = req.params.id;

    if (!userId) {
      return res.status(401).json({ success: false, message: "Unauthorized", error: { code: "UNAUTHORIZED", details: null } });
    }

    const resume = await resumeService.getResumeById(resumeId, userId);
    if (!resume) {
      return res.status(404).json({ success: false, message: "Resume not found", error: { code: "NOT_FOUND", details: null } });
    }

    res.json({
      success: true,
      message: "Resume retrieved successfully",
      data: {
        resume: toResumeSummary(resume)
      }
    });
  } catch (error) {
    res.status(500).json({ success: false, message: "Failed to retrieve resume", error: { code: "SERVER_ERROR", details: null } });
  }
};

export const deleteResume = async (req: Request, res: Response) => {
  try {
    const userId = req.user?.id;
    const resumeId = req.params.id;

    if (!userId) {
      return res.status(401).json({ success: false, message: "Unauthorized", error: { code: "UNAUTHORIZED", details: null } });
    }

    // Only this version is deleted; the file is removed after the database change is committed.
    const deleted = await resumeService.deleteResume(resumeId, userId);
    if (!deleted) {
      return res.status(404).json({ success: false, message: "Resume not found", error: { code: "NOT_FOUND", details: null } });
    }
    removeUploadedFile(deleted.filePath);

    res.json({
      success: true,
      message: "Resume deleted successfully",
      data: null
    });
  } catch (error) {
    res.status(500).json({ success: false, message: "Failed to delete resume", error: { code: "SERVER_ERROR", details: null } });
  }
};
