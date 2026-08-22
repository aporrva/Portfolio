import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Apoorva Rawat — Ride the Portfolio',
  description: 'A cinematic developer portfolio by Apoorva Rawat.',
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body>{children}</body></html>;
}
