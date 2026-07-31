import type { Metadata, Viewport } from 'next';
import './globals.css';
import { Toaster } from 'sonner';
import { PwaInstaller } from '@/components/pwa-installer';
import { isFeatureEnabled } from '@/lib/featureFlags';

export const metadata: Metadata = {
  title: 'Промтехносфера — личный кабинет',
  description: 'Личный кабинет партнёра Промтехносферы',
  manifest: '/manifest.webmanifest',
  icons: {
    icon: [
      { url: '/icon-192.png', sizes: '192x192', type: 'image/png' },
      { url: '/icon-512.png', sizes: '512x512', type: 'image/png' },
    ],
    apple: [{ url: '/apple-touch-icon.png', sizes: '180x180', type: 'image/png' }],
  },
  appleWebApp: {
    capable: true,
    title: 'Промтехносфера',
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
    <html lang="ru">
      <body>
        {children}
        <Toaster richColors position="top-right" />
        {isFeatureEnabled('pwa_installer') && <PwaInstaller />}
      </body>
    </html>
  );
}
