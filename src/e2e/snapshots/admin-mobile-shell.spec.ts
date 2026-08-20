import { mobileShellChecks } from '../mobile-shell-check';

mobileShellChecks('администратор', '/admin/dashboard', [
  '/admin/users',
  '/admin/partners',
  '/admin/organizations',
  '/admin/settings/security/audit',
]);
