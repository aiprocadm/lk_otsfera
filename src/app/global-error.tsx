'use client';
import { useEffect } from 'react';
import { clientLog } from '@/lib/logging/client';

// Ловит падение самого root layout — рендерит собственные <html>/<body>.
// Инлайн-стили вместо Tailwind: когда root layout упал, globals.css может
// не быть в документе, поэтому классам здесь доверять нельзя.
export default function GlobalError({
  error,
  reset
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    clientLog.error(error);
  }, [error]);

  return (
    <html lang='ru'>
      <body
        style={{
          margin: 0,
          minHeight: '100vh',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: '#F9FAFB',
          fontFamily:
            "system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif",
          padding: 24
        }}
      >
        <div style={{ textAlign: 'center', maxWidth: 420 }}>
          <div
            style={{
              width: 64,
              height: 64,
              background: '#F97316',
              borderRadius: 16,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              margin: '0 auto 24px'
            }}
          >
            <span style={{ color: '#FFFFFF', fontSize: 24, fontWeight: 700 }}>!</span>
          </div>
          <h1 style={{ fontSize: 24, fontWeight: 700, color: '#111111', margin: '0 0 8px' }}>
            Что-то пошло не так
          </h1>
          <p style={{ color: '#6B7280', margin: '0 0 24px' }}>
            Произошла непредвиденная ошибка. Попробуйте ещё раз.
          </p>
          <button
            onClick={reset}
            style={{
              background: '#F97316',
              color: '#FFFFFF',
              fontWeight: 600,
              padding: '10px 24px',
              borderRadius: 8,
              fontSize: 14,
              border: 'none',
              cursor: 'pointer'
            }}
          >
            Попробовать снова
          </button>
          {error.digest ? (
            <p style={{ color: '#9CA3AF', fontSize: 12, marginTop: 24 }}>
              Код ошибки: {error.digest}
            </p>
          ) : null}
        </div>
      </body>
    </html>
  );
}
