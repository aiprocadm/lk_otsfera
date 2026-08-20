import { mobileShellChecks } from '../mobile-shell-check';

mobileShellChecks('заказчик', '/organization/dashboard', [
  '/organization/orders',
  '/organization/documents',
  '/organization/team',
]);
