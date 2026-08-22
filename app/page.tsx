'use client';

import { useEffect, useRef, useState } from 'react';

type Stage = 'gate' | 'countdown' | 'ride' | 'impact' | 'info';

type Stop = {
  id: 'resume' | 'skills' | 'projects' | 'experience' | 'achievements' | 'contact' | 'about';
  title: string;
  number: string;
  distance: string;
  kicker: string;
  headline: string;
  body: string;
};

const stops: Stop[] = [
  { id: 'resume', title: 'RESUME', number: '01', distance: '60M', kicker: 'PROFILE UNLOCKED', headline: 'BUILDING USEFUL DIGITAL THINGS.', body: 'Full-stack developer blending thoughtful interfaces with dependable systems. I turn ambitious ideas into clear, usable products.' },
  { id: 'skills', title: 'SKILLS', number: '02', distance: '120M', kicker: 'SYSTEMS ONLINE', headline: 'TOOLS FOR THE WHOLE ROAD.', body: 'A practical stack for shaping polished experiences from the first pixel to the production release.' },
  { id: 'projects', title: 'PROJECTS', number: '03', distance: '180M', kicker: 'PROJECT DATABASE', headline: 'SELECTED BUILDS. REAL MOMENTUM.', body: 'Each project is a focused response to a real need — designed to be clear, useful, and memorable.' },
  { id: 'experience', title: 'EXPERIENCE', number: '04', distance: '240M', kicker: 'CAREER MILESTONES', headline: 'CURIOUS BY DEFAULT. RELIABLE BY CHOICE.', body: 'A path built around solving problems, collaborating generously, and making the work feel effortless to use.' },
  { id: 'achievements', title: 'ACHIEVEMENTS', number: '05', distance: '310M', kicker: 'MILESTONES LOGGED', headline: 'KEEPING THE CURIOSITY IN MOTION.', body: 'Learning never stays parked — every new challenge becomes another way to build with more confidence.' },
  { id: 'contact', title: 'CONTACT', number: '06', distance: '420M', kicker: 'FINAL DESTINATION', headline: 'WANT TO BUILD SOMETHING TOGETHER?', body: 'The road ends at the overlook. The next great idea can start right here.' },
  { id: 'about', title: 'ABOUT ME', number: '07', distance: '520M', kicker: 'RIDER PROFILE', headline: 'THE DEVELOPER BEHIND THE RIDE.', body: 'I am Apoorva — a thoughtful maker who enjoys turning complicated moments into friendly digital experiences.' },
];

function SectionDetails({ stop }: { stop: Stop }) {
  if (stop.id === 'skills') {
    return <div className="skill-grid">{['React', 'Next.js', 'TypeScript', 'Node.js', 'Python', 'SQL', 'Figma', 'Git'].map((skill, index) => <span key={skill} style={{ '--delay': `${index * 55}ms` } as React.CSSProperties}>{skill}</span>)}</div>;
  }
  if (stop.id === 'projects') {
    return <div className="project-strip">
      <article className="project-card project-one"><span>01</span><h3>PRODUCT SYSTEM</h3><p>Dashboard design · Frontend</p><button type="button">VIEW CASE STUDY ↗</button></article>
      <article className="project-card project-two"><span>02</span><h3>SMART WORKFLOW</h3><p>Automation · Full stack</p><button type="button">VIEW CASE STUDY ↗</button></article>
      <article className="project-card project-three"><span>03</span><h3>CARE PLATFORM</h3><p>UX strategy · React</p><button type="button">VIEW CASE STUDY ↗</button></article>
    </div>;
  }
  if (stop.id === 'achievements') {
    return <div className="achievement-grid"><article><b>01</b><span>CONTINUOUS<br />LEARNING</span></article><article><b>02</b><span>PRODUCT<br />THINKING</span></article><article><b>03</b><span>FULL-STACK<br />CRAFT</span></article></div>;
  }
  if (stop.id === 'about') {
    return <div className="about-stats"><article><strong>∞</strong><span>Curiosity for<br />better systems</span></article><article><strong>01</strong><span>Purposeful<br />approach</span></article><article><strong>100%</strong><span>Care for the<br />details</span></article></div>;
  }
  if (stop.id === 'contact') {
    return <div className="contact-links"><a href="mailto:hello@apoorvarawat.dev">EMAIL ME <i>↗</i></a><a href="https://www.linkedin.com" target="_blank" rel="noreferrer">LINKEDIN <i>↗</i></a><a href="https://github.com" target="_blank" rel="noreferrer">GITHUB <i>↗</i></a></div>;
  }
  return <div className="timeline">
    <article><p>2025 — PRESENT</p><h3>FULL-STACK DEVELOPER</h3><span>Product thinking · Web systems · AI workflows</span></article>
    <article><p>2023 — 2025</p><h3>DEVELOPER &amp; DESIGNER</h3><span>Responsive builds · UX craft · Collaboration</span></article>
  </div>;
}

export default function Home() {
  const [stage, setStage] = useState<Stage>('gate');
  const [count, setCount] = useState(10);
  const [activeIndex, setActiveIndex] = useState(0);
  const [slowSeconds, setSlowSeconds] = useState(9);
  const [menuOpen, setMenuOpen] = useState(false);
  const audioContext = useRef<AudioContext | null>(null);
  const stop = stops[activeIndex];

  function tone(frequency: number, duration = 0.08, type: OscillatorType = 'sine', volume = 0.035) {
    if (typeof window === 'undefined') return;
    const AudioContextClass = window.AudioContext || (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioContextClass) return;
    const context = audioContext.current ?? new AudioContextClass();
    audioContext.current = context;
    if (context.state === 'suspended') void context.resume();
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    oscillator.type = type;
    oscillator.frequency.setValueAtTime(frequency, context.currentTime);
    gain.gain.setValueAtTime(volume, context.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, context.currentTime + duration);
    oscillator.connect(gain).connect(context.destination);
    oscillator.start();
    oscillator.stop(context.currentTime + duration);
  }

  function beginRide() {
    tone(160, 0.12, 'square', 0.02);
    setCount(10);
    setStage('countdown');
  }

  function lockTarget() {
    if (stage !== 'ride') return;
    tone(80, 0.22, 'sawtooth', 0.07);
    setStage('impact');
    window.setTimeout(() => { setSlowSeconds(9); setStage('info'); }, 620);
  }

  function chooseStop(index: number) {
    tone(260, 0.07, 'sine', 0.025);
    setActiveIndex(index);
    setSlowSeconds(9);
    setMenuOpen(false);
    setStage('info');
  }

  function continueRide() {
    tone(82, 0.32, 'sawtooth', 0.045);
    setStage('ride');
    setActiveIndex((index) => (index + 1) % stops.length);
  }

  function restartRide() {
    setActiveIndex(0);
    setStage('ride');
  }

  useEffect(() => {
    if (stage !== 'countdown') return;
    if (count === 0) {
      tone(68, 0.55, 'sawtooth', 0.055);
      const launch = window.setTimeout(() => setStage('ride'), 360);
      return () => window.clearTimeout(launch);
    }
    tone(220 + (10 - count) * 15, 0.045, 'square', 0.018);
    const timer = window.setTimeout(() => setCount((value) => value - 1), 150);
    return () => window.clearTimeout(timer);
  }, [count, stage]);

  useEffect(() => {
    if (stage !== 'info' || stop.id === 'contact') return;
    if (slowSeconds === 0) {
      continueRide();
      return;
    }
    const timer = window.setTimeout(() => setSlowSeconds((seconds) => seconds - 1), 1000);
    return () => window.clearTimeout(timer);
  }, [slowSeconds, stage, stop.id]);

  useEffect(() => {
    const shoot = (event: KeyboardEvent) => {
      if (event.code === 'Space' && !menuOpen) {
        event.preventDefault();
        lockTarget();
      }
      if (event.key === 'Escape') setMenuOpen(false);
    };
    window.addEventListener('keydown', shoot);
    return () => window.removeEventListener('keydown', shoot);
  }, [stage, menuOpen]);

  return (
    <main className={`experience stage-${stage} stop-${stop.id}`}>
      <div className="grain" />
      <section className="sky" aria-hidden="true">
        <div className="sun" />
        <div className="cloud cloud-one" /><div className="cloud cloud-two" /><div className="cloud cloud-three" />
        <div className="ridge ridge-far" /><div className="ridge ridge-near" />
        <div className="pine-line pine-far" /><div className="pine-line pine-near" />
        <div className="road"><span className="road-edge edge-left" /><span className="road-edge edge-right" /><span className="road-mark mark-one" /><span className="road-mark mark-two" /><span className="road-mark mark-three" /></div>
      </section>

      <header className="hud top-hud">
        <button className="brand" type="button" onClick={() => setStage('gate')} aria-label="Return to start"><span className="brand-mark">AR</span><span>APOORVA RAWAT</span></button>
        <button className="menu-button" onClick={() => setMenuOpen((isOpen) => !isOpen)} type="button" aria-expanded={menuOpen}><span>☰</span> PORTFOLIO</button>
      </header>

      <nav className={`nav-drawer ${menuOpen ? 'is-open' : ''}`} aria-label="Portfolio sections">
        <div><span className="drawer-label">DIRECT ACCESS</span><button onClick={() => setMenuOpen(false)} type="button" aria-label="Close navigation">×</button></div>
        {stops.map((item, index) => <button className={activeIndex === index ? 'active' : ''} onClick={() => chooseStop(index)} type="button" key={item.id}><i>{item.number}</i>{item.title}<b>↗</b></button>)}
      </nav>

      <div className="speed-readout hud" aria-label="Ride speed"><span>{stage === 'info' ? 'SLOW MODE' : 'CRUISE'}</span><strong>{stage === 'info' ? '020' : '128'}</strong><small>KM/H</small></div>
      <div className="ride-meter hud"><span>ROAD // 07</span><b style={{ width: `${((activeIndex + 1) / stops.length) * 100}%` }} /></div>

      <div className="rider" aria-label="Stylized rider and motorcycle" role="img"><span className="hair" /><span className="helmet" /><span className="torso" /><span className="arm arm-left" /><span className="arm arm-right" /><span className="bike-frame" /><span className="wheel wheel-back" /><span className="wheel wheel-front" /><span className="headlight" /></div>

      <button className="target-sign" type="button" onClick={lockTarget} aria-label={`Shoot ${stop.title} target`}>
        <span className="target-kicker">{stop.kicker}</span><span className="target-title">{stop.title}</span><span className="target-dot">◎</span><span className="target-distance">LOCKED · {stop.distance}</span>
      </button>
      <div className="crosshair" aria-hidden="true"><span /></div>
      <p className="shoot-prompt hud">CLICK TARGET / PRESS SPACE TO SHOOT</p>

      <section className="intro-screen" aria-label="Enter the portfolio experience">
        <div className="intro-inner"><p className="eyebrow">A CINEMATIC PORTFOLIO EXPERIENCE</p><h1>MAKE THE<br /><em>RIDE</em> COUNT.</h1><p className="intro-copy">Apoorva Rawat · Full-stack developer<br />Sound recommended</p><button className="enter-button" onClick={beginRide} type="button"><span>▶</span> ENTER THE JOURNEY</button></div>
      </section>

      <section className="countdown-screen" aria-live="polite"><p>IGNITION SEQUENCE</p><strong>{count === 0 ? '0' : String(count).padStart(2, '0')}</strong><span>{count === 0 ? 'ENGINE START' : 'SYSTEM ONLINE'}</span></section>

      <section className={`content-panel panel-${stop.id}`} aria-live="polite" aria-label={`${stop.title} details`}>
        <div className="panel-topline"><span>{stop.number} / {stop.kicker}</span><span>◌ SLOW MODE</span></div>
        <div className="panel-body"><div className="panel-intro"><p className="eyebrow">APOORVA RAWAT</p><h2>{stop.headline.split(' ').slice(0, Math.ceil(stop.headline.split(' ').length / 2)).join(' ')}<br /><em>{stop.headline.split(' ').slice(Math.ceil(stop.headline.split(' ').length / 2)).join(' ')}</em></h2><p className="panel-copy">{stop.body}</p></div><SectionDetails stop={stop} /></div>
        <div className="panel-footer"><span>{stop.id === 'contact' ? 'THE OVERLOOK IS OPEN' : 'RIDE CONTINUES SOON'}</span>{stop.id === 'contact' ? <button onClick={restartRide} type="button">↻ RESTART RIDE</button> : <><span>{slowSeconds} SEC</span><button onClick={continueRide} type="button">CONTINUE ↗</button></>}</div>
      </section>
    </main>
  );
}
