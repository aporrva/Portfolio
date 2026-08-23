'use client';

import dynamic from 'next/dynamic';

const CinematicRide = dynamic(() => import('./components/CinematicRide'), {
  ssr: false,
  loading: () => <main className="ride-loader"><span>AR</span><p>PREPARING THE MOUNTAIN DRIVE</p><i /></main>,
});

export default function Home() {
  return <CinematicRide />;
}
