import fs from 'fs';
import { Request, Response } from 'express';
import { z } from 'zod';
import * as resumeService from '../services/resume.service';
import { buildResumeDocument, validateDocumentText } from '../services/resume-document.service';
import { TEMPLATE_IDS, TEMPLATE_INFO, renderResumePdf, unsupportedCharacters, type TemplateId } from '../services/resume-pdf.service';
import { renderResumeDocx } from '../services/resume-docx.service';
import {
  exportFilename,
  getApprovedContent,
  saveExportedVersion,
  storedFilePath,
  type ApprovedContent,
} from '../services/resume-export.service';
import { isValidResumeId } from './resume-version.controller';
import { toResumeSummary } from './resume.controller';

// Professional PDF export (Step 9D) and editable DOCX export (Step 10). Documents
// are always built on the server from stored, approved content; the request only
// chooses a template and, optionally, a tailoring session of the resume.

const unauthorized = (res: Response) =>
  res.status(401).json({ success: false, message: 'Unauthorized', error: { code: 'UNAUTHORIZED', details: null } });
const invalidId = (res: Response) =>
  res.status(400).json({ success: false, message: 'Invalid id', error: { code: 'INVALID_ID', details: null } });
const notFound = (res: Response) =>
  res.status(404).json({ success: false, message: 'Resume not found', error: { code: 'NOT_FOUND', details: null } });
const serverError = (res: Response, message: string) =>
  res.status(500).json({ success: false, message, error: { code: 'SERVER_ERROR', details: null } });

const exportSchema = z
  .object({ template: z.enum(TEMPLATE_IDS), tailoringSessionId: z.string().optional() })
  .strict();

type Loaded = { content: ApprovedContent } | { status: number; code: string; message: string };

const loadContent = async (resumeId: string, userId: string, sessionId: string | null): Promise<Loaded> => {
  const content = await getApprovedContent(resumeId, userId, sessionId);
  if (content === 'not_found') return { status: 404, code: 'NOT_FOUND', message: 'Resume or tailoring session not found' };
  if (content === 'not_ready') {
    return { status: 409, code: 'RESUME_TEXT_NOT_AVAILABLE', message: 'Resume text is not available. Only processed resumes can be exported.' };
  }
  const problem = validateDocumentText(content.text);
  if (problem === 'TOO_LARGE') return { status: 413, code: 'RESUME_TOO_LARGE', message: 'This resume is too long to export' };
  if (problem === 'EMPTY') return { status: 409, code: 'RESUME_EMPTY', message: 'There is no content to export' };
  return { content };
};

const sendProblem = (res: Response, loaded: Exclude<Loaded, { content: ApprovedContent }>) =>
  res.status(loaded.status).json({ success: false, message: loaded.message, error: { code: loaded.code, details: null } });

// Parses { template, tailoringSessionId? }; sends a 400 and returns null when invalid.
const parseExportRequest = (req: Request, res: Response) => {
  const body = exportSchema.safeParse(req.body ?? {});
  if (!body.success) {
    res.status(400).json({
      success: false,
      message: `template must be one of: ${TEMPLATE_IDS.join(', ')}`,
      error: { code: 'VALIDATION_ERROR', details: [{ field: 'template', message: 'Unknown template or unexpected field' }] },
    });
    return null;
  }
  const sessionId = body.data.tailoringSessionId ?? null;
  if (sessionId !== null && !isValidResumeId(sessionId)) {
    invalidId(res);
    return null;
  }
  return { template: body.data.template as TemplateId, sessionId };
};

// GET /api/resumes/:id/export/document[?tailoringSessionId=]
// The structured document every template draws, for the on-screen preview.
export const getExportDocument = async (req: Request, res: Response) => {
  try {
    const userId = req.user?.id;
    if (!userId) return unauthorized(res);
    if (!isValidResumeId(req.params.id)) return invalidId(res);
    const sessionParam = req.query.tailoringSessionId;
    if (sessionParam !== undefined && !isValidResumeId(sessionParam)) return invalidId(res);

    const loaded = await loadContent(req.params.id, userId, (sessionParam as string | undefined) ?? null);
    if (!('content' in loaded)) return sendProblem(res, loaded);
    const { content } = loaded;
    res.json({
      success: true,
      message: 'Export document built successfully',
      data: {
        document: buildResumeDocument(content.text),
        resume: content.resume,
        session: content.session,
        staleSuggestionCount: content.staleSuggestionCount,
        templates: TEMPLATE_INFO,
        unsupportedCharacters: unsupportedCharacters(content.text),
      },
    });
  } catch (error) {
    serverError(res, 'Failed to build the export preview');
  }
};

const generate = async (content: ApprovedContent, template: TemplateId) => {
  const filename = exportFilename(content.resume.originalFilename, template);
  const pdf = await renderResumePdf(buildResumeDocument(content.text), template, filename.replace(/\.pdf$/, ''));
  return { pdf, filename };
};

export const DOCX_CONTENT_TYPE = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

const sendDocument = (res: Response, file: Buffer, filename: string, contentType: string) => {
  res.setHeader('Content-Type', contentType);
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.setHeader('Content-Length', String(file.length));
  res.setHeader('Cache-Control', 'private, no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.end(file);
};

// POST /api/resumes/:id/export/pdf  { template, tailoringSessionId? }
// Generates the PDF and sends it as a download; nothing is stored.
export const exportPdf = async (req: Request, res: Response) => {
  try {
    const userId = req.user?.id;
    if (!userId) return unauthorized(res);
    if (!isValidResumeId(req.params.id)) return invalidId(res);
    const request = parseExportRequest(req, res);
    if (!request) return;
    const loaded = await loadContent(req.params.id, userId, request.sessionId);
    if (!('content' in loaded)) return sendProblem(res, loaded);
    const { pdf, filename } = await generate(loaded.content, request.template);
    sendDocument(res, pdf, filename, 'application/pdf');
  } catch (error) {
    serverError(res, 'Failed to generate the PDF');
  }
};

// POST /api/resumes/:id/export/docx  { template, tailoringSessionId? }
// Generates an editable Word document from the same approved content and sends
// it as a download; nothing is stored.
export const exportDocx = async (req: Request, res: Response) => {
  try {
    const userId = req.user?.id;
    if (!userId) return unauthorized(res);
    if (!isValidResumeId(req.params.id)) return invalidId(res);
    const request = parseExportRequest(req, res);
    if (!request) return;
    const loaded = await loadContent(req.params.id, userId, request.sessionId);
    if (!('content' in loaded)) return sendProblem(res, loaded);
    const filename = exportFilename(loaded.content.resume.originalFilename, request.template, 'docx');
    const docx = await renderResumeDocx(buildResumeDocument(loaded.content.text), request.template, filename.replace(/\.docx$/, ''));
    sendDocument(res, docx, filename, DOCX_CONTENT_TYPE);
  } catch (error) {
    serverError(res, 'Failed to generate the Word document');
  }
};

// POST /api/resumes/:id/export/save  { template, tailoringSessionId? }
// Generates the PDF and keeps it as a new, non-current version.
export const saveExport = async (req: Request, res: Response) => {
  try {
    const userId = req.user?.id;
    if (!userId) return unauthorized(res);
    if (!isValidResumeId(req.params.id)) return invalidId(res);
    const request = parseExportRequest(req, res);
    if (!request) return;
    const loaded = await loadContent(req.params.id, userId, request.sessionId);
    if (!('content' in loaded)) return sendProblem(res, loaded);
    const { pdf, filename } = await generate(loaded.content, request.template);
    const saved = await saveExportedVersion(userId, loaded.content, request.template, pdf, filename);
    if (saved === 'not_found') return notFound(res);
    const resume = await resumeService.getResumeById(saved.resumeId, userId);
    res.status(saved.created ? 201 : 200).json({
      success: true,
      message: saved.created ? 'PDF saved as a new resume version' : 'This PDF was already saved as a version',
      data: { resume: resume ? toResumeSummary(resume) : null, created: saved.created },
    });
  } catch (error) {
    serverError(res, 'Failed to save the PDF');
  }
};

const DOWNLOAD_TYPES: Record<string, string> = { 'application/pdf': 'application/pdf', 'text/plain': 'text/plain; charset=utf-8' };

// GET /api/resumes/:id/file: the stored file of one of the user's versions
// (uploaded PDF, tailored text or exported PDF).
export const downloadResumeFile = async (req: Request, res: Response) => {
  try {
    const userId = req.user?.id;
    if (!userId) return unauthorized(res);
    if (!isValidResumeId(req.params.id)) return invalidId(res);
    const resume = await resumeService.getResumeById(req.params.id, userId);
    if (!resume) return notFound(res);
    const filePath = storedFilePath(resume.filePath);
    const stat = filePath ? await fs.promises.stat(filePath).catch(() => null) : null;
    if (!filePath || !stat?.isFile()) {
      return res.status(404).json({ success: false, message: 'File not found', error: { code: 'FILE_NOT_FOUND', details: null } });
    }
    const extension = resume.mimeType === 'text/plain' ? '.txt' : '.pdf';
    const name = exportFilename(resume.originalFilename, 'classic').replace(/-classic\.pdf$/, extension);
    res.setHeader('Content-Type', DOWNLOAD_TYPES[resume.mimeType] ?? 'application/octet-stream');
    res.setHeader('Content-Disposition', `attachment; filename="${name}"`);
    res.setHeader('Content-Length', String(stat.size));
    res.setHeader('Cache-Control', 'private, no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    fs.createReadStream(filePath)
      .on('error', () => res.destroy())
      .pipe(res);
  } catch (error) {
    serverError(res, 'Failed to download the file');
  }
};
