import { redirect } from 'next/navigation';

export default function DeprecatedAdminMessagesPage() {
  redirect('/admin/dashboard');
}
