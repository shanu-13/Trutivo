"use client";

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import JobDescriptionForm from '@/components/JobDescriptionForm';
import { useRequireAuth } from '@/hooks/useRequireAuth';
import { createJobDescription, type JobDescriptionInput } from '@/lib/api/jobDescription.api';

export default function CreateJobDescription() {
  const { isAuthenticated, loading } = useRequireAuth();
  const router = useRouter();

  const handleSubmit = async (values: JobDescriptionInput) => {
    const data = await createJobDescription(values);
    router.push(`/job-descriptions/${data.data.jobDescription.id}?saved=1`);
  };

  if (loading) {
    return <div className="p-8 text-center text-gray-600">Loading...</div>;
  }
  if (!isAuthenticated) return null;

  return (
    <div className="page-container p-4 md:p-8">
      <Link href="/job-descriptions" className="text-gray-500 hover:text-gray-800 text-sm">
        ← Back to Job Descriptions
      </Link>
      <div className="bg-white p-6 md:p-10 rounded-xl shadow-sm border border-gray-100 mt-4">
        <h1 className="text-2xl md:text-3xl font-bold mb-6 text-gray-900">Add Job Description</h1>
        <JobDescriptionForm submitLabel="Save Job Description" submittingLabel="Saving..." onSubmit={handleSubmit} />
      </div>
    </div>
  );
}
