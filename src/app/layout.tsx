import type { Metadata, Viewport } from 'next';
import './globals.css';
import { Toaster } from 'sonner';

export const metadata: Metadata = {
  title: 'Промтехносфера — личный кабинет',
  description: 'Личный кабинет партнёра Промтехносферы',
  manifest: '/manifest.webmanifest',
  appleWebApp: {
    capable: true,
    title: 'ОТСФЕРА',
    statusBarStyle: 'default',
  },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
  themeColor: '#F97316',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang='ru'>
      <body>
        {children}
        <Toaster richColors position='top-right' />
      </body>
    </html>
  );
}
