import Link from 'next/link';
import { AppShell } from '@/components/dashboard/app-shell';

export default function StudentPage() {
  return <AppShell><h1 className='text-2xl font-semibold mb-3'>Кабинет слушателя</h1><p className='mb-4'>На MVP используется безопасный переход во внешний LMS.</p><Link href='/student/redirect' className='inline-block rounded bg-black text-white px-4 py-2'>Перейти в кабинет слушателя</Link></AppShell>;
}
