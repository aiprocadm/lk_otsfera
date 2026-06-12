'use client';

import React, { useState } from 'react';
import { useRouter } from 'next/navigation';

/**
 * Единая кнопка выхода. Раньше шеллы отправляли <form> прямо на
 * /api/auth/logout — браузер приземлялся на голый JSON {"ok":true}.
 * Здесь: POST по fetch -> явный уход на /login.
 */
export function LogoutButton({ className }: { className?: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function onClick() {
    setBusy(true);
    try {
      await fetch('/api/auth/logout', { method: 'POST' });
    } catch {
      // даже при сетевой ошибке уходим на /login — middleware разберётся
    }
    router.push('/login');
    router.refresh();
  }

  return (
    <button
      type='button'
      onClick={onClick}
      disabled={busy}
      className={className ?? 'text-sm text-gray-600 hover:text-[#F97316] transition-colors disabled:opacity-60'}
    >
      {busy ? 'Выходим…' : 'Выйти'}
    </button>
  );
}
