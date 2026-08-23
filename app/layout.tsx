import type { Metadata, Viewport } from 'next';
import './globals.css';

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  viewportFit: 'cover',
  themeColor: '#071016',
};

export const metadata: Metadata = {
  metadataBase: new URL('https://apoorva-ride-portfolio.teachesraj.chatgpt.site'),
  title: 'Apoorva Rawat — Ride the Portfolio',
  description: 'Full-stack developer portfolio featuring React, React Native, Node.js, and independently delivered projects including Prithu.earth.',
  openGraph: {
    title: 'Apoorva Rawat — Ride the Portfolio',
    description: 'Full-stack developer portfolio featuring React, React Native, Node.js, and independently delivered projects including Prithu.earth.',
    type: 'website',
    images: [{ url: '/og.png', width: 1200, height: 630, alt: 'Apoorva Rawat — Ride the Portfolio' }],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Apoorva Rawat — Ride the Portfolio',
    description: 'Full-stack developer portfolio featuring React, React Native, Node.js, and independently delivered projects including Prithu.earth.',
    images: ['/og.png'],
  },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body>{children}</body></html>;
}
