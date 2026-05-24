import { redirect } from 'next/navigation';

export default function DeprecatedAdminOrdersPage() {
  redirect('/admin/dashboard');
}
