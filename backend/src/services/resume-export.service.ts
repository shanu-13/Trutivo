import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';
import pool from '../config/database';
import { UPLOAD_DIR } from '../middleware/upload.middleware';
import { beginVersionTransaction, getResumeById, getResumeTextById, lockGroupOf, reserveNextVersion } from './resume.service';
import { getSession } from './tailoring-session.service';
import { assemblePreview } from './resume-tailoring.service';
import type { TemplateId } from './resume-pdf.service';

// Approved content and saved exports for PDF export (Step 9D).

export interface ApprovedContent {
  text: string;
  resume: { id: string; originalFilename: string; versionNumber: number; versionLabel: string | null; sourceType: string };
  session: { id: string; jobTitle: string; companyName: string | null; status: string } | null;
  // Accepted suggestions that no longer match the resume text and were not applied.
  staleSuggestionCount: number;
}

// The text a user has approved, assembled on the server from stored data only:
// a version's stored text, or (with a tailoring session of that version) the
// stored text with only the accepted and edited suggestions applied. Pending
// and rejected suggestions are never included.
export const getApprovedContent = async (
  resumeId: string,
  userId: string,
  sessionId: string | null
): Promise<ApprovedContent | 'not_found' | 'not_ready'> => {
  const [resume, stored] = await Promise.all([getResumeById(resumeId, userId), getResumeTextById(resumeId, userId)]);
  if (!resume || !stored) return 'not_found';
  if (stored.extractionStatus !== 'completed' || !stored.textContent) return 'not_ready';
  const summary = {
    id: resume.id,
    originalFilename: resume.originalFilename,
    versionNumber: Number(resume.versionNumber),
    versionLabel: resume.versionLabel ?? null,
    sourceType: resume.sourceType,
  };
  if (!sessionId) return { text: stored.textContent, resume: summary, session: null, staleSuggestionCount: 0 };

  // The session must belong to this user and to this resume version.
  const session = await getSession(sessionId, resumeId, userId);
  if (!session) return 'not_found';
  const preview = assemblePreview(stored.textContent.split('\n'), session.suggestions);
  return {
    text: preview.text,
    resume: summary,
    session: { id: session.id, jobTitle: session.jobTitle, companyName: session.companyName, status: session.status },
    staleSuggestionCount: preview.staleSuggestionIds.length,
  };
};

// "Jane Doe CV (final).pdf" + classic -> "Jane-Doe-CV-final-classic.pdf" (or
// ".docx"): ASCII letters, digits, dots, dashes and underscores only, so it is
// safe in headers and on every file system.
export const exportFilename = (sourceFilename: string, template: TemplateId, extension: 'pdf' | 'docx' = 'pdf') => {
  const base =
    sourceFilename
      .replace(/\.[A-Za-z0-9]{1,5}$/, '')
      .normalize('NFKD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/[^A-Za-z0-9._-]+/g, '-')
      .replace(/^[-.]+|[-.]+$/g, '')
      .replace(/-{2,}/g, '-')
      .slice(0, 80) || 'resume';
  return `${base}-${template}.${extension}`;
};

export const exportFingerprint = (template: TemplateId, text: string) =>
  crypto.createHash('sha256').update(`${template}\n${text}`).digest('hex');

const TEMPLATE_LABEL: Record<TemplateId, string> = { classic: 'Classic', modern: 'Modern', compact: 'Compact' };

// Stores a generated PDF as a new, non-current version of the resume's group.
// Saving the same approved text with the same template again returns the
// existing version (the fingerprint is unique within a group). The file is
// written inside the transaction and removed if it does not commit.
export const saveExportedVersion = async (
  userId: string,
  content: ApprovedContent,
  template: TemplateId,
  pdf: Buffer,
  filename: string
): Promise<{ resumeId: string; created: boolean } | 'not_found'> => {
  const fingerprint = exportFingerprint(template, content.text);
  const connection = await pool.getConnection();
  let filePath: string | null = null;
  let committed = false;
  try {
    await beginVersionTransaction(connection);
    const groupId = await lockGroupOf(connection, content.resume.id, userId);
    if (!groupId) {
      await connection.rollback();
      return 'not_found';
    }
    const [existing]: any = await connection.execute(
      'SELECT id FROM resumes WHERE resume_group_id = ? AND export_fingerprint = ? AND user_id = ?',
      [groupId, fingerprint, userId]
    );
    if (existing[0]) {
      await connection.rollback();
      return { resumeId: existing[0].id, created: false };
    }
    const next = await reserveNextVersion(connection, content.resume.id, userId);
    if (!next) {
      await connection.rollback();
      return 'not_found';
    }
    const storedFilename = `${uuidv4()}.pdf`;
    filePath = path.join(UPLOAD_DIR, storedFilename);
    await fs.promises.writeFile(filePath, pdf, { flag: 'wx' });

    const id = uuidv4();
    await connection.execute(
      `INSERT INTO resumes (id, user_id, resume_group_id, version_number, version_label, is_current, source_type,
         export_template, export_fingerprint, exported_from_resume_id, exported_from_session_id,
         original_filename, stored_filename, file_path, file_size, mime_type, extraction_status, text_content)
       VALUES (?, ?, ?, ?, ?, 0, 'exported', ?, ?, ?, ?, ?, ?, ?, ?, 'application/pdf', 'completed', ?)`,
      [
        id,
        userId,
        next.groupId,
        next.versionNumber,
        `Exported PDF (${TEMPLATE_LABEL[template]})`,
        template,
        fingerprint,
        content.resume.id,
        content.session?.id ?? null,
        filename,
        storedFilename,
        filePath,
        pdf.length,
        content.text,
      ]
    );
    await connection.commit();
    committed = true;
    return { resumeId: id, created: true };
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
    if (filePath && !committed) await fs.promises.unlink(filePath).catch(() => {});
  }
};

// The absolute path of a version's stored file, only if it is inside the
// private upload directory (a stored path pointing anywhere else is refused).
export const storedFilePath = (filePath: string) => {
  const root = path.resolve(UPLOAD_DIR);
  const resolved = path.resolve(filePath);
  return resolved.startsWith(root + path.sep) ? resolved : null;
};
