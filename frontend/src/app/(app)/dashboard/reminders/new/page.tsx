"use client";

import { Suspense } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useRequireAuth } from '@/hooks/useRequireAuth';
import { REMINDER_TYPES, createReminder, type ReminderType } from '@/lib/api/reminders.api';
import ReminderForm from '@/components/ReminderForm';

function NewReminderContent() {
  const { isAuthenticated, loading } = useRequireAuth();
  const router = useRouter();
  const params = useSearchParams();
  // Opened from an application: link it and return there after saving.
  const applicationId = params.get('applicationId');
  const typeParam = params.get('type');
  const type = (REMINDER_TYPES as readonly string[]).includes(typeParam ?? '') ? (typeParam as ReminderType) : undefined;

  if (loading) return <div className="p-8 text-center text-gray-600">Loading...</div>;
  if (!isAuthenticated) return null;

  const back = applicationId ? `/dashboard/applications/${encodeURIComponent(applicationId)}` : '/dashboard/reminders';
  return (
    <div className="page-container p-4 md:p-8 space-y-4">
      <Link href={back} className="text-gray-500 hover:text-gray-800 text-sm">
        ← Back
      </Link>
      <h1 className="text-3xl font-bold">New Reminder</h1>
      <ReminderForm
        initial={{ applicationId, type }}
        submitLabel="Save Reminder"
        onSubmit={async (input) => {
          await createReminder(input);
          router.push(applicationId && input.applicationId === applicationId ? `${back}?reminder=1` : '/dashboard/reminders?saved=1');
        }}
      />
    </div>
  );
}

// useSearchParams (for the application link) must sit inside a Suspense boundary.
export default function NewReminder() {
  return (
    <Suspense fallback={<div className="p-8 text-center text-gray-600">Loading...</div>}>
      <NewReminderContent />
    </Suspense>
  );
}
