'use client';

import React from 'react';

export type FieldProps = {
  htmlFor: string;
  label: string;
  hint?: string;
  error?: string | null;
  children?: React.ReactNode;
};

/**
 * Label + control + feedback wrapper. The caller passes the control's `id` as
 * `htmlFor` and, when it wants screen-reader association, sets
 * aria-describedby={`${htmlFor}-err`} on the control. The error region is a
 * persistent role="alert" (inline alert for field-level validation).
 */
export function Field({ htmlFor, label, hint, error, children }: FieldProps) {
  const errId = `${htmlFor}-err`;
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={htmlFor} className="text-xs text-gray-500">
        {label}
      </label>
      {children}
      {hint && !error && <p className="text-xs text-gray-400">{hint}</p>}
      {error && (
        <p id={errId} role="alert" className="text-sm text-red-600">
          {error}
        </p>
      )}
    </div>
  );
}
