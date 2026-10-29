"use client";

import { Suspense, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useRequireAuth } from '@/hooks/useRequireAuth';
import { createApplication, type Application } from '@/lib/api/applications.api';
import { getJobDescription } from '@/lib/api/jobDescription.api';
import ApplicationForm from '@/components/ApplicationForm';

function NewApplicationContent() {
  const { isAuthenticated, loading } = useRequireAuth();
  const router = useRouter();
  const params = useSearchParams();
  const jobId = params.get('jobDescriptionId');
  const coverLetterId = params.get('coverLetterId');
  const [prefill, setPrefill] = useState<Partial<Application> | null>(jobId ? null : { coverLetterId });

  // Starting from a saved job description fills in its title, company and link (nothing else is assumed).
  useEffect(() => {
    if (!isAuthenticated || !jobId) return;
    let cancelled = false;
    getJobDescription(jobId)
      .then((data) => {
        if (cancelled) return;
        const jd = data.data.jobDescription;
        setPrefill({ jobTitle: jd.title, companyName: jd.companyName ?? '', jobDescriptionId: jd.id, coverLetterId });
      })
      .catch(() => {
        if (!cancelled) setPrefill({ coverLetterId });
      });
    return () => {
      cancelled = true;
    };
  }, [isAuthenticated, jobId, coverLetterId]);

  if (loading) return <div className="p-8 text-center text-gray-600">Loading...</div>;
  if (!isAuthenticated) return null;

  return (
    <div className="page-container p-4 md:p-8 space-y-4">
      <Link href="/dashboard/applications" className="text-gray-500 hover:text-gray-800 text-sm">
        ← Back to Applications
      </Link>
      <h1 className="text-3xl font-bold">Add Application</h1>
      <p className="text-gray-600">Only the job title and company are required. Everything else can be added later.</p>
      {prefill === null ? (
        <p className="text-gray-500" role="status">
          Loading...
        </p>
      ) : (
        <ApplicationForm
          initial={prefill}
          submitLabel="Save Application"
          onSubmit={async (input) => {
            const created = await createApplication(input);
            router.push(`/dashboard/applications/${created.id}?saved=1`);
          }}
        />
      )}
    </div>
  );
}

// useSearchParams (for prefill links) must sit inside a Suspense boundary.
export default function NewApplication() {
  return (
    <Suspense fallback={<div className="p-8 text-center text-gray-600">Loading...</div>}>
      <NewApplicationContent />
    </Suspense>
  );
}
