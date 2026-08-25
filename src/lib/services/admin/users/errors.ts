export type AdminUserErrorCode =
  | 'forbidden'
  | 'not_found'
  | 'admin_role_via_ui'
  | 'self_action_forbidden'
  | 'last_admin_protected'
  | 'duplicate_email'
  | 'member_limit_reached'
  | 'role_transition_forbidden'
  | 'not_staff'
  | 'company_required';

export class AdminUserError extends Error {
  readonly code: AdminUserErrorCode;
  constructor(code: AdminUserErrorCode) {
    super(code);
    this.code = code;
    this.name = 'AdminUserError';
  }
}

export type AdminUserFailure = { ok: false; error: AdminUserErrorCode };
