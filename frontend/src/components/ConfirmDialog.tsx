"use client";

import { useEffect, useId, useRef, type ReactNode } from 'react';

interface Props {
  open: boolean;
  title: string;
  children: ReactNode;
  confirmLabel: string;
  busyLabel: string;
  // While true the action is running: both buttons are disabled and Escape is ignored.
  busy: boolean;
  onConfirm: () => void;
  onCancel: () => void;
  // 'danger' (default) for destructive actions.
  tone?: 'danger' | 'primary';
}

// A modal confirmation built on the native <dialog> element, which traps focus
// and closes on Escape. Focus starts on Cancel, so Enter does not delete by accident.
export default function ConfirmDialog({ open, title, children, confirmLabel, busyLabel, busy, onConfirm, onCancel, tone = 'danger' }: Props) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const titleId = useId();
  const bodyId = useId();

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open && !dialog.open) {
      dialog.showModal();
      cancelRef.current?.focus();
    } else if (!open && dialog.open) {
      dialog.close();
    }
  }, [open]);

  return (
    <dialog
      ref={dialogRef}
      aria-labelledby={titleId}
      aria-describedby={bodyId}
      onCancel={(e) => {
        e.preventDefault();
        if (!busy) onCancel();
      }}
      className="m-auto w-[calc(100%-2rem)] max-w-md rounded-xl p-0 shadow-xl backdrop:bg-black/40"
    >
      <div className="p-6">
        <h2 id={titleId} className="text-lg font-bold text-gray-900 mb-3 break-words">
          {title}
        </h2>
        <div id={bodyId} className="text-sm text-gray-700 space-y-2 break-words">
          {children}
        </div>
        <div className="flex flex-col-reverse sm:flex-row justify-end gap-2 mt-6">
          <button
            ref={cancelRef}
            type="button"
            onClick={onCancel}
            disabled={busy}
            className="px-4 py-2 rounded-lg border border-gray-300 text-gray-800 hover:bg-gray-50 disabled:opacity-50 font-medium"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={busy}
            className={`px-4 py-2 rounded-lg text-white disabled:opacity-50 font-medium ${tone === 'danger' ? 'bg-red-600 hover:bg-red-700' : 'bg-blue-600 hover:bg-blue-700'}`}
          >
            {busy ? busyLabel : confirmLabel}
          </button>
        </div>
      </div>
    </dialog>
  );
}
