/**
 * Single import surface for transient feedback. <Toaster> is mounted once in
 * src/app/layout.tsx. Policy: toast for success-after-close and
 * unexpected/network errors; inline role="alert" (via <Field>) for field-level
 * validation that must persist next to the control.
 */
export { toast } from 'sonner';
