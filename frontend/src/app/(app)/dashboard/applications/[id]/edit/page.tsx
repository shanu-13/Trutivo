"use client";

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useRequireAuth } from '@/hooks/useRequireAuth';
import { ApiError } from '@/lib/api/client';
import { getApplication, updateApplication, type Application } from '@/lib/api/applications.api';
import { errorMessage } from '@/lib/format';
import ApplicationForm from '@/components/ApplicationForm';

export default function EditApplication() {
  const { isAuthenticated, loading } = useRequireAuth();
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [application, setApplication] = useState<Application | null>(null);
  const [error, setError] = useState('');
  const [notFound, setNotFound] = useState(false);

  useEffect(() => {
    if (!isAuthenticated || !id) return;
    let cancelled = false;
    getApplication(id)
      .then((data) => {
        if (!cancelled) setApplication(data.application);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        if (err instanceof ApiError && (err.status === 404 || err.status === 400)) setNotFound(true);
        else setError(errorMessage(err, 'Failed to load the application'));
      });
    return () => {
      cancelled = true;
    };
  }, [isAuthenticated, id]);

  if (loading) return <div className="p-8 text-center text-gray-600">Loading...</div>;
  if (!isAuthenticated) return null;

  return (
    <div className="page-container p-4 md:p-8 space-y-4">
      <Link href={`/dashboard/applications/${id}`} className="text-gray-500 hover:text-gray-800 text-sm">
        ← Back to Application
      </Link>
      <h1 className="text-3xl font-bold">Edit Application</h1>
      {notFound && (
        <p role="alert" className="text-gray-700 text-lg">
          Application not found.
        </p>
      )}
      {error && (
        <p role="alert" className="text-red-600 whitespace-pre-line">
          {error}
        </p>
      )}
      {!application && !notFound && !error && (
        <p className="text-gray-500" role="status">
          Loading...
        </p>
      )}
      {application && (
        <ApplicationForm
          key={application.id}
          initial={application}
          submitLabel="Save Changes"
          onSubmit={async (input) => {
            await updateApplication(application.id, input);
            router.push(`/dashboard/applications/${application.id}?saved=1`);
          }}
        />
      )}
    </div>
  );
}
