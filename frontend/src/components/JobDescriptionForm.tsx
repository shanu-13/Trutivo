"use client";

import { useState } from 'react';
import { ApiError } from '@/lib/api/client';
import {
  MAX_COMPANY_NAME_LENGTH,
  MAX_DESCRIPTION_LENGTH,
  MAX_TITLE_LENGTH,
  type JobDescriptionInput,
} from '@/lib/api/jobDescription.api';

type Field = keyof JobDescriptionInput;
type FieldErrors = Partial<Record<Field, string>>;

interface Props {
  initialValues?: JobDescriptionInput;
  submitLabel: string;
  submittingLabel: string;
  onSubmit: (values: JobDescriptionInput) => Promise<void>;
}

// Matches the backend: whitespace and invisible characters alone are not content.
const hasVisibleText = (value: string) => value.replace(/[\s​-‍⁠﻿­]/g, '').length > 0;

const validate = (values: JobDescriptionInput): FieldErrors => {
  const errors: FieldErrors = {};
  const title = values.title.trim();
  if (!title) errors.title = 'Job title is required';
  else if (title.length > MAX_TITLE_LENGTH) errors.title = `Job title must be at most ${MAX_TITLE_LENGTH} characters`;

  if ((values.companyName ?? '').trim().length > MAX_COMPANY_NAME_LENGTH) {
    errors.companyName = `Company name must be at most ${MAX_COMPANY_NAME_LENGTH} characters`;
  }

  if (!hasVisibleText(values.descriptionText)) errors.descriptionText = 'Job description is required';
  else if (values.descriptionText.length > MAX_DESCRIPTION_LENGTH) {
    errors.descriptionText = `Job description must be at most ${MAX_DESCRIPTION_LENGTH.toLocaleString()} characters`;
  }
  return errors;
};

// Per-field messages from a JOB_DESCRIPTION_VALIDATION_ERROR response.
const serverFieldErrors = (err: unknown): FieldErrors => {
  if (!(err instanceof ApiError) || !Array.isArray(err.details)) return {};
  const errors: FieldErrors = {};
  for (const detail of err.details) {
    if (detail && typeof detail.field === 'string' && typeof detail.message === 'string') {
      errors[detail.field as Field] ??= detail.message;
    }
  }
  return errors;
};

// No maxLength attributes: they silently cut off pasted text. Over-long input is
// reported by validation instead.
const inputClass = (hasError: boolean) =>
  `w-full border rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500 ${hasError ? 'border-red-400' : 'border-gray-300'}`;

export default function JobDescriptionForm({ initialValues, submitLabel, submittingLabel, onSubmit }: Props) {
  const [title, setTitle] = useState(initialValues?.title ?? '');
  const [companyName, setCompanyName] = useState(initialValues?.companyName ?? '');
  const [descriptionText, setDescriptionText] = useState(initialValues?.descriptionText ?? '');
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const values: JobDescriptionInput = {
      title: title.trim(),
      companyName: companyName.trim() || null,
      descriptionText,
    };

    const errors = validate(values);
    setFieldErrors(errors);
    setError('');
    if (Object.keys(errors).length > 0) return;

    setSubmitting(true);
    try {
      await onSubmit(values);
    } catch (err: unknown) {
      setFieldErrors(serverFieldErrors(err));
      setError(err instanceof Error && err.message ? err.message : 'Failed to save job description');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} noValidate className="space-y-6">
      {error && (
        <div className="bg-red-50 text-red-600 p-4 rounded-lg text-sm font-medium border border-red-100 whitespace-pre-line">
          {error}
        </div>
      )}

      <div>
        <label htmlFor="jd-title" className="block font-medium text-gray-800 mb-1">
          Job Title <span className="text-red-700">*</span>
        </label>
        <input
          id="jd-title"
          type="text"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Frontend Developer"
          aria-invalid={Boolean(fieldErrors.title)}
          aria-describedby={fieldErrors.title ? 'jd-title-error' : undefined}
          className={inputClass(Boolean(fieldErrors.title))}
        />
        {fieldErrors.title && <p id="jd-title-error" className="text-sm text-red-600 mt-1">{fieldErrors.title}</p>}
      </div>

      <div>
        <label htmlFor="jd-company" className="block font-medium text-gray-800 mb-1">
          Company Name
        </label>
        <input
          id="jd-company"
          type="text"
          value={companyName}
          onChange={(e) => setCompanyName(e.target.value)}
          placeholder="Example Technologies"
          aria-invalid={Boolean(fieldErrors.companyName)}
          aria-describedby={fieldErrors.companyName ? 'jd-company-error' : undefined}
          className={inputClass(Boolean(fieldErrors.companyName))}
        />
        {fieldErrors.companyName && (
          <p id="jd-company-error" className="text-sm text-red-600 mt-1">{fieldErrors.companyName}</p>
        )}
      </div>

      <div>
        <label htmlFor="jd-description" className="block font-medium text-gray-800 mb-1">
          Job Description <span className="text-red-700">*</span>
        </label>
        <textarea
          id="jd-description"
          value={descriptionText}
          onChange={(e) => setDescriptionText(e.target.value)}
          rows={14}
          placeholder="We are looking for a frontend developer..."
          aria-invalid={Boolean(fieldErrors.descriptionText)}
          aria-describedby="jd-description-help"
          className={`${inputClass(Boolean(fieldErrors.descriptionText))} font-mono text-sm`}
        />
        <div id="jd-description-help" className="flex justify-between gap-4 mt-1 text-sm">
          <span className="text-red-600">{fieldErrors.descriptionText}</span>
          <span className={descriptionText.length > MAX_DESCRIPTION_LENGTH ? 'text-red-600' : 'text-gray-500'}>
            {descriptionText.length.toLocaleString()} / {MAX_DESCRIPTION_LENGTH.toLocaleString()}
          </span>
        </div>
      </div>

      <button
        type="submit"
        disabled={submitting}
        className="w-full sm:w-auto bg-blue-600 text-white px-6 py-3 rounded-lg font-semibold hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition"
      >
        {submitting ? submittingLabel : submitLabel}
      </button>
    </form>
  );
}
