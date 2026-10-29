"use client";

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import JobDescriptionForm from '@/components/JobDescriptionForm';
import { useRequireAuth } from '@/hooks/useRequireAuth';
import {
  getJobDescription,
  updateJobDescription,
  type JobDescription,
  type JobDescriptionInput,
} from '@/lib/api/jobDescription.api';

export default function EditJobDescription() {
  const { isAuthenticated, loading } = useRequireAuth();
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [jobDescription, setJobDescription] = useState<JobDescription | null>(null);
  const [fetching, setFetching] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!isAuthenticated || !id) return;
    let cancelled = false;
    getJobDescription(id)
      .then((data) => {
        if (!cancelled) setJobDescription(data.data.jobDescription);
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Failed to load job description');
      })
      .finally(() => {
        if (!cancelled) setFetching(false);
      });
    return () => {
      cancelled = true;
    };
  }, [isAuthenticated, id]);

  const handleSubmit = async (values: JobDescriptionInput) => {
    await updateJobDescription(id, values);
    router.push(`/job-descriptions/${id}?saved=1`);
  };

  if (loading || (isAuthenticated && fetching)) {
    return <div className="p-8 text-center text-gray-600">Loading...</div>;
  }
  if (!isAuthenticated) return null;

  if (!jobDescription) {
    return (
      <div className="page-container p-4 md:p-8 text-center">
        <p className="text-gray-700 text-lg mb-6 whitespace-pre-line">{error || 'Job description not found'}</p>
        <Link href="/job-descriptions" className="text-blue-600 hover:text-blue-800 font-medium">
          Back to Job Descriptions
        </Link>
      </div>
    );
  }

  return (
    <div className="page-container p-4 md:p-8">
      <Link href={`/job-descriptions/${jobDescription.id}`} className="text-gray-500 hover:text-gray-800 text-sm">
        ← Back to Job Description
      </Link>
      <div className="bg-white p-6 md:p-10 rounded-xl shadow-sm border border-gray-100 mt-4">
        <h1 className="text-2xl md:text-3xl font-bold mb-6 text-gray-900">Edit Job Description</h1>
        <JobDescriptionForm
          initialValues={{
            title: jobDescription.title,
            companyName: jobDescription.companyName,
            descriptionText: jobDescription.descriptionText,
          }}
          submitLabel="Save Changes"
          submittingLabel="Saving..."
          onSubmit={handleSubmit}
        />
      </div>
    </div>
  );
}
