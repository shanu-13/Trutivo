"use client";

import { Suspense } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useRequireAuth } from '@/hooks/useRequireAuth';
import CoverLetterWorkspace from '@/components/CoverLetterWorkspace';

function NewCoverLetterContent() {
  const { isAuthenticated, loading } = useRequireAuth();
  const params = useSearchParams();
  if (loading) return <div className="p-8 text-center text-gray-600">Loading...</div>;
  if (!isAuthenticated) return null;
  return (
    <div className="page-container p-4 md:p-8 space-y-4">
      <Link href="/dashboard/cover-letters" className="text-gray-500 hover:text-gray-800 text-sm">
        ← Back to Cover Letters
      </Link>
      {/* Preselections are only used if they are among the user's own items (checked by the workspace and the server). */}
      <CoverLetterWorkspace saved={null} preselectResumeId={params.get('resumeId')} preselectJobDescriptionId={params.get('jobDescriptionId')} />
    </div>
  );
}

// useSearchParams (for preselection links) must sit inside a Suspense boundary.
export default function NewCoverLetter() {
  return (
    <Suspense fallback={<div className="p-8 text-center text-gray-600">Loading...</div>}>
      <NewCoverLetterContent />
    </Suspense>
  );
}
