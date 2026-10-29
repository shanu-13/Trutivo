"use client";

import { useId } from 'react';

interface Props {
  label: string;
  placeholder: string;
  value: string;
  onChange: (value: string) => void;
  shown: number;
  total: number;
}

// Filters a list that is already loaded; nothing is sent to the server.
export default function ListSearch({ label, placeholder, value, onChange, shown, total }: Props) {
  const id = useId();
  return (
    <div className="flex flex-col sm:flex-row sm:items-center gap-2 mb-4">
      <label htmlFor={id} className="sr-only">
        {label}
      </label>
      <input
        id={id}
        type="search"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full sm:max-w-sm border border-gray-300 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
      />
      {value.trim() && (
        <p className="text-sm text-gray-500" role="status">
          Showing {shown} of {total}
        </p>
      )}
    </div>
  );
}

export const matchesSearch = (query: string, ...fields: (string | null | undefined)[]) => {
  const q = query.trim().toLowerCase();
  return !q || fields.some((field) => field?.toLowerCase().includes(q));
};
