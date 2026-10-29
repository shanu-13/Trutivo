"use client";

import ConfirmDialog from '@/components/ConfirmDialog';

interface Props<T> {
  target: T | null;
  busy: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

// The consequences follow the database's ON DELETE CASCADE rules.
export function DeleteResumeDialog({
  target,
  ...props
}: Props<{ originalFilename: string; versionNumber?: number; versionCount?: number; isCurrent?: boolean }>) {
  const otherVersions = (target?.versionCount ?? 1) - 1;
  return (
    <ConfirmDialog
      open={target !== null}
      title={otherVersions > 0 ? `Delete version ${target?.versionNumber}?` : 'Delete this resume?'}
      confirmLabel={otherVersions > 0 ? 'Delete Version' : 'Delete Resume'}
      busyLabel="Deleting..."
      {...props}
    >
      <p>
        <span className="font-semibold">{target?.originalFilename}</span> will be permanently deleted, together with its
        extracted text and skills.
      </p>
      <p>Saved match results that used this file are also deleted. Your job descriptions are not affected.</p>
      {otherVersions > 0 && (
        <p>
          The other {otherVersions === 1 ? 'version is' : `${otherVersions} versions are`} kept
          {target?.isCurrent ? '; the newest remaining version with extracted text becomes current' : ''}.
        </p>
      )}
      <p>This cannot be undone.</p>
    </ConfirmDialog>
  );
}

export function DeleteJobDescriptionDialog({ target, ...props }: Props<{ title: string; companyName: string | null }>) {
  return (
    <ConfirmDialog
      open={target !== null}
      title="Delete this job description?"
      confirmLabel="Delete Job Description"
      busyLabel="Deleting..."
      {...props}
    >
      <p>
        <span className="font-semibold">{target?.title}</span>
        {target?.companyName ? ` (${target.companyName})` : ''} will be permanently deleted, together with its extracted
        requirements.
      </p>
      <p>Saved match results that used this job description are also deleted. Your resumes are not affected.</p>
      <p>This cannot be undone.</p>
    </ConfirmDialog>
  );
}
