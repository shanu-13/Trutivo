import { apiClient, apiDownload } from './client';
import type { ResumeSummary } from './resume.api';

// Professional PDF (Step 9D) and editable DOCX (Step 10) export. The server builds
// every document from stored, approved content; the browser only picks a template.

export type TemplateId = 'classic' | 'modern' | 'compact';

export type DocumentBlock = { type: 'entry' | 'bullet' | 'text'; text: string };

export interface ExportSection {
  title: string;
  kind: 'summary' | 'skills' | 'entries' | 'text';
  blocks: DocumentBlock[];
}

export interface ExportDocument {
  name: string | null;
  details: string[];
  sections: ExportSection[];
}

export interface TemplateInfo {
  id: TemplateId;
  name: string;
  description: string;
}

export interface ExportPreview {
  document: ExportDocument;
  resume: { id: string; originalFilename: string; versionNumber: number; versionLabel: string | null; sourceType: string };
  session: { id: string; jobTitle: string; companyName: string | null; status: 'draft' | 'saved' } | null;
  staleSuggestionCount: number;
  templates: TemplateInfo[];
  unsupportedCharacters: string[];
}

const json = (body: unknown): RequestInit => ({
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
});
const exportBody = (template: TemplateId, sessionId: string | null) => (sessionId ? { template, tailoringSessionId: sessionId } : { template });

export const getExportPreview = async (resumeId: string, sessionId: string | null): Promise<ExportPreview> => {
  const query = sessionId ? `?tailoringSessionId=${encodeURIComponent(sessionId)}` : '';
  const data = await apiClient(`/resumes/${encodeURIComponent(resumeId)}/export/document${query}`);
  return data.data;
};

export const downloadExportPdf = (resumeId: string, template: TemplateId, sessionId: string | null) =>
  apiDownload(`/resumes/${encodeURIComponent(resumeId)}/export/pdf`, json(exportBody(template, sessionId)));

export const DOCX_CONTENT_TYPE = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

// The same approved content as an editable Word document (Step 10).
export const downloadExportDocx = (resumeId: string, template: TemplateId, sessionId: string | null) =>
  apiDownload(`/resumes/${encodeURIComponent(resumeId)}/export/docx`, json(exportBody(template, sessionId)));

export const saveExportVersion = async (
  resumeId: string,
  template: TemplateId,
  sessionId: string | null
): Promise<{ resume: ResumeSummary | null; created: boolean }> => {
  const data = await apiClient(`/resumes/${encodeURIComponent(resumeId)}/export/save`, json(exportBody(template, sessionId)));
  return data.data;
};

// The stored file of a version (uploaded PDF, tailored text or saved export).
export const downloadResumeFile = (resumeId: string) => apiDownload(`/resumes/${encodeURIComponent(resumeId)}/file`);

// Saves a downloaded file in the browser and releases the temporary object URL.
export const saveBlob = (blob: Blob, filename: string) => {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.rel = 'noopener';
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
};
