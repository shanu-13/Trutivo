import { apiClient } from './client';

// Must match the backend upload rules (backend/src/middleware/upload.middleware.ts):
// a .pdf file with the application/pdf type, at most 5 MB.
export const MAX_RESUME_SIZE_BYTES = 5 * 1024 * 1024;
export const ACCEPTED_RESUME_TYPES = '.pdf,application/pdf';

// resumes.extraction_status values written by the backend.
export type ExtractionStatus = 'pending' | 'processing' | 'completed' | 'no_text' | 'failed';

export interface ResumeSummary {
  id: string;
  originalFilename: string;
  fileSize: number;
  mimeType: string;
  extractionStatus: ExtractionStatus;
  skillsExtractedAt: string | null;
  createdAt: string;
  // Versioning (Step 9B): uploads of the same resume share a group.
  resumeGroupId: string;
  versionNumber: number;
  versionLabel: string | null;
  // The version used by default: the newest one whose text was extracted, or the one chosen by the user.
  isCurrent: boolean;
  versionCount: number;
  // 'tailored': saved from a tailoring session (text only, no PDF);
  // 'exported': a PDF generated and saved from approved content.
  sourceType: 'upload' | 'tailored' | 'exported';
  exportTemplate: string | null;
}

// Must match the backend's limit for version labels.
export const MAX_VERSION_LABEL_LENGTH = 100;

export interface ListComparison {
  status: 'available' | 'unavailable';
  reason: string | null;
  added: string[];
  removed: string[];
  unchanged: string[];
}

export interface VersionInfo {
  resumeId: string;
  versionNumber: number;
  versionLabel: string | null;
  filename: string;
  extractionStatus: ExtractionStatus;
  isCurrent: boolean;
  createdAt: string;
}

export interface ScoreChange {
  jobDescriptionId: string;
  jobTitle: string;
  companyName: string | null;
  olderScore: number;
  newerScore: number;
  difference: number;
  olderMatchId: string;
  newerMatchId: string;
  olderAnalyzedAt: string;
  newerAnalyzedAt: string;
}

export interface VersionComparison {
  olderVersion: VersionInfo;
  newerVersion: VersionInfo;
  skills: ListComparison & { source: 'stored' | 'analysis' | null };
  sections: {
    experience: ListComparison;
    education: ListComparison;
    projects: ListComparison;
    certifications: ListComparison;
    analysisAvailable: boolean;
  };
  text: {
    status: 'available' | 'unavailable';
    changed: boolean | null;
    linesAdded: number | null;
    linesRemoved: number | null;
    olderWordCount: number | null;
    newerWordCount: number | null;
  };
  matchScoreComparison: ScoreChange[];
  matchScoreMessage: string | null;
}

export const uploadResume = async (file: File) => {
  const formData = new FormData();
  formData.append('resume', file);
  return apiClient('/resumes', {
    method: 'POST',
    body: formData,
  });
};

export const getResumes = async () => {
  return apiClient('/resumes');
};

export const getResumeList = async (): Promise<ResumeSummary[]> => {
  const data = await getResumes();
  return data.data.resumes as ResumeSummary[];
};

export const getResume = async (id: string) => {
  return apiClient(`/resumes/${encodeURIComponent(id)}`);
};

export const extractResume = async (id: string) => {
  return apiClient(`/resumes/${id}/extract`, {
    method: 'POST'
  });
};

export const deleteResume = async (id: string) => {
  return apiClient(`/resumes/${encodeURIComponent(id)}`, {
    method: 'DELETE'
  });
};

export const extractResumeSkills = async (id: string) => {
  return apiClient(`/resumes/${id}/extract-skills`, {
    method: 'POST'
  });
};

export const getResumeSkills = async (id: string) => {
  return apiClient(`/resumes/${id}/skills`);
};

export const extractResumeSections = async (id: string) => {
  return apiClient(`/resumes/${id}/extract-sections`, {
    method: 'POST'
  });
};

export const analyzeResume = async (id: string) => {
  return apiClient(`/resumes/${id}/analyze`, {
    method: 'POST'
  });
};

export const matchResumeToJob = async (resumeId: string, jobDescriptionId: string) => {
  return apiClient(`/resumes/${encodeURIComponent(resumeId)}/match/${encodeURIComponent(jobDescriptionId)}`, {
    method: 'POST'
  });
};

export const getResumeVersions = async (id: string): Promise<{ resumeGroupId: string; versions: ResumeSummary[] }> => {
  const data = await apiClient(`/resumes/${encodeURIComponent(id)}/versions`);
  return data.data;
};

// Uploads `file` as the next version of the resume `id` belongs to.
export const uploadResumeVersion = async (id: string, file: File, versionLabel: string) => {
  const formData = new FormData();
  if (versionLabel.trim()) formData.append('versionLabel', versionLabel.trim());
  formData.append('resume', file);
  return apiClient(`/resumes/${encodeURIComponent(id)}/versions`, { method: 'POST', body: formData });
};

export const makeCurrentVersion = async (id: string) => {
  return apiClient(`/resumes/${encodeURIComponent(id)}/current`, { method: 'PATCH' });
};

export const compareResumeVersions = async (id: string, otherId: string): Promise<VersionComparison> => {
  const data = await apiClient(`/resumes/${encodeURIComponent(id)}/versions/${encodeURIComponent(otherId)}/compare`);
  return data.data;
};
