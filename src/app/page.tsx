import { redirect } from 'next/navigation';

// Боевой редирект корня живёт в middleware (`/` и `/dashboard` -> roleHome[role],
// см. src/middleware.ts). Эта страница — страховка на случай изменения matcher:
// не угадываем роль, просто отправляем на вход.
export default function Home() {
  redirect('/login');
}
