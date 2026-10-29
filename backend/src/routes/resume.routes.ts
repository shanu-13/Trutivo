import { Router, Request, Response, NextFunction } from 'express';
import { upload, uploadVersion, listResumes, getResume, deleteResume, extractText, preprocessResume, extractSkills, getSkills, extractSections, analyzeResume, matchResumeToJob } from '../controllers/resume.controller';
import { requireAuth } from '../middleware/auth.middleware';
import { createTailoring, getTailoring, listTailoring, previewTailoring, reviewTailoringSuggestion, saveTailoring } from '../controllers/tailoring.controller';
import { getAtsCheck, runAtsCheck } from '../controllers/ats.controller';
import { downloadResumeFile, exportDocx, exportPdf, getExportDocument, saveExport } from '../controllers/resume-export.controller';
import { compareVersions, listVersions, makeCurrentVersion, requireOwnedResume } from '../controllers/resume-version.controller';
import { uploadResume } from '../middleware/upload.middleware';

const router = Router();

const uploadHandler = (req: Request, res: Response, next: NextFunction) => {
  const uploadSingle = uploadResume.single('resume');
  uploadSingle(req, res, (err: any) => {
    if (err) {
      if (err.message === 'INVALID_FILE_TYPE') {
        return res.status(400).json({
          success: false,
          message: "Only PDF files are allowed",
          error: { code: "INVALID_FILE_TYPE", details: null }
        });
      }
      if (err.code === 'LIMIT_FILE_SIZE') {
        return res.status(400).json({
          success: false,
          message: "File size exceeds 5MB limit",
          error: { code: "FILE_TOO_LARGE", details: null }
        });
      }
      return res.status(400).json({
        success: false,
        message: "File upload failed",
        error: { code: "UPLOAD_ERROR", details: err.message }
      });
    }
    next();
  });
};

router.use(requireAuth);

router.post('/', uploadHandler, upload);
router.get('/', listResumes);
router.get('/:id', getResume);
router.delete('/:id', deleteResume);
router.post('/:id/extract', extractText);
router.post('/:id/preprocess', preprocessResume);
router.post('/:id/extract-skills', extractSkills);
router.get('/:id/skills', getSkills);
router.post('/:id/extract-sections', extractSections);
router.post('/:id/analyze', analyzeResume);
router.post('/:resumeId/match/:jobDescriptionId', matchResumeToJob);
router.get('/:id/versions', listVersions);
router.post('/:id/versions', requireOwnedResume, uploadHandler, uploadVersion);
router.get('/:id/versions/:otherId/compare', compareVersions);
router.patch('/:id/current', makeCurrentVersion);
router.post('/:id/tailoring', createTailoring);
router.get('/:id/tailoring', listTailoring);
router.get('/:id/tailoring/:sessionId', getTailoring);
router.patch('/:id/tailoring/:sessionId/suggestions/:suggestionId', reviewTailoringSuggestion);
router.get('/:id/tailoring/:sessionId/preview', previewTailoring);
router.post('/:id/tailoring/:sessionId/save', saveTailoring);
router.get('/:id/export/document', getExportDocument);
router.post('/:id/export/pdf', exportPdf);
router.post('/:id/export/docx', exportDocx);
router.post('/:id/export/save', saveExport);
router.get('/:id/file', downloadResumeFile);
router.get('/:id/ats-check', getAtsCheck);
router.post('/:id/ats-check', runAtsCheck);

export default router;
