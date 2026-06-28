import type { SessionPayload } from '@/lib/auth/jwt';

/**
 * T5 enrollment-request RBAC. Reviewers (approve/reject/provision) are our side:
 * managers (incl. leader sub-role) and admins. Submitters are all five roles.
 * Leaders carry role='manager' + managerRole='leader', so the manager branch
 * already covers them.
 */
export function canReviewEnrollments(session: SessionPayload): boolean {
  return session.role === 'manager' || session.role === 'admin';
}

export function canSubmitEnrollments(session: SessionPayload): boolean {
  return (
    session.role === 'partner' ||
    session.role === 'organization' ||
    session.role === 'manager' ||
    session.role === 'admin'
  );
}

/** Snapshot label stored on the request (distinguishes leader from plain manager). */
export function submitterRoleLabel(session: SessionPayload): string {
  if (session.role === 'manager' && session.managerRole === 'leader') return 'leader';
  return session.role;
}
