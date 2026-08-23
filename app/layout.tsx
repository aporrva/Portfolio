import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  metadataBase: new URL('https://apoorva-ride-portfolio.teachesraj.chatgpt.site'),
  title: 'Apoorva Rawat — Ride the Portfolio',
  description: 'A cinematic, interactive developer portfolio set on a mountain road.',
  openGraph: {
    title: 'Apoorva Rawat — Ride the Portfolio',
    description: 'A cinematic, interactive developer portfolio set on a mountain road.',
    type: 'website',
    images: [{ url: '/og.png', width: 1200, height: 630, alt: 'Apoorva Rawat — Ride the Portfolio' }],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Apoorva Rawat — Ride the Portfolio',
    description: 'A cinematic, interactive developer portfolio set on a mountain road.',
    images: ['/og.png'],
  },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body>{children}</body></html>;
}
