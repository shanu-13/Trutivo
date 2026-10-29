import { apiClient } from './client';

// Must match the backend's validation limits.
export const MAX_TITLE_LENGTH = 200;
export const MAX_COMPANY_NAME_LENGTH = 200;
export const MAX_DESCRIPTION_LENGTH = 50000;

export interface JobDescriptionSummary {
  id: string;
  title: string;
  companyName: string | null;
  createdAt: string;
  updatedAt: string;
  // List responses only: when requirements were last extracted, null if they
  // have not been (or were discarded because the text changed).
  requirementsExtractedAt?: string | null;
}

export interface JobDescription extends JobDescriptionSummary {
  descriptionText: string;
}

export interface JobDescriptionInput {
  title: string;
  companyName: string | null;
  descriptionText: string;
}

const jsonRequest = (method: string, body: unknown): RequestInit => ({
  method,
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
});

export const getJobDescriptions = async () => {
  return apiClient('/job-descriptions');
};

export const getJobDescriptionList = async (): Promise<JobDescriptionSummary[]> => {
  const data = await getJobDescriptions();
  return data.data.jobDescriptions as JobDescriptionSummary[];
};

export const getJobDescription = async (id: string) => {
  return apiClient(`/job-descriptions/${encodeURIComponent(id)}`);
};

export const createJobDescription = async (input: JobDescriptionInput) => {
  return apiClient('/job-descriptions', jsonRequest('POST', input));
};

export const updateJobDescription = async (id: string, input: JobDescriptionInput) => {
  return apiClient(`/job-descriptions/${encodeURIComponent(id)}`, jsonRequest('PUT', input));
};

export const deleteJobDescription = async (id: string) => {
  return apiClient(`/job-descriptions/${encodeURIComponent(id)}`, { method: 'DELETE' });
};

export const processJobDescription = async (id: string) => {
  return apiClient(`/job-descriptions/${encodeURIComponent(id)}/process`, { method: 'POST' });
};

export interface ExperienceRequirement {
  minimumYears: number | null;
  maximumYears: number | null;
  areas: string[];
  preferred: boolean;
  text: string;
}

export interface EducationRequirement {
  degree: string | null;
  fields: string[];
  preferred: boolean;
  text: string;
}

export interface JobRequirements {
  jobTitle: string | null;
  location: string | null;
  employmentType: string | null;
  workMode: string | null;
  requiredSkills: string[];
  preferredSkills: string[];
  mentionedSkills: string[];
  experienceRequirements: ExperienceRequirement[];
  educationRequirements: EducationRequirement[];
  responsibilities: string[];
}

export const getJobRequirements = async (id: string) => {
  return apiClient(`/job-descriptions/${encodeURIComponent(id)}/requirements`);
};

export const extractJobRequirements = async (id: string) => {
  return apiClient(`/job-descriptions/${encodeURIComponent(id)}/extract-requirements`, { method: 'POST' });
};
