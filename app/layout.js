import '../styles/globals.css';
import { Outfit } from 'next/font/google';

const outfit = Outfit({
  subsets: ['latin'],
  weight: ['300','400','500','600','700','800','900'],
  variable: '--font-outfit',
  display: 'swap',
});

export const metadata = {
  title: 'YoY IA BILLAR By Alfonso Iturbide — Sistema de Gestión',
  description: 'La plataforma más avanzada del mundo para la gestión y administración de salones de billar con Inteligencia Artificial.',
  manifest: '/manifest.json',
  icons: { icon: '/icon.png' },
  openGraph: {
    title: 'YoY IA BILLAR By Alfonso Iturbide — Sistema de Gestión Inteligente',
    description: 'La plataforma más avanzada del mundo para la gestión y administración de salones de billar con Inteligencia Artificial.',
    url: 'https://yoy-ia-billar.vercel.app',
    siteName: 'YoY IA Billar By Alfonso Iturbide',
    images: [
      {
        url: 'https://yoy-ia-billar.vercel.app/logo-largo.png',
        width: 800,
        height: 250,
        alt: 'YoY IA Billar By Alfonso Iturbide Logo',
      },
    ],
    locale: 'es_MX',
    type: 'website',
  },
};

export default function RootLayout({ children }) {
  return (
    <html lang="es" className={outfit.variable}>
      <head>
        <meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1" />
        <meta name="theme-color" content="#121212" />
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
        <link rel="preload" href="/logo-largo.png" as="image" type="image/png" fetchPriority="high" />
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/remixicon@4.2.0/fonts/remixicon.css" />
        <link rel="apple-touch-icon" href="/logo-corto.png" />
      </head>
      <body>{children}</body>
    </html>
  );
}
