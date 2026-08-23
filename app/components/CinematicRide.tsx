'use client';

import { AnimatePresence, motion } from 'framer-motion';
import gsap from 'gsap';
import {
  Suspense,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import { Canvas, ThreeEvent, useFrame, useThree } from '@react-three/fiber';
import { AdaptiveDpr, PerformanceMonitor, Sky, Sparkles, useGLTF } from '@react-three/drei';
import { Bloom, EffectComposer, SMAA, Vignette } from '@react-three/postprocessing';
import * as THREE from 'three';

type RideState = 'intro' | 'countdown' | 'riding' | 'target' | 'aiming' | 'shot' | 'reading' | 'summit' | 'finale';
type SectionId = 'skills' | 'about' | 'experience' | 'projects' | 'resume' | 'contact';

type PortfolioGroup = {
  label: string;
  lines: string[];
  links?: Array<{ label: string; href: string }>;
};

type PortfolioStop = {
  id: SectionId;
  label: string;
  number: string;
  distance: number;
  progress: number;
  side: -1 | 1;
  signSubtitle: string;
  eyebrow: string;
  heading: [string, string];
  groups: PortfolioGroup[];
  note: string;
};

type RideController = {
  begin: () => void;
  shoot: (confirmed?: boolean) => void;
  continueRide: () => void;
  bypassTarget: () => void;
  restartCheckpoint: () => void;
  openSection: (index: number) => void;
  openFinale: () => void;
  reportApproach: (stageIndex: number, value: number, distance: number) => void;
  reportVehicleSpeed: (value: number) => void;
  reachFinale: () => void;
  setAimLocked: (value: boolean) => void;
  setTargetVulnerable: (value: boolean) => void;
  mute: boolean;
  audioReady: boolean;
  setMute: (value: boolean) => void;
  mode: RideState;
  countdown: number;
  speed: number;
  vehicleSpeed: number;
  targetProgress: number;
  targetDistance: number;
  aimLocked: boolean;
  targetVulnerable: boolean;
  misses: number;
  missPulse: number;
  missMessage: string;
  rideReset: number;
  checkpointReset: number;
  activeIndex: number;
  completedStops: number[];
  completedCount: number;
  stopDistances: number[];
  activeStop: PortfolioStop | null;
  panelStop: PortfolioStop | null;
  previewing: boolean;
  previewReturnMode: RideState;
};

type DriveRuntime = {
  progress: number;
  velocity: number;
  acceleration: number;
  lane: number;
  steer: number;
  wheelAngle: number;
  pointerX: number;
  pointerY: number;
  touchSteer: number;
  touchThrottle: boolean;
  touchBrake: boolean;
  mouseThrottle: boolean;
  gestureThrottle: number;
  forward: boolean;
  brake: boolean;
  left: boolean;
  right: boolean;
  targetHit: boolean;
  resetApplied: number;
  stageApplied: number;
  checkpointResetApplied: number;
  summitReported: boolean;
  telemetryElapsed: number;
  lastPosition: THREE.Vector3;
  hasLastPosition: boolean;
};

type DriveRef = { current: DriveRuntime };

const MAX_LANE_OFFSET = 1.75;
const ROUTE_TOP_SPEED = 13.8;
const CRUISE_SPEED = 0.24;
const AIM_CRAWL_SPEED = 0.20;
const TARGET_LOCK_DISTANCE = 12.0;
const RIDE_START_DISTANCE = 25;
const SUMMIT_DISTANCE = 880;
const SUN_POSITION: [number, number, number] = [-24, 75, 920];
const MUSIC_STEP_SECONDS = 0.56;
const MUSIC_SCHEDULER_MS = 50;
const MUSIC_LOOKAHEAD_SECONDS = 0.14;
const MUSIC_MELODY = [
  220, 261.63, 329.63, 261.63,
  174.61, 220, 261.63, 220,
  196, 246.94, 293.66, 246.94,
  164.81, 207.65, 246.94, 207.65,
];
const MUSIC_ROOTS = [110, 87.31, 98, 82.41];

const roadCurve = new THREE.CatmullRomCurve3([
  new THREE.Vector3(-6, 0, -100),
  new THREE.Vector3(0, 1, -70),
  new THREE.Vector3(8, 3, -20),
  new THREE.Vector3(-7, 6, 35),
  new THREE.Vector3(9, 10, 95),
  new THREE.Vector3(-8, 14, 155),
  new THREE.Vector3(8, 19, 220),
  new THREE.Vector3(-7, 24, 285),
  new THREE.Vector3(7, 29, 350),
  new THREE.Vector3(-6, 34, 420),
  new THREE.Vector3(6, 38, 490),
  new THREE.Vector3(-5, 42, 560),
  new THREE.Vector3(5, 46, 630),
  new THREE.Vector3(-4, 50, 700),
  new THREE.Vector3(4, 54, 770),
  new THREE.Vector3(-3, 58, 840),
  new THREE.Vector3(0, 62, 900),
  new THREE.Vector3(0, 62, 950),
]);
roadCurve.curveType = 'centripetal';
const ROAD_LENGTH = roadCurve.getLength();
const RIDE_START_PROGRESS = RIDE_START_DISTANCE / ROAD_LENGTH;
const SUMMIT_PROGRESS = SUMMIT_DISTANCE / ROAD_LENGTH;
const ROAD_END_PROGRESS = Math.min(1, SUMMIT_PROGRESS + 5 / ROAD_LENGTH);

const stop = (
  id: SectionId,
  label: string,
  number: string,
  distance: number,
  side: 1 | -1,
  signSubtitle: string,
  eyebrow: string,
  heading: [string, string],
  groups: PortfolioGroup[],
  note: string,
): PortfolioStop => ({
  id,
  label,
  number,
  distance,
  progress: distance / ROAD_LENGTH,
  side,
  signSubtitle,
  eyebrow,
  heading,
  groups,
  note,
});

function getEffectiveStop(index: number, distances?: number[]): PortfolioStop | null {
  const base = PORTFOLIO_STOPS[index];
  if (!base) return null;
  const dist = distances && distances[index] !== undefined ? distances[index] : base.distance;
  return {
    ...base,
    distance: dist,
    progress: dist / ROAD_LENGTH,
  };
}

const PORTFOLIO_STOPS: PortfolioStop[] = [stop(
  'about',
  'ABOUT',
  '01',
  90,
  -1,
  'MEET THE RIDER',
  'ABOUT MYSELF',
  ['APOORVA RAWAT', ""],
  [
    { label: 'PROFILE', lines: ['Full-stack Software Engineer', 'App Developer', 'Web Developer'] },
    { label: 'PERSONAL DETAILS', lines: ['21 Years', 'Female'] },
    { label: 'SPECIALISM', lines: ['React', 'React Native', 'Express.js'] },
  ],
  'I build production-ready web experiences and bring the communication, problem-solving, and mentorship skills of a former teacher.'
),

stop(
  'skills',
  'SKILLS',
  '02',
  180,
  1,
  'THROUGH THE JOURNEY',
  'SKILLS UNLOCKED',
  ['THE TOOLKIT', 'BEHIND THE RIDE.'],
  [
    { label: 'FRONTEND', lines: ['HTML', 'CSS', 'JavaScript', 'React', 'TypeScript', 'Tailwind CSS', 'React Native', 'Next.js'] },
    { label: 'BACKEND', lines: ['Node.js & Express', 'REST APIs', 'EmailJS', 'MySQL', 'Django'] },
    { label: 'TOOLS', lines: ['Git', 'GitHub', 'Figma', 'Netlify'] },
  ],
  'A practical full-stack toolkit for responsive interfaces, API-integrated products, and maintainable component systems.'
),

stop(
  'experience',
  'EXPERIENCE',
  '03',
  270,
  -1,
  'TRACE THE JOURNEY',
  'EXPERIENCE UNLOCKED',
  ['BUILT THROUGH', 'REAL EXPERIENCE.'],
  [
    {
      label: 'PRITHU / CURRENT',
      lines: ['Currently working with Prithu'],
      links: [{ label: 'VISIT PRITHU.EARTH', href: 'https://prithu.earth/' }],
    },
    {
      label: 'FREELANCE / SEP 2025 - OCT 2025',
      lines: ['Worked in Ethereal Designs'],
      links: [{ label: 'VISIT ETHEREALDESIGN.IO', href: 'https://etherealdesign.io/' }],
    },
    {
      label: '2023-2025',
      lines: ['Chemistry Teacher', 'Lessons, experiments & mentoring'],
    },
  ],
  'Currently contributing at Prithu while continuing freelance web development, following two years of teaching at Vidyatri Public School, Kotdwar.'
),

stop(
  'projects',
  'PROJECTS',
  '04',
  360,
  1,
  'OPEN THE GARAGE',
  'PROJECT DATABASE',
  ['SELECTED WORK.', 'BUILT TO LAST.'],
  [
    {
      label: 'PRITHU.EARTH',
      lines: ['Climate-tech company website', 'Sole end-to-end website build'],
      links: [{ label: 'LIVE SITE', href: 'https://prithu.earth/' }],
    },
    {
      label: 'ETHREAL DESIGN',
      lines: ['Designing Company', 'React / TypeScript / Next.js'],
      links: [
        { label: 'LIVE SITE', href: 'https://etherealdesign.io/' },
      ],
    },
    {
      label: 'MANI ARTISAN JEWELLERY',
      lines: ['Full-featured online shop', 'Next.js / Tailwind / React'],
      links: [
        { label: 'LIVE SITE', href: 'https://mani-artisan-jewellery.netlify.app/' },
        { label: 'GITHUB', href: 'https://github.com/aporrva/Mani-Artisan-Jewellery' },
      ],
    },
    {
      label: 'FORM FILLING WEBSITE',
      lines: ['Secure, user-friendly forms', 'React / Express / Tailwind'],
      links: [
        { label: 'LIVE SITE', href: 'https://form-filling-website.netlify.app/' },
        { label: 'GITHUB', href: 'https://github.com/aporrva/Form-Filling-Website' },
      ],
    },
  ],
  'Selected work from my experience, led by Prithu.earth — independently delivered as a complete website project.'
),

stop(
  'resume',
  'RESUME',
  '05',
  450,
  -1,
  'VIEW THE RECORD',
  'RESUME UNLOCKED',
  ['THE ROUTE.', 'AT A GLANCE.'],
  [
    { label: 'FRONTEND', lines: ['React / React Native', 'Next.js / TypeScript', 'Responsive UI systems'] },
    { label: 'BACKEND', lines: ['Node.js / Express', 'REST APIs / EmailJS', 'MySQL'] },
    { label: 'EDUCATION', lines: ['B.Sc. Mathematics (PCM)'] },
    { label: 'ACHIEVEMENTS', lines: ['District-Level High Jumper', "University's Top Long and High Jumper", 'District-Level Basketball Player'] },
  ],
  'Full-stack engineering, component architecture, API handling, clean state management, responsive layouts, and interactive UX.'
),

stop(
  'contact',
  'CONTACT',
  '06',
  540,
  1,
  'START A CONVERSATION',
  'FINAL CHECKPOINT',
  ["LET'S BUILD", "WHAT'S NEXT."],
  [
    {
      label: 'EMAIL',
      lines: ['apoorvarawat87@gmail.com'],
      links: [{ label: 'SEND EMAIL', href: 'mailto:apoorvarawat87@gmail.com' }],
    },
    {
      label: 'GITHUB',
      lines: ['github.com/aporrva'],
      links: [{ label: 'VIEW PROFILE', href: 'https://github.com/aporrva' }],
    },
    {
      label: 'PORTFOLIO',
      lines: ['apoorva-rawat.in'],
    },
    { label: 'BASED IN', lines: ['Kotdwara, Uttarakhand', 'India'] },
  ],
  'Open to thoughtful freelance and full-stack opportunities where strong engineering and clear communication both matter.'
),
];
function createDriveRuntime(): DriveRuntime {
  return {
    progress: RIDE_START_PROGRESS,
    velocity: 0,
    acceleration: 0,
    lane: 0,
    steer: 0,
    wheelAngle: 0,
    pointerX: 0,
    pointerY: 0,
    touchSteer: 0,
    touchThrottle: false,
    touchBrake: false,
    mouseThrottle: false,
    gestureThrottle: 0,
    forward: false,
    brake: false,
    left: false,
    right: false,
    targetHit: false,
    resetApplied: -1,
    stageApplied: -1,
    checkpointResetApplied: -1,
    summitReported: false,
    telemetryElapsed: 0,
    lastPosition: new THREE.Vector3(),
    hasLastPosition: false,
  };
}

function createRoadGeometry(width: number, elevation: number, start = 0, end = 1, widenAtSummit = false, depthSkirt = 0.85) {
  const segments = Math.max(48, Math.ceil((end - start) * ROAD_LENGTH * 0.9));
  const positions: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];

  for (let index = 0; index <= segments; index += 1) {
    const fraction = index / segments;
    const progress = THREE.MathUtils.lerp(start, end, fraction);
    const point = roadCurve.getPointAt(progress);
    const tangent = roadCurve.getTangentAt(progress).normalize();
    const side = new THREE.Vector3(-tangent.z, 0, tangent.x).normalize();
    const summitWiden = widenAtSummit ? THREE.MathUtils.smoothstep(progress, 0.885, SUMMIT_PROGRESS) : 0;
    const localWidth = THREE.MathUtils.lerp(width, Math.max(width, 10), summitWiden);

    // 4 points per cross section for solid 3D geometry: Left bottom skirt, Left road deck, Right road deck, Right bottom skirt
    const pLeftSkirt = point.clone().addScaledVector(side, localWidth / 2 + 0.35);
    pLeftSkirt.y += elevation - depthSkirt;
    const pLeftTop = point.clone().addScaledVector(side, localWidth / 2);
    pLeftTop.y += elevation;
    const pRightTop = point.clone().addScaledVector(side, -localWidth / 2);
    pRightTop.y += elevation;
    const pRightSkirt = point.clone().addScaledVector(side, -localWidth / 2 - 0.35);
    pRightSkirt.y += elevation - depthSkirt;

    positions.push(
      pLeftSkirt.x, pLeftSkirt.y, pLeftSkirt.z,
      pLeftTop.x, pLeftTop.y, pLeftTop.z,
      pRightTop.x, pRightTop.y, pRightTop.z,
      pRightSkirt.x, pRightSkirt.y, pRightSkirt.z,
    );

    const uvV = fraction * Math.max(18, ROAD_LENGTH / 4.5);
    uvs.push(0, uvV, 0.15, uvV, 0.85, uvV, 1, uvV);
  }

  for (let index = 0; index < segments; index += 1) {
    const base = index * 4;
    const next = (index + 1) * 4;
    // Left side skirt quad
    indices.push(base, next, base + 1, next, next + 1, base + 1);
    // Road top deck surface quad
    indices.push(base + 1, next + 1, base + 2, next + 1, next + 2, base + 2);
    // Right side skirt quad
    indices.push(base + 2, next + 2, base + 3, next + 2, next + 3, base + 3);
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

function makeTerrain(width: number, depth: number, segmentsX: number, segmentsZ: number, amplitude: number, centerZ = 450) {
  const geometry = new THREE.PlaneGeometry(width, depth, segmentsX, segmentsZ);
  geometry.rotateX(-Math.PI / 2);
  geometry.translate(0, 0, centerZ);
  const position = geometry.getAttribute('position') as THREE.BufferAttribute;

  for (let index = 0; index < position.count; index += 1) {
    const x = position.getX(index);
    const z = position.getZ(index);
    const broad = Math.sin(x * 0.022 + z * 0.012) * amplitude * 0.42;
    const ridges = Math.sin(x * 0.065 - z * 0.028) * amplitude * 0.22;
    const detail = Math.sin(x * 0.18 + z * 0.08) * amplitude * 0.05;
    position.setY(index, broad + ridges + detail - 8.5);
  }
  geometry.computeVertexNormals();
  return geometry;
}

function getRoadsidePose(portfolioStop: PortfolioStop) {
  const point = roadCurve.getPointAt(portfolioStop.progress);
  const tangent = roadCurve.getTangentAt(portfolioStop.progress).normalize();
  const side = new THREE.Vector3(-tangent.z, 0, tangent.x).normalize();
  const position = point.clone().addScaledVector(side, portfolioStop.side * 7.5);
  // Elevate billboard higher up so it is completely visible above the rider and motorcycle
  position.y += 4.15;
  // Tilt the target board at an exact 45-degree angle relative to the road, facing oncoming riders
  const angle45Deg = -portfolioStop.side * (Math.PI / 4);
  return {
    position,
    tangent,
    side,
    rotationY: Math.atan2(-tangent.x, -tangent.z) + angle45Deg,
  };
}

function useRideController(): RideController {
  const initialDistance = Math.round(PORTFOLIO_STOPS[0].distance - RIDE_START_DISTANCE);
  const [mode, setMode] = useState<RideState>('intro');
  const [countdown, setCountdown] = useState(3);
  const [speed, setSpeed] = useState(0);
  const [vehicleSpeed, setVehicleSpeed] = useState(0);
  const [targetProgress, setTargetProgress] = useState(0);
  const [targetDistance, setTargetDistance] = useState(initialDistance);
  const [aimLocked, setAimLockedState] = useState(false);
  const [targetVulnerable, setTargetVulnerableState] = useState(false);
  const [misses, setMisses] = useState(0);
  const [missPulse, setMissPulse] = useState(0);
  const [missMessage, setMissMessage] = useState('');
  const [rideReset, setRideReset] = useState(0);
  const [checkpointReset, setCheckpointReset] = useState(0);
  const [mute, setMuteState] = useState(false);
  const [audioReady, setAudioReady] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const [completedStops, setCompletedStops] = useState<number[]>([]);
  const [targetQueue, setTargetQueue] = useState<number[]>([0, 1, 2, 3, 4, 5]);
  const [stopDistances, setStopDistances] = useState<number[]>([90, 180, 270, 360, 450, 540]);
  const [panelIndex, setPanelIndex] = useState<number | null>(null);
  const [previewing, setPreviewing] = useState(false);

  const muteRef = useRef(false);
  const modeRef = useRef<RideState>('intro');
  const activeIndexRef = useRef(0);
  const completedStopsRef = useRef<number[]>([]);
  const targetQueueRef = useRef<number[]>([0, 1, 2, 3, 4, 5]);
  const stopDistancesRef = useRef<number[]>([90, 180, 270, 360, 450, 540]);
  const previewingRef = useRef(false);
  const returnModeRef = useRef<RideState>('riding');
  const returnSpeedRef = useRef(1);
  const aimLockedRef = useRef(false);
  const targetVulnerableRef = useRef(false);
  const targetDistanceRef = useRef(initialDistance);
  const contextRef = useRef<AudioContext | null>(null);
  const resumePromiseRef = useRef<Promise<void> | null>(null);
  const masterRef = useRef<GainNode | null>(null);
  const limiterRef = useRef<DynamicsCompressorNode | null>(null);
  const disposedRef = useRef(false);
  const soundTimeoutsRef = useRef<Set<number>>(new Set());
  const engineRef = useRef<{
    low: OscillatorNode;
    mid: OscillatorNode;
    high: OscillatorNode;
    gain: GainNode;
    filter: BiquadFilterNode;
  } | null>(null);
  const musicRef = useRef<{
    gain: GainNode;
    filter: BiquadFilterNode;
    timer: number;
    step: number;
    nextNoteTime: number;
  } | null>(null);
  const mainTimeline = useRef<gsap.core.Timeline | null>(null);
  const reportedApproach = useRef(0);
  const reportedSpeed = useRef(0);
  const reportedDistance = useRef(initialDistance);
  const lastAttemptAt = useRef(0);

  modeRef.current = mode;
  activeIndexRef.current = activeIndex;
  previewingRef.current = previewing;

  function getAudioContext() {
    if (disposedRef.current || typeof window === 'undefined') return null;
    const AudioContextClass = window.AudioContext || (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioContextClass) return null;
    const existing = contextRef.current;
    if (existing && existing.state !== 'closed') return existing;
    const context = new AudioContextClass();
    context.addEventListener('statechange', () => {
      if (!disposedRef.current && contextRef.current === context) {
        setAudioReady(context.state === 'running');
      }
    });
    contextRef.current = context;
    return context;
  }

  function resumeAudioContext(context: AudioContext) {
    if (context.state === 'running') return Promise.resolve();
    if (context.state === 'closed') return Promise.reject(new Error('Audio context is closed'));
    if (resumePromiseRef.current) return resumePromiseRef.current;
    const promise = context.resume().then(() => undefined);
    resumePromiseRef.current = promise;
    const clearResumePromise = () => {
      if (resumePromiseRef.current === promise) resumePromiseRef.current = null;
    };
    void promise.then(clearResumePromise, clearResumePromise);
    return promise;
  }

  function getMasterOutput(context: AudioContext) {
    if (masterRef.current) return masterRef.current;
    const master = context.createGain();
    const limiter = context.createDynamicsCompressor();
    master.gain.value = muteRef.current ? 0.0001 : 0.85;
    limiter.threshold.value = -16;
    limiter.knee.value = 18;
    limiter.ratio.value = 4;
    limiter.attack.value = 0.006;
    limiter.release.value = 0.24;
    master.connect(limiter).connect(context.destination);
    masterRef.current = master;
    limiterRef.current = limiter;
    return master;
  }

  function updateMaster() {
    const context = contextRef.current;
    const master = masterRef.current;
    if (!context || !master || context.state === 'closed') return;
    master.gain.setTargetAtTime(muteRef.current ? 0.0001 : 0.85, context.currentTime, 0.025);
  }

  function updateEngine(speedValue: number) {
    const engine = engineRef.current;
    const context = contextRef.current;
    if (!engine || !context || context.state === 'closed') return;
    const active = ['countdown', 'riding', 'target', 'aiming', 'shot', 'reading', 'summit'].includes(modeRef.current);
    const now = context.currentTime;
    const level = !muteRef.current && active ? 0.024 + speedValue * 0.042 : 0.0001;
    const fundamental = 62 + speedValue * 88;
    engine.gain.gain.setTargetAtTime(level, now, 0.065);
    engine.low.frequency.setTargetAtTime(fundamental, now, 0.055);
    engine.mid.frequency.setTargetAtTime(fundamental * 2.03, now, 0.05);
    engine.high.frequency.setTargetAtTime(fundamental * 4.08, now, 0.045);
    engine.filter.frequency.setTargetAtTime(1100 + speedValue * 2500, now, 0.07);
  }

  function ensureEngine(context: AudioContext) {
    if (engineRef.current) return;
    const low = context.createOscillator();
    const mid = context.createOscillator();
    const high = context.createOscillator();
    const filter = context.createBiquadFilter();
    const gain = context.createGain();
    const lowMix = context.createGain();
    const midMix = context.createGain();
    const highMix = context.createGain();
    low.type = 'sawtooth';
    mid.type = 'square';
    high.type = 'triangle';
    low.frequency.value = 62;
    mid.frequency.value = 126;
    high.frequency.value = 253;
    filter.type = 'lowpass';
    filter.frequency.value = 1100;
    filter.Q.value = 1.35;
    gain.gain.value = 0.0001;
    lowMix.gain.value = 0.62;
    midMix.gain.value = 0.25;
    highMix.gain.value = 0.13;
    low.connect(lowMix).connect(filter);
    mid.connect(midMix).connect(filter);
    high.connect(highMix).connect(filter);
    filter.connect(gain).connect(getMasterOutput(context));
    low.start();
    mid.start();
    high.start();
    engineRef.current = { low, mid, high, gain, filter };
    updateEngine(reportedSpeed.current);
  }

  function scheduleMusicTone(
    context: AudioContext,
    output: AudioNode,
    frequency: number,
    startAt: number,
    duration: number,
    type: OscillatorType,
    peak: number,
  ) {
    const oscillator = context.createOscillator();
    const envelope = context.createGain();
    oscillator.type = type;
    oscillator.frequency.setValueAtTime(frequency, startAt);
    envelope.gain.setValueAtTime(0.0001, startAt);
    envelope.gain.exponentialRampToValueAtTime(peak, startAt + Math.min(0.09, duration * 0.25));
    envelope.gain.exponentialRampToValueAtTime(0.0001, startAt + duration);
    oscillator.connect(envelope).connect(output);
    oscillator.onended = () => {
      oscillator.disconnect();
      envelope.disconnect();
    };
    oscillator.start(startAt);
    oscillator.stop(startAt + duration + 0.04);
  }

  function scheduleMusicStep(startAt: number) {
    const context = contextRef.current;
    const music = musicRef.current;
    if (!context || !music || context.state !== 'running' || muteRef.current || disposedRef.current) return;
    const step = music.step % MUSIC_MELODY.length;
    const chord = Math.floor(step / 4) % MUSIC_ROOTS.length;
    scheduleMusicTone(context, music.filter, MUSIC_MELODY[step], startAt, 0.52, 'triangle', 0.055);
    if (step % 2 === 0) {
      scheduleMusicTone(context, music.filter, MUSIC_ROOTS[chord], startAt, 1.06, 'sine', 0.052);
    }
    if (step % 4 === 0) {
      scheduleMusicTone(context, music.filter, MUSIC_ROOTS[chord] * 2, startAt, 2.05, 'sine', 0.018);
      scheduleMusicTone(context, music.filter, MUSIC_ROOTS[chord] * 3, startAt, 1.8, 'triangle', 0.012);
    }
    music.step += 1;
  }

  function runMusicScheduler() {
    const context = contextRef.current;
    const music = musicRef.current;
    if (!context || !music || context.state !== 'running' || muteRef.current || disposedRef.current) return;
    if (music.nextNoteTime < context.currentTime + 0.01) {
      music.nextNoteTime = context.currentTime + 0.05;
    }
    while (music.nextNoteTime < context.currentTime + MUSIC_LOOKAHEAD_SECONDS) {
      scheduleMusicStep(music.nextNoteTime);
      music.nextNoteTime += MUSIC_STEP_SECONDS;
    }
  }

  function updateMusic() {
    const context = contextRef.current;
    const music = musicRef.current;
    if (!context || !music || context.state === 'closed') return;
    const now = context.currentTime;
    const levelByMode: Partial<Record<RideState, number>> = {
      countdown: 0.08,
      riding: 0.15,
      target: 0.13,
      aiming: 0.1,
      shot: 0.12,
      reading: 0.09,
      summit: 0.17,
      finale: 0.14,
    };
    const level = muteRef.current ? 0.0001 : levelByMode[modeRef.current] ?? 0.0001;
    music.gain.gain.setTargetAtTime(level, now, 0.28);
    music.filter.frequency.setTargetAtTime(modeRef.current === 'aiming' ? 1250 : 2350, now, 0.35);
  }

  function ensureMusic(context: AudioContext) {
    if (musicRef.current) return;
    const filter = context.createBiquadFilter();
    const gain = context.createGain();
    filter.type = 'lowpass';
    filter.frequency.value = 2350;
    filter.Q.value = 0.72;
    gain.gain.value = 0.0001;
    filter.connect(gain).connect(getMasterOutput(context));
    musicRef.current = {
      gain,
      filter,
      step: 0,
      nextNoteTime: context.currentTime + 0.05,
      timer: window.setInterval(runMusicScheduler, MUSIC_SCHEDULER_MS),
    };
    runMusicScheduler();
    updateMusic();
  }

  function activateAudio() {
    const context = getAudioContext();
    if (!context) return;
    const start = () => {
      if (disposedRef.current || contextRef.current !== context || context.state !== 'running') return;
      ensureEngine(context);
      ensureMusic(context);
      updateMaster();
      updateEngine(reportedSpeed.current);
      updateMusic();
      if (!muteRef.current) runMusicScheduler();
      setAudioReady(true);
    };
    if (context.state === 'running') start();
    else void resumeAudioContext(context).then(start).catch(() => {
      if (!disposedRef.current) setAudioReady(false);
    });
  }

  function transition(next: RideState) {
    modeRef.current = next;
    setMode(next);
    updateEngine(reportedSpeed.current);
    updateMusic();
  }

  function setMute(value: boolean) {
    muteRef.current = value;
    setMuteState(value);
    if (!value) activateAudio();
    updateMaster();
    updateEngine(reportedSpeed.current);
    updateMusic();
  }

  function setAimLocked(value: boolean) {
    if (aimLockedRef.current === value) return;
    aimLockedRef.current = value;
    setAimLockedState(value);
  }

  function setTargetVulnerable(value: boolean) {
    targetVulnerableRef.current = value;
    setTargetVulnerableState(value);
  }

  function sound(freq: number, duration: number, type: OscillatorType = 'sine', volume = 0.035) {
    if (disposedRef.current || muteRef.current || typeof window === 'undefined') return;
    const context = getAudioContext();
    if (!context || context.state === 'closed') return;
    const play = () => {
      if (disposedRef.current || contextRef.current !== context || muteRef.current || context.state !== 'running') return;
      const osc = context.createOscillator();
      const gain = context.createGain();
      const now = context.currentTime;
      osc.type = type;
      osc.frequency.setValueAtTime(freq, now);
      gain.gain.setValueAtTime(volume, now);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);
      osc.connect(gain);
      gain.connect(getMasterOutput(context));
      osc.onended = () => {
        osc.disconnect();
        gain.disconnect();
      };
      osc.start(now);
      osc.stop(now + duration);
    };
    if (context.state === 'running') play();
    else void resumeAudioContext(context).then(play).catch(() => {
      // Audio can be retried from the explicit header control.
    });
  }

  function queueSound(
    delay: number,
    freq: number,
    duration: number,
    type: OscillatorType = 'sine',
    volume = 0.035,
  ) {
    const timer = window.setTimeout(() => {
      soundTimeoutsRef.current.delete(timer);
      if (!disposedRef.current) sound(freq, duration, type, volume);
    }, delay);
    soundTimeoutsRef.current.add(timer);
  }

  function killTimelines() {
    if (mainTimeline.current) {
      mainTimeline.current.kill();
      mainTimeline.current = null;
    }
  }

  function resetChallenge(distance: number) {
    targetDistanceRef.current = distance;
    reportedDistance.current = Math.round(Math.abs(distance));
    reportedApproach.current = 0;
    setTargetDistance(Math.round(Math.abs(distance)));
    setTargetProgress(0);
    setAimLocked(false);
    setTargetVulnerable(false);
    setMisses(0);
    setMissMessage('');
  }

  function reportApproach(stageIndex: number, value: number, distance: number) {
    if (stageIndex !== activeIndexRef.current || stageIndex >= PORTFOLIO_STOPS.length) return;
    const next = THREE.MathUtils.clamp(value, 0, 1);
    const roundedDistance = Math.max(0, Math.round(Math.abs(distance)));
    targetDistanceRef.current = distance;
    if (roundedDistance !== reportedDistance.current) {
      reportedDistance.current = roundedDistance;
      setTargetDistance(roundedDistance);
    }
    if (Math.abs(next - reportedApproach.current) > 0.012) {
      reportedApproach.current = next;
      setTargetProgress(next);
    }

    if (modeRef.current === 'riding' && next > 0.02 && distance > 0.2) {
      transition('target');
      sound(520, 0.12, 'square', 0.026);
    } else if (modeRef.current === 'target' && Math.abs(distance) <= TARGET_LOCK_DISTANCE && distance > 0.2) {
      setAimLocked(false);
      setTargetVulnerable(false);
      transition('aiming');
      sound(760, 0.16, 'sine', 0.035);
    }
  }

  function reportVehicleSpeed(value: number) {
    const next = Math.max(0, value);
    updateEngine(Math.min(next, 1));
    if (Math.abs(next - reportedSpeed.current) > 0.014 || next === 0) {
      reportedSpeed.current = next;
      setVehicleSpeed(next);
    }
  }

  function begin() {
    killTimelines();
    const initialQueue = [0, 1, 2, 3, 4, 5];
    targetQueueRef.current = initialQueue;
    setTargetQueue(initialQueue);
    const initialDistances = [90, 180, 270, 360, 450, 540];
    stopDistancesRef.current = initialDistances;
    setStopDistances(initialDistances);
    completedStopsRef.current = [];
    setCompletedStops([]);
    activeIndexRef.current = 0;
    setActiveIndex(0);
    setPanelIndex(null);
    previewingRef.current = false;
    setPreviewing(false);
    resetChallenge(PORTFOLIO_STOPS[0].distance - RIDE_START_DISTANCE);
    reportedSpeed.current = 0;
    setCountdown(3);
    setVehicleSpeed(0);
    setSpeed(0);
    setRideReset((value) => value + 1);
    transition('countdown');
    activateAudio();
    sound(140, 0.12, 'square', 0.035);

    const timeline = gsap.timeline();
    mainTimeline.current = timeline;
    for (let value = 3; value >= 0; value -= 1) {
      const index = 3 - value;
      timeline.call(() => {
        setCountdown(value);
        sound(value === 0 ? 320 : 180 + index * 40, value === 0 ? 0.45 : 0.08, value === 0 ? 'sawtooth' : 'square', value === 0 ? 0.08 : 0.04);
      }, [], index * 0.7);
    }
    timeline.call(() => {
      transition('riding');
      setSpeed(1);
    }, [], 2.8);
  }

  function registerMiss(message: string) {
    setMissMessage(message);
    const nextMisses = misses + 1;
    setMisses(nextMisses);
    setMissPulse((value) => value + 1);
    sound(92, 0.14, 'square', 0.045);
    if (nextMisses >= 3) {
      bypassTarget();
    }
  }

  function bypassTarget() {
    if (modeRef.current !== 'aiming' && modeRef.current !== 'target') return;
    killTimelines();
    setAimLocked(false);
    setTargetVulnerable(false);
    setMisses(0);

    const currentQueue = targetQueueRef.current;
    if (currentQueue.length === 0) return;
    const bypassedIndex = currentQueue[0];

    // Reschedule the missed card at the end of the route before the summit climb
    const currentDistances = stopDistancesRef.current;
    const maxDist = Math.max(540, ...currentQueue.map((idx) => currentDistances[idx] ?? PORTFOLIO_STOPS[idx].distance));
    const newDistance = Math.min(SUMMIT_DISTANCE - 45, maxDist + 65);

    const nextDistances = [...currentDistances];
    nextDistances[bypassedIndex] = newDistance;
    stopDistancesRef.current = nextDistances;
    setStopDistances(nextDistances);

    // Place missed target at the end of the queue so it reappears as a new forward card before the summit
    const nextQueue = [...currentQueue.slice(1), bypassedIndex];
    targetQueueRef.current = nextQueue;
    setTargetQueue(nextQueue);

    const nextActiveIndex = nextQueue[0];
    setActiveIndex(nextActiveIndex);
    activeIndexRef.current = nextActiveIndex;

    setMissMessage('MISSED CARD RESCHEDULED AHEAD NEAR SUMMIT');
    sound(115, 0.22, 'square', 0.05);

    transition('riding');
    setSpeed(1);
    updateEngine(1);

    const nextStop = getEffectiveStop(nextActiveIndex, nextDistances);
    if (nextStop) {
      const dist = Math.abs(nextStop.distance - currentDistances[bypassedIndex]);
      resetChallenge(dist > 0 ? dist : 60);
    }
  }

  function shoot(confirmed = false) {
    if (modeRef.current !== 'aiming' || targetQueueRef.current.length === 0) return;
    const now = typeof performance !== 'undefined' ? performance.now() : Date.now();
    if (now - lastAttemptAt.current < 350) return;
    lastAttemptAt.current = now;

    if (targetDistanceRef.current <= 0.1) {
      registerMiss('TARGET PASSED - FRONT SHOTS ONLY');
      bypassTarget();
      return;
    }

    const distance = Math.abs(targetDistanceRef.current);
    if (distance > TARGET_LOCK_DISTANCE + 3.0) {
      registerMiss('OUT OF RANGE - HOLD YOUR LINE');
      return;
    }
    if (!targetVulnerableRef.current) {
      registerMiss('SHIELD CLOSED - WAIT FOR GOLD');
      return;
    }
    if (!confirmed && !aimLockedRef.current) {
      registerMiss('MISS - CENTER THE CORE');
      return;
    }

    killTimelines();
    const hitIndex = targetQueueRef.current[0];
    setPanelIndex(hitIndex);
    previewingRef.current = false;
    setPreviewing(false);
    setAimLocked(false);
    setTargetVulnerable(false);
    setMissMessage('DIRECT HIT');
    transition('shot');
    setTargetProgress(1);
    sound(980, 0.08, 'sawtooth', 0.09);
    sound(135, 0.26, 'square', 0.095);
    queueSound(90, 540, 0.18, 'sine', 0.04);
    window.setTimeout(() => {
      transition('reading');
    }, 720);
  }

  function continueRide() {
    if (previewingRef.current) {
      killTimelines();
      previewingRef.current = false;
      setPreviewing(false);
      setPanelIndex(null);
      if (modeRef.current !== returnModeRef.current) transition(returnModeRef.current);
      setSpeed(returnSpeedRef.current);
      if (returnSpeedRef.current === 0) {
        reportedSpeed.current = 0;
        setVehicleSpeed(0);
      }
      return;
    }
    if (modeRef.current !== 'reading' && modeRef.current !== 'shot') return;
    killTimelines();
    const currentQueue = targetQueueRef.current;
    if (currentQueue.length === 0) return;
    const hitIndex = currentQueue[0];

    // Mark as completed
    if (!completedStopsRef.current.includes(hitIndex)) {
      const nextCompleted = [...completedStopsRef.current, hitIndex];
      completedStopsRef.current = nextCompleted;
      setCompletedStops(nextCompleted);
    }

    // Remove from targetQueue
    const nextQueue = currentQueue.slice(1);
    targetQueueRef.current = nextQueue;
    setTargetQueue(nextQueue);
    setPanelIndex(null);

    if (nextQueue.length === 0) {
      // All targets completed! Advance to summit!
      setActiveIndex(PORTFOLIO_STOPS.length);
      activeIndexRef.current = PORTFOLIO_STOPS.length;
      resetChallenge(SUMMIT_DISTANCE - (stopDistancesRef.current[hitIndex] ?? PORTFOLIO_STOPS[hitIndex].distance));
      transition('summit');
      sound(132, 0.4, 'sawtooth', 0.052);
    } else {
      const nextIndex = nextQueue[0];
      setActiveIndex(nextIndex);
      activeIndexRef.current = nextIndex;
      const currentDist = stopDistancesRef.current[hitIndex] ?? PORTFOLIO_STOPS[hitIndex].distance;
      const nextDist = stopDistancesRef.current[nextIndex] ?? PORTFOLIO_STOPS[nextIndex].distance;
      const distance = Math.abs(nextDist - currentDist);
      resetChallenge(distance > 0 ? distance : 60);
      transition('riding');
      sound(105, 0.4, 'sawtooth', 0.052);
    }

    const driver = { value: 0.2 };
    const timeline = gsap.timeline();
    mainTimeline.current = timeline;
    timeline.to(driver, {
      value: 1,
      duration: 0.85,
      ease: 'power2.inOut',
      onUpdate: () => setSpeed(driver.value),
    });
  }

  function restartCheckpoint() {
    // Keep function signature for compatibility, but forward to bypass
    bypassTarget();
  }

  function openSection(index: number) {
    if (index < 0 || index >= PORTFOLIO_STOPS.length) return;
    if (modeRef.current === 'countdown' || modeRef.current === 'shot') return;
    activateAudio();
    if (previewingRef.current && (modeRef.current === 'reading' || modeRef.current === 'finale')) {
      setPanelIndex(index);
      return;
    }
    if (modeRef.current === 'reading') return;
    killTimelines();
    const sourceMode = modeRef.current;
    returnModeRef.current = sourceMode;
    returnSpeedRef.current = sourceMode === 'intro' || sourceMode === 'finale' ? 0 : 1;
    previewingRef.current = true;
    setPreviewing(true);
    setPanelIndex(index);
    setAimLocked(false);
    setTargetVulnerable(false);
    if (sourceMode !== 'finale') transition('reading');
    setSpeed(returnSpeedRef.current === 0 ? 0 : 0.2);
  }

  function openFinale() {
    activateAudio();
    killTimelines();
    previewingRef.current = false;
    setPreviewing(false);
    setPanelIndex(null);
    setActiveIndex(PORTFOLIO_STOPS.length);
    activeIndexRef.current = PORTFOLIO_STOPS.length;
    setSpeed(0);
    reportedSpeed.current = 0;
    setVehicleSpeed(0);
    transition('finale');
    sound(196, 0.8, 'sine', 0.045);
    queueSound(260, 392, 1.1, 'sine', 0.03);
  }

  function reachFinale() {
    if (modeRef.current === 'finale') return;
    killTimelines();
    setSpeed(0);
    reportedSpeed.current = 0;
    setVehicleSpeed(0);
    transition('finale');
    sound(196, 0.8, 'sine', 0.045);
    queueSound(260, 392, 1.1, 'sine', 0.03);
  }

  useEffect(() => {
    muteRef.current = mute;
    updateMaster();
    updateEngine(reportedSpeed.current);
    updateMusic();
  }, [mute]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.code !== 'Space' && event.code !== 'Enter') return;
      if (event.repeat) return;
      const target = event.target as HTMLElement | null;
      if (target?.closest('button, a, input, textarea, select, [contenteditable="true"]')) return;
      event.preventDefault();
      if (modeRef.current === 'intro') begin();
      else if (modeRef.current === 'aiming') shoot(true);
      else if (modeRef.current === 'reading') continueRide();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  useEffect(() => {
    disposedRef.current = false;
    return () => {
      disposedRef.current = true;
      mainTimeline.current?.kill();
      soundTimeoutsRef.current.forEach((timer) => window.clearTimeout(timer));
      soundTimeoutsRef.current.clear();
      const engine = engineRef.current;
      if (engine) {
        [engine.low, engine.mid, engine.high].forEach((oscillator) => {
          try {
            oscillator.stop();
          } catch {
            // A source may already be stopped during Strict Mode or fast refresh.
          }
        });
      }
      engineRef.current = null;
      if (musicRef.current) window.clearInterval(musicRef.current.timer);
      musicRef.current = null;
      masterRef.current = null;
      limiterRef.current = null;
      resumePromiseRef.current = null;
      const context = contextRef.current;
      contextRef.current = null;
      if (context && context.state !== 'closed') void context.close().catch(() => undefined);
    };
  }, []);

  return {
    begin,
    shoot,
    continueRide,
    bypassTarget,
    restartCheckpoint,
    openSection,
    openFinale,
    reportApproach,
    reportVehicleSpeed,
    reachFinale,
    setAimLocked,
    setTargetVulnerable,
    mute,
    audioReady,
    setMute,
    mode,
    countdown,
    speed,
    vehicleSpeed,
    targetProgress,
    targetDistance,
    aimLocked,
    targetVulnerable,
    misses,
    missPulse,
    missMessage,
    rideReset,
    checkpointReset,
    activeIndex,
    completedStops,
    completedCount: completedStops.length,
    stopDistances,
    activeStop: getEffectiveStop(activeIndex, stopDistances),
    panelStop: panelIndex === null ? null : getEffectiveStop(panelIndex, stopDistances),
    previewing,
    previewReturnMode: returnModeRef.current,
  };
}

function createAsphaltTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 512;
  const context = canvas.getContext('2d');
  if (!context) return new THREE.Texture();

  let seed = 1977;
  const random = () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 4294967296;
  };

  context.fillStyle = '#282d30';
  context.fillRect(0, 0, canvas.width, canvas.height);

  for (let index = 0; index < 9200; index += 1) {
    const value = 34 + Math.floor(random() * 48);
    const alpha = 0.08 + random() * 0.2;
    const size = random() > 0.92 ? 2 : 1;
    context.fillStyle = `rgba(${value}, ${value + 2}, ${value + 3}, ${alpha})`;
    context.fillRect(random() * canvas.width, random() * canvas.height, size, size);
  }

  context.lineCap = 'round';
  for (let crack = 0; crack < 28; crack += 1) {
    let x = random() * canvas.width;
    let y = random() * canvas.height;
    context.beginPath();
    context.moveTo(x, y);
    for (let segment = 0; segment < 5; segment += 1) {
      x += (random() - 0.5) * 34;
      y += 9 + random() * 25;
      context.lineTo(x, y);
    }
    context.strokeStyle = `rgba(7, 11, 13, ${0.11 + random() * 0.16})`;
    context.lineWidth = 0.7 + random() * 1.1;
    context.stroke();
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(2.4, 1);
  texture.anisotropy = 8;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  return texture;
}

function createSurfaceCurve(offset: number, elevation: number) {
  const points = Array.from({ length: 220 }, (_, index) => {
    const progress = (index / 219) * ROAD_END_PROGRESS;
    const point = roadCurve.getPointAt(progress);
    const tangent = roadCurve.getTangentAt(progress).normalize();
    const side = new THREE.Vector3(-tangent.z, 0, tangent.x).normalize();
    return point.addScaledVector(side, offset).add(new THREE.Vector3(0, elevation, 0));
  });
  return new THREE.CatmullRomCurve3(points);
}

function RoadGravel({ count }: { count: number }) {
  const gravel = useRef<THREE.InstancedMesh>(null);
  const stones = useMemo(() => Array.from({ length: count }, (_, index) => {
    const progress = 0.008 + (index / count) * Math.max(0, ROAD_END_PROGRESS - 0.012);
    const point = roadCurve.getPointAt(progress);
    const tangent = roadCurve.getTangentAt(progress).normalize();
    const side = new THREE.Vector3(-tangent.z, 0, tangent.x).normalize();
    const direction = index % 2 === 0 ? 1 : -1;
    const offset = 2.78 + ((index * 29) % 73) / 100;
    const scale = 0.035 + ((index * 17) % 11) / 180;
    return {
      position: point.addScaledVector(side, direction * offset).add(new THREE.Vector3(0, 0.16, 0)),
      rotation: [index * 0.71, index * 1.37, index * 0.43] as [number, number, number],
      scale,
    };
  }), [count]);

  useLayoutEffect(() => {
    const object = new THREE.Object3D();
    const color = new THREE.Color();
    stones.forEach((stone, index) => {
      object.position.copy(stone.position);
      object.rotation.set(...stone.rotation);
      object.scale.set(stone.scale * 1.7, stone.scale * 0.6, stone.scale);
      object.updateMatrix();
      gravel.current?.setMatrixAt(index, object.matrix);
      gravel.current?.setColorAt(index, color.set(index % 3 === 0 ? '#8c7960' : index % 3 === 1 ? '#554d43' : '#b29a78'));
    });
    if (gravel.current) {
      gravel.current.instanceMatrix.needsUpdate = true;
      if (gravel.current.instanceColor) gravel.current.instanceColor.needsUpdate = true;
    }
  }, [stones]);

  return <instancedMesh ref={gravel} args={[undefined, undefined, count]} castShadow receiveShadow>
    <dodecahedronGeometry args={[1, 0]} />
    <meshStandardMaterial vertexColors color="#786b59" roughness={1} />
  </instancedMesh>;
}

function Road({ lowQuality }: { lowQuality: boolean }) {
  const road = useMemo(() => createRoadGeometry(5.2, 0.12, 0, ROAD_END_PROGRESS, true), []);
  const shoulder = useMemo(() => createRoadGeometry(7.2, 0.09, 0, ROAD_END_PROGRESS, true), []);
  const asphalt = useMemo(() => createAsphaltTexture(), []);
  const edgeLines = useMemo(() => [-2.52, 2.52].map((offset) => createSurfaceCurve(offset, 0.145)), []);
  const tireTracks = useMemo(() => [-0.72, 0.72].map((offset) => createSurfaceCurve(offset, 0.142)), []);
  const localZ = useMemo(() => new THREE.Vector3(0, 0, 1), []);
  useEffect(() => () => asphalt.dispose(), [asphalt]);
  const lines = useMemo(() => Array.from({ length: Math.floor((ROAD_LENGTH * ROAD_END_PROGRESS) / 7) }, (_, index) => {
    const distance = index * 7 + 4;
    const progress = THREE.MathUtils.clamp(distance / ROAD_LENGTH, 0, 1);
    const point = roadCurve.getPointAt(progress);
    const tangent = roadCurve.getTangentAt(progress).normalize();
    return {
      point,
      quaternion: new THREE.Quaternion().setFromUnitVectors(localZ, tangent),
    };
  }), [localZ]);
  const rails = useMemo(() => ([-1, 1] as const).map((railSide) => {
    const points = Array.from({ length: 170 }, (_, index) => {
      const progress = (index / 169) * ROAD_END_PROGRESS;
      const point = roadCurve.getPointAt(progress);
      const tangent = roadCurve.getTangentAt(progress).normalize();
      const side = new THREE.Vector3(-tangent.z, 0, tangent.x).normalize();
      const summitWiden = THREE.MathUtils.smoothstep(progress, 0.885, SUMMIT_PROGRESS);
      return point.addScaledVector(side, railSide * THREE.MathUtils.lerp(3.8, 5.4, summitWiden)).add(new THREE.Vector3(0, 0.72, 0));
    });
    return new THREE.CatmullRomCurve3(points);
  }), []);
  const posts = useMemo(() => {
    const result: Array<{ position: THREE.Vector3; key: string }> = [];
    for (let distance = 10; distance < ROAD_LENGTH * ROAD_END_PROGRESS - 10; distance += 11) {
      if (PORTFOLIO_STOPS.some((item) => Math.abs(item.distance - distance) < 5)) continue;
      const progress = distance / ROAD_LENGTH;
      const point = roadCurve.getPointAt(progress);
      const tangent = roadCurve.getTangentAt(progress).normalize();
      const side = new THREE.Vector3(-tangent.z, 0, tangent.x).normalize();
      const summitWiden = THREE.MathUtils.smoothstep(progress, 0.885, SUMMIT_PROGRESS);
      for (const railSide of [-1, 1]) {
        const position = point.clone().addScaledVector(side, railSide * THREE.MathUtils.lerp(3.8, 5.4, summitWiden));
        position.y += 0.37;
        result.push({ position, key: distance + '-' + railSide });
      }
    }
    return result;
  }, []);

  return <group>
    <mesh geometry={shoulder} receiveShadow>
      <meshStandardMaterial color="#4b443b" roughness={1} depthWrite={true} depthTest={true} />
    </mesh>
    <mesh geometry={road} receiveShadow>
      <meshStandardMaterial map={asphalt} color="#b9bec0" roughness={0.93} metalness={0.02} depthWrite={true} depthTest={true} />
    </mesh>
    {tireTracks.map((curve, index) => <mesh key={'track-' + index}>
      <tubeGeometry args={[curve, 360, 0.018, 5, false]} />
      <meshBasicMaterial color="#0b1012" transparent opacity={0.26} depthWrite={false} polygonOffset polygonOffsetFactor={-2} />
    </mesh>)}
    {edgeLines.map((curve, index) => <mesh key={'edge-' + index} receiveShadow>
      <tubeGeometry args={[curve, 360, 0.034, 6, false]} />
      <meshStandardMaterial
        color={index === 0 ? '#e9dec3' : '#f1e6cc'}
        emissive="#806531"
        emissiveIntensity={0.08}
        roughness={0.72}
      />
    </mesh>)}
    {lines.map(({ point, quaternion }, index) => <mesh key={index} position={[point.x, point.y + 0.115, point.z]} quaternion={quaternion} receiveShadow>
      <boxGeometry args={[0.16, 0.02, 2.35]} /><meshStandardMaterial color="#e6c888" emissive="#64461e" emissiveIntensity={0.14} roughness={0.6} />
    </mesh>)}
    {rails.map((curve, index) => <mesh key={index} castShadow receiveShadow>
      <tubeGeometry args={[curve, 320, 0.045, 8, false]} />
      <meshStandardMaterial color="#697078" metalness={0.78} roughness={0.31} />
    </mesh>)}
    {posts.map(({ position, key }) => <mesh key={key} position={position} castShadow>
      <cylinderGeometry args={[0.045, 0.055, 0.74, 8]} />
      <meshStandardMaterial color="#5b6268" metalness={0.75} roughness={0.35} />
    </mesh>)}
    <RoadGravel count={lowQuality ? 74 : 180} />
  </group>;
}

function Terrain() {
  const valley = useMemo(() => makeTerrain(480, 1150, 60, 150, 26, 450), []);
  const roadMountain = useMemo(() => createRoadGeometry(110, -1.8, 0, 1, false, 4.5), []);
  const snowShelf = useMemo(() => createRoadGeometry(90, -1.2, 0.62, 1, true, 3.8), []);
  const rocks = useMemo(() => Array.from({ length: 96 }, (_, index) => {
    const progress = 0.025 + (index / 96) * 0.93;
    const point = roadCurve.getPointAt(progress);
    const tangent = roadCurve.getTangentAt(progress).normalize();
    const side = new THREE.Vector3(-tangent.z, 0, tangent.x).normalize();
    const direction = index % 2 === 0 ? 1 : -1;
    const offset = 6.7 + ((index * 13) % 25);
    const position = point.addScaledVector(side, direction * offset);
    position.y += -0.35 + ((index * 7) % 8) * 0.08;
    return {
      position,
      scale: 0.38 + ((index * 19) % 95) / 100,
      rotation: [index * 0.9, index * 1.7, index * 0.38] as [number, number, number],
      snowy: progress > 0.67,
    };
  }), []);
  const snowBanks = useMemo(() => Array.from({ length: 28 }, (_, index) => {
    const progress = 0.69 + (index / 28) * 0.28;
    const point = roadCurve.getPointAt(progress);
    const tangent = roadCurve.getTangentAt(progress).normalize();
    const side = new THREE.Vector3(-tangent.z, 0, tangent.x).normalize();
    const direction = index % 2 === 0 ? 1 : -1;
    const position = point.addScaledVector(side, direction * (5.8 + (index % 5) * 1.7));
    position.y += 0.2;
    return { position, scale: 0.8 + (index % 4) * 0.35, rotation: index * 0.71 };
  }), []);

  return <group>
    <mesh geometry={valley} receiveShadow><meshStandardMaterial color="#18363a" roughness={1} flatShading /></mesh>
    <mesh geometry={roadMountain} receiveShadow castShadow><meshStandardMaterial color="#29443e" roughness={0.96} flatShading /></mesh>
    <mesh geometry={snowShelf} receiveShadow><meshStandardMaterial color="#bac9ca" roughness={0.92} flatShading /></mesh>
    {rocks.map((rock, index) => <mesh key={index} position={rock.position} rotation={rock.rotation} scale={rock.scale} castShadow receiveShadow>
      <dodecahedronGeometry args={[1, 1]} />
      <meshStandardMaterial color={rock.snowy ? (index % 3 ? '#788a8b' : '#aab6b5') : (index % 3 ? '#405253' : '#59605c')} roughness={0.95} flatShading />
    </mesh>)}
    {snowBanks.map((bank, index) => <mesh key={'snow-' + index} position={bank.position} rotation={[0, bank.rotation, 0]} scale={[bank.scale * 1.7, bank.scale * 0.42, bank.scale]} receiveShadow>
      <dodecahedronGeometry args={[1, 1]} />
      <meshStandardMaterial color={index % 2 ? '#d9e2df' : '#b9cbd0'} roughness={0.95} flatShading />
    </mesh>)}
  </group>;
}

function TreeField({ count = 120 }: { count?: number }) {
  const trunkRef = useRef<THREE.InstancedMesh>(null);
  const foliageRef = useRef<THREE.InstancedMesh>(null);
  const treeData = useMemo(() => Array.from({ length: count }, (_, index) => {
    const progress = 0.02 + (index / count) * 0.7;
    const point = roadCurve.getPointAt(progress);
    const tangent = roadCurve.getTangentAt(progress).normalize();
    const side = new THREE.Vector3(-tangent.z, 0, tangent.x).normalize();
    const outward = index % 2 === 0 ? 1 : -1;
    const spread = 7.2 + ((index * 23) % 105) / 10;
    return {
      position: point.addScaledVector(side, outward * spread),
      height: 1.6 + ((index * 17) % 19) / 10,
      rotation: index * 1.9,
    };
  }), [count]);

  useLayoutEffect(() => {
    const object = new THREE.Object3D();
    treeData.forEach((tree, index) => {
      object.position.set(tree.position.x, tree.position.y + tree.height * 0.42 - 0.2, tree.position.z);
      object.rotation.set(0, tree.rotation, 0);
      object.scale.set(0.75, tree.height, 0.75);
      object.updateMatrix();
      trunkRef.current?.setMatrixAt(index, object.matrix);
      object.position.set(tree.position.x, tree.position.y + tree.height + 0.25, tree.position.z);
      object.scale.set(1.1, tree.height * 1.3, 1.1);
      object.updateMatrix();
      foliageRef.current?.setMatrixAt(index, object.matrix);
    });
    if (trunkRef.current) trunkRef.current.instanceMatrix.needsUpdate = true;
    if (foliageRef.current) foliageRef.current.instanceMatrix.needsUpdate = true;
  }, [treeData]);

  return <group>
    <instancedMesh ref={trunkRef} args={[undefined, undefined, count]} castShadow receiveShadow>
      <cylinderGeometry args={[0.12, 0.18, 1, 7]} /><meshStandardMaterial color="#27302c" roughness={0.92} />
    </instancedMesh>
    <instancedMesh ref={foliageRef} args={[undefined, undefined, count]} castShadow receiveShadow>
      <coneGeometry args={[0.78, 1.9, 8]} /><meshStandardMaterial color="#102b2b" roughness={0.92} flatShading />
    </instancedMesh>
  </group>;
}

function Atmosphere() {
  const clouds = useMemo(() => [
    [-75, 48, 20, 5.5], [82, 54, 130, 6.2], [-90, 58, 260, 6.0], [95, 62, 390, 6.8],
    [-105, 66, 520, 7.5], [90, 70, 660, 8.0], [-85, 74, 800, 7.6], [75, 78, 910, 8.5],
  ] as const, []);
  return <group>
    <mesh position={SUN_POSITION}><sphereGeometry args={[14, 32, 24]} /><meshBasicMaterial color="#ffc578" toneMapped={false} /></mesh>
    <mesh position={SUN_POSITION} scale={1.8}><sphereGeometry args={[14, 32, 24]} /><meshBasicMaterial color="#ff9c63" transparent opacity={0.06} depthWrite={false} /></mesh>
    {clouds.map(([x, y, z, scale], index) => <group key={index} position={[x, y, z]} scale={scale}>
      <mesh scale={[1.2, 0.28, 0.42]}><sphereGeometry args={[1, 20, 12]} /><meshStandardMaterial color="#d9e2df" transparent opacity={0.14} roughness={1} depthWrite={false} /></mesh>
      <mesh position={[0.7, 0.14, 0.1]} scale={[0.82, 0.22, 0.32]}><sphereGeometry args={[1, 20, 12]} /><meshStandardMaterial color="#e9e4d8" transparent opacity={0.11} roughness={1} depthWrite={false} /></mesh>
    </group>)}
  </group>;
}

function SummitVista() {
  const summit = useMemo(() => roadCurve.getPointAt(SUMMIT_PROGRESS), []);
  const tangent = useMemo(() => roadCurve.getTangentAt(SUMMIT_PROGRESS).normalize(), []);
  const side = useMemo(() => new THREE.Vector3(-tangent.z, 0, tangent.x).normalize(), [tangent]);
  const heading = Math.atan2(tangent.x, tangent.z);

  const mountains = useMemo(() => [
    { lateral: -58, forward: 95, height: 62, radius: 34, color: '#68453b' },
    { lateral: 52, forward: 108, height: 74, radius: 40, color: '#563842' },
    { lateral: -12, forward: 135, height: 96, radius: 48, color: '#452b36' },
    { lateral: 88, forward: 165, height: 105, radius: 54, color: '#38222d' },
    { lateral: -92, forward: 170, height: 100, radius: 52, color: '#3c2532' },
    { lateral: 0, forward: 210, height: 128, radius: 65, color: '#2b1924' },
    { lateral: -140, forward: 190, height: 110, radius: 58, color: '#301c27' },
    { lateral: 135, forward: 195, height: 112, radius: 60, color: '#2f1c28' },
  ].map((peak) => {
    const position = summit.clone().addScaledVector(tangent, peak.forward).addScaledVector(side, peak.lateral);
    position.y = summit.y + peak.height * 0.34 - 12;
    return { ...peak, position };
  }), [side, summit, tangent]);

  // Viewpoint wooden barrier railing posts along the cliff edge
  const railingPosts = useMemo(() => Array.from({ length: 14 }, (_, i) => {
    const angle = (i / 13) * Math.PI * 0.95 - Math.PI * 0.475;
    const radius = 8.8;
    return {
      x: Math.sin(angle) * radius + 1.2,
      z: Math.cos(angle) * radius + 0.8,
      height: 1.05,
    };
  }), []);

  // Tibetan prayer flags fluttering across the summit peaks
  const flagColors = useMemo(() => ['#3b82f6', '#ffffff', '#ef4444', '#22c55e', '#eab308'], []);

  return <group>
    {/* Scenic Summit Stone Terrace Platform */}
    <mesh position={[summit.x, summit.y + 0.04, summit.z]} rotation={[-Math.PI / 2, 0, heading]}>
      <circleGeometry args={[9.4, 64]} />
      <meshStandardMaterial color="#383d40" roughness={0.92} metalness={0.05} />
    </mesh>
    <mesh position={[summit.x, summit.y + 0.03, summit.z]} rotation={[-Math.PI / 2, 0, heading]}>
      <ringGeometry args={[8.8, 9.8, 48]} />
      <meshStandardMaterial color="#c89658" roughness={0.7} metalness={0.3} />
    </mesh>

    {/* Overlook Balcony Railing Posts & Top Rail */}
    <group position={[summit.x, summit.y + 0.05, summit.z]} rotation={[0, heading, 0]}>
      {railingPosts.map((post, i) => <group key={i} position={[post.x, 0, post.z]}>
        <mesh position={[0, post.height / 2, 0]} castShadow>
          <cylinderGeometry args={[0.07, 0.09, post.height, 8]} />
          <meshStandardMaterial color="#5c3d2e" roughness={0.88} />
        </mesh>
        <mesh position={[0, post.height, 0]}>
          <sphereGeometry args={[0.09, 8, 8]} />
          <meshStandardMaterial color="#ffd57e" roughness={0.3} metalness={0.8} />
        </mesh>
      </group>)}

      {/* Main Sacred Himalayan Stone Cairns (Lhatho) with glowing amber relics */}
      <group position={[-4.6, 0.3, 2.5]}>
        {[0, 1, 2, 3, 4].map((index) => <mesh key={index} position={[0, index * 0.28, 0]} scale={[0.85 - index * 0.12, 0.32, 0.75 - index * 0.1]} rotation={[0, index * 0.85, 0]} castShadow>
          <dodecahedronGeometry args={[1, 0]} />
          <meshStandardMaterial color={index % 2 ? '#928479' : '#61544b'} roughness={0.98} flatShading />
        </mesh>)}
        <mesh position={[0, 1.6, 0]}>
          <octahedronGeometry args={[0.26, 0]} />
          <meshStandardMaterial color="#ffe891" emissive="#ff9d2e" emissiveIntensity={3.8} toneMapped={false} />
        </mesh>
        <pointLight position={[0, 1.6, 0]} color="#ffb03a" intensity={8} distance={9} />
      </group>

      {/* Right Side Stone Beacon Cairn */}
      <group position={[4.8, 0.3, 2.2]}>
        {[0, 1, 2, 3].map((index) => <mesh key={index} position={[0, index * 0.26, 0]} scale={[0.7 - index * 0.1, 0.28, 0.6 - index * 0.08]} rotation={[0, -index * 0.75, 0]} castShadow>
          <dodecahedronGeometry args={[1, 0]} />
          <meshStandardMaterial color={index % 2 ? '#887c72' : '#584c44'} roughness={0.98} flatShading />
        </mesh>)}
        <mesh position={[0, 1.35, 0]}>
          <octahedronGeometry args={[0.22, 0]} />
          <meshStandardMaterial color="#ffe891" emissive="#ff9d2e" emissiveIntensity={3.2} toneMapped={false} />
        </mesh>
        <pointLight position={[0, 1.35, 0]} color="#ffb03a" intensity={6} distance={8} />
      </group>

      {/* Tibetan Prayer Flag Banners stringing across the overlook */}
      {Array.from({ length: 18 }, (_, i) => {
        const t = i / 17;
        const x = THREE.MathUtils.lerp(-4.4, 4.6, t);
        const z = THREE.MathUtils.lerp(2.4, 2.1, t);
        const sag = Math.sin(t * Math.PI) * 0.55;
        const y = 1.65 - sag;
        const color = flagColors[i % flagColors.length];
        return <mesh key={'flag-' + i} position={[x, y, z]} rotation={[0.1, 0, Math.sin(i * 1.2) * 0.12]}>
          <planeGeometry args={[0.32, 0.24]} />
          <meshStandardMaterial color={color} roughness={0.65} side={THREE.DoubleSide} />
        </mesh>;
      })}
    </group>

    {/* Majestic Himalayan Mountain Vista with Golden Twilight Snow Caps */}
    {mountains.map((peak, index) => <group key={index} position={peak.position}>
      <mesh scale={[peak.radius, peak.height, peak.radius]} rotation={[0, index * 0.43, 0]}>
        <coneGeometry args={[1, 1, 6, 1]} />
        <meshStandardMaterial color={peak.color} roughness={0.95} flatShading />
      </mesh>
      <mesh position={[0, peak.height * 0.33, 0]} scale={[peak.radius * 0.44, peak.height * 0.34, peak.radius * 0.44]} rotation={[0, index * 0.43, 0]}>
        <coneGeometry args={[1, 1, 6, 1]} />
        <meshStandardMaterial color={index % 2 ? '#ffebd6' : '#ffd7bd'} emissive="#8a4b2a" emissiveIntensity={0.25} roughness={0.8} flatShading />
      </mesh>
    </group>)}
  </group>;
}

const BIKE_SCALE = 1.28;
const WHEEL_RADIUS_WORLD = 0.495 * BIKE_SCALE;


const RIDER_PART_NAMES = [
  'Rider hips', 'Rider torso jacket', 'Shoulder left', 'Shoulder right', 'Rider neck',
  'Jacket arm', 'Gloved forearm', 'Glove', 'Jacket arm.001', 'Gloved forearm.001', 'Glove.001',
  'Riding thigh', 'Riding shin', 'Riding boot', 'Riding thigh.001', 'Riding shin.001', 'Riding boot.001',
  'Rider scarf',
] as const;

const HELMET_PART_NAMES = ['Rider helmet', 'Helmet crown', 'Helmet visor', 'Helmet rear'] as const;

function resolveModelPart(root: THREE.Object3D, canonicalName: string) {
  const part = root.getObjectByName(canonicalName)
    ?? root.getObjectByName(THREE.PropertyBinding.sanitizeNodeName(canonicalName));
  if (part) part.name = canonicalName;
  return part;
}

function createOrganicFaceGeometry() {
  const geometry = new THREE.SphereGeometry(1, 48, 32);
  const position = geometry.getAttribute('position') as THREE.BufferAttribute;

  for (let index = 0; index < position.count; index += 1) {
    const x = position.getX(index);
    const y = position.getY(index);
    const z = position.getZ(index);
    const lowerFace = THREE.MathUtils.clamp(-y, 0, 1);
    const jawTaper = 1 - lowerFace * 0.24;
    const cheekSoftness = 1 + Math.exp(-Math.pow((y + 0.02) / 0.34, 2)) * 0.035;
    position.setXYZ(index, x * (1 - lowerFace * 0.035), y, z * jawTaper * cheekSoftness);
  }

  geometry.computeVertexNormals();
  return geometry;
}

function makeStrand(points: Array<[number, number, number]>, radius: number, segments = 24) {
  const curve = new THREE.CatmullRomCurve3(points.map((point) => new THREE.Vector3(...point)));
  return new THREE.TubeGeometry(curve, segments, radius, 10, false);
}

function softenRiderMeshes(riderGroup: THREE.Group) {
  const jacketMaterial = new THREE.MeshPhysicalMaterial({
    color: '#242830',
    roughness: 0.72,
    metalness: 0,
    clearcoat: 0.08,
    clearcoatRoughness: 0.82,
    sheen: 0.35,
    sheenColor: '#744557',
    sheenRoughness: 0.82,
  });
  const sleeveMaterial = new THREE.MeshStandardMaterial({ color: '#292a31', roughness: 0.78, metalness: 0 });
  const pantsMaterial = new THREE.MeshStandardMaterial({ color: '#211f25', roughness: 0.88, metalness: 0 });
  const gloveMaterial = new THREE.MeshStandardMaterial({ color: '#181a1f', roughness: 0.64, metalness: 0.02 });
  const bootMaterial = new THREE.MeshPhysicalMaterial({
    color: '#15171b', roughness: 0.55, metalness: 0.02, clearcoat: 0.12, clearcoatRoughness: 0.7,
  });
  const skinMaterial = new THREE.MeshStandardMaterial({ color: '#a96851', roughness: 0.74, metalness: 0 });
  const scarfMaterial = new THREE.MeshStandardMaterial({ color: '#9f4051', roughness: 0.9, metalness: 0 });
  const accentMaterial = new THREE.MeshStandardMaterial({ color: '#c78658', roughness: 0.56, metalness: 0.06 });

  const fit = (
    name: string,
    geometry: THREE.BufferGeometry,
    material: THREE.Material,
    scale: [number, number, number] = [1, 1, 1],
  ) => {
    const object = riderGroup.getObjectByName(name);
    if (!(object instanceof THREE.Mesh)) return null;
    object.geometry = geometry;
    object.material = material;
    object.scale.set(...scale);
    object.castShadow = true;
    object.receiveShadow = true;
    return object;
  };

  fit('Rider hips', new THREE.SphereGeometry(1, 32, 24), pantsMaterial, [0.25, 0.2, 0.31]);

  const torsoProfile = [
    new THREE.Vector2(0.16, -0.39),
    new THREE.Vector2(0.2, -0.35),
    new THREE.Vector2(0.22, -0.25),
    new THREE.Vector2(0.205, -0.12),
    new THREE.Vector2(0.22, 0.04),
    new THREE.Vector2(0.265, 0.21),
    new THREE.Vector2(0.24, 0.33),
    new THREE.Vector2(0.15, 0.39),
  ];
  const torsoObj = fit(
    'Rider torso jacket',
    new THREE.LatheGeometry(torsoProfile, 36),
    jacketMaterial,
    [0.74, 1, 1],
  );

  fit('Shoulder left', new THREE.SphereGeometry(1, 28, 20), jacketMaterial, [0.115, 0.13, 0.145]);
  fit('Shoulder right', new THREE.SphereGeometry(1, 28, 20), jacketMaterial, [0.115, 0.13, 0.145]);
  fit('Rider neck', new THREE.CapsuleGeometry(0.068, 0.035, 8, 18), skinMaterial);

  for (const name of ['Jacket arm', 'Jacket arm.001']) {
    fit(name, new THREE.CapsuleGeometry(0.09, 0.39, 8, 18), jacketMaterial);
  }
  for (const name of ['Gloved forearm', 'Gloved forearm.001']) {
    fit(name, new THREE.CapsuleGeometry(0.068, 0.49, 8, 18), sleeveMaterial);
  }
  for (const name of ['Glove', 'Glove.001']) {
    fit(name, new THREE.SphereGeometry(1, 24, 18), gloveMaterial, [0.1, 0.075, 0.087]);
  }
  for (const name of ['Riding thigh', 'Riding thigh.001']) {
    fit(name, new THREE.CapsuleGeometry(0.125, 0.38, 8, 18), pantsMaterial);
  }
  for (const name of ['Riding shin', 'Riding shin.001']) {
    fit(name, new THREE.CapsuleGeometry(0.094, 0.41, 8, 18), pantsMaterial);
  }
  for (const name of ['Riding boot', 'Riding boot.001']) {
    fit(name, new THREE.SphereGeometry(1, 24, 18), bootMaterial, [0.185, 0.075, 0.1]);
  }

  const scarf = riderGroup.getObjectByName('Rider scarf');
  if (scarf instanceof THREE.Mesh) scarf.material = scarfMaterial;

  if (torsoObj) {
    const zipper = new THREE.Mesh(new THREE.CapsuleGeometry(0.008, 0.52, 4, 10), accentMaterial);
    zipper.name = 'Jacket zipper';
    zipper.position.set(0.272, -0.035, 0);

    const belt = new THREE.Mesh(new THREE.TorusGeometry(0.207, 0.012, 8, 32), accentMaterial);
    belt.name = 'Jacket waist piping';
    belt.position.y = -0.29;
    belt.rotation.x = Math.PI / 2;

    const collarLeft = new THREE.Mesh(new THREE.CapsuleGeometry(0.012, 0.19, 4, 10), accentMaterial);
    collarLeft.position.set(0.268, 0.245, 0.075);
    collarLeft.rotation.x = 0.56;
    const collarRight = collarLeft.clone();
    collarRight.position.z = -0.075;
    collarRight.rotation.x = -0.56;

    for (const detail of [zipper, belt, collarLeft, collarRight]) detail.castShadow = true;
    torsoObj.add(zipper, belt, collarLeft, collarRight);
  }

  return { torsoObj, torsoBaseScale: torsoObj?.scale.clone() ?? null };
}

function createHumanizedHead(riderGroup: THREE.Group) {
  const skinMaterial = new THREE.MeshPhysicalMaterial({
    color: '#a96851', roughness: 0.73, metalness: 0, clearcoat: 0.04, clearcoatRoughness: 0.9,
  });
  const skinHighlightMaterial = new THREE.MeshStandardMaterial({ color: '#b9775d', roughness: 0.76, metalness: 0 });
  const hairMaterial = new THREE.MeshStandardMaterial({ color: '#201510', roughness: 0.86, metalness: 0 });
  const browMaterial = new THREE.MeshStandardMaterial({ color: '#2b1b15', roughness: 0.9, metalness: 0 });
  const eyeWhiteMaterial = new THREE.MeshStandardMaterial({ color: '#f4e9dc', roughness: 0.42, metalness: 0 });
  const irisMaterial = new THREE.MeshStandardMaterial({ color: '#5b3425', roughness: 0.48, metalness: 0 });
  const pupilMaterial = new THREE.MeshBasicMaterial({ color: '#130e0c', toneMapped: false });
  const eyeHighlightMaterial = new THREE.MeshBasicMaterial({ color: '#fff8e8', toneMapped: false });
  const lipMaterial = new THREE.MeshStandardMaterial({ color: '#9f4f5b', roughness: 0.62, metalness: 0 });
  const blushMaterial = new THREE.MeshStandardMaterial({
    color: '#c06b6d', roughness: 0.9, transparent: true, opacity: 0.2, depthWrite: false,
  });
  const hairBandMaterial = new THREE.MeshStandardMaterial({ color: '#c78658', roughness: 0.5, metalness: 0.08 });

  const headReveal = new THREE.Group();
  headReveal.name = 'RiderHeadReveal';
  headReveal.position.set(0.06, 2.22, 0);
  headReveal.visible = false;

  const face = new THREE.Mesh(createOrganicFaceGeometry(), skinMaterial);
  face.name = 'Humanized face';
  face.scale.set(0.2, 0.25, 0.19);

  const hairCrown = new THREE.Mesh(
    new THREE.SphereGeometry(1, 38, 26, 0, Math.PI * 2, 0, Math.PI * 0.69),
    hairMaterial,
  );
  hairCrown.name = 'Soft hair crown';
  hairCrown.position.set(-0.02, 0.055, 0);
  hairCrown.scale.set(0.215, 0.27, 0.205);

  const leftFringe = new THREE.Mesh(new THREE.SphereGeometry(1, 24, 16), hairMaterial);
  leftFringe.position.set(0.17, 0.15, 0.065);
  leftFringe.scale.set(0.038, 0.075, 0.095);
  leftFringe.rotation.x = 0.18;
  const rightFringe = leftFringe.clone();
  rightFringe.position.z = -0.065;
  rightFringe.rotation.x = -0.18;

  const earGeometry = new THREE.SphereGeometry(1, 20, 14);
  for (const side of [-1, 1]) {
    const ear = new THREE.Mesh(earGeometry, skinMaterial);
    ear.position.set(-0.005, 0, side * 0.19);
    ear.scale.set(0.035, 0.055, 0.027);
    headReveal.add(ear);
  }

  const eyeGeometry = new THREE.SphereGeometry(1, 24, 16);
  for (const side of [-1, 1]) {
    const eye = new THREE.Mesh(eyeGeometry, eyeWhiteMaterial);
    eye.position.set(0.182, 0.052, side * 0.073);
    eye.scale.set(0.014, 0.027, 0.049);

    const iris = new THREE.Mesh(eyeGeometry, irisMaterial);
    iris.position.set(0.195, 0.052, side * 0.073);
    iris.scale.set(0.007, 0.014, 0.02);

    const pupil = new THREE.Mesh(eyeGeometry, pupilMaterial);
    pupil.position.set(0.201, 0.052, side * 0.073);
    pupil.scale.set(0.004, 0.0075, 0.009);

    const highlight = new THREE.Mesh(eyeGeometry, eyeHighlightMaterial);
    highlight.position.set(0.205, 0.059, side * 0.068);
    highlight.scale.setScalar(0.0035);

    const brow = new THREE.Mesh(
      makeStrand([
        [0.187, 0.112, side * 0.118],
        [0.19, 0.126, side * 0.075],
        [0.187, 0.116, side * 0.031],
      ], 0.006, 12),
      browMaterial,
    );
    const lashes = new THREE.Mesh(
      makeStrand([
        [0.199, 0.074, side * 0.118],
        [0.201, 0.083, side * 0.075],
        [0.199, 0.077, side * 0.03],
      ], 0.0032, 10),
      browMaterial,
    );

    headReveal.add(eye, iris, pupil, highlight, brow, lashes);
  }

  const noseBridge = new THREE.Mesh(new THREE.SphereGeometry(1, 24, 18), skinHighlightMaterial);
  noseBridge.position.set(0.184, 0.006, 0);
  noseBridge.scale.set(0.024, 0.07, 0.025);
  const noseTip = new THREE.Mesh(new THREE.SphereGeometry(1, 24, 18), skinHighlightMaterial);
  noseTip.position.set(0.202, -0.021, 0);
  noseTip.scale.set(0.029, 0.023, 0.031);

  const upperLip = new THREE.Mesh(
    makeStrand([
      [0.196, -0.083, -0.056],
      [0.199, -0.076, -0.02],
      [0.201, -0.083, 0],
      [0.199, -0.076, 0.02],
      [0.196, -0.083, 0.056],
    ], 0.0055, 18),
    lipMaterial,
  );
  const lowerLip = new THREE.Mesh(
    makeStrand([
      [0.195, -0.088, -0.052],
      [0.199, -0.102, 0],
      [0.195, -0.088, 0.052],
    ], 0.005, 14),
    lipMaterial,
  );

  for (const side of [-1, 1]) {
    const blush = new THREE.Mesh(new THREE.SphereGeometry(1, 18, 12), blushMaterial);
    blush.position.set(0.184, -0.024, side * 0.112);
    blush.scale.set(0.008, 0.034, 0.045);

    const sideLock = new THREE.Mesh(
      makeStrand([
        [0.13, 0.145, side * 0.145],
        [0.145, 0.045, side * 0.18],
        [0.105, -0.095, side * 0.185],
        [0.025, -0.205, side * 0.16],
      ], 0.016, 20),
      hairMaterial,
    );
    headReveal.add(blush, sideLock);
  }

  for (const mesh of [face, hairCrown, leftFringe, rightFringe, noseBridge, noseTip, upperLip, lowerLip]) {
    mesh.castShadow = true;
  }
  headReveal.add(face, hairCrown, leftFringe, rightFringe, noseBridge, noseTip, upperLip, lowerLip);

  const ponytailRef = new THREE.Group();
  ponytailRef.name = 'PonytailGroup';
  ponytailRef.position.set(-0.135, 2.245, 0);
  const ponytailBase = ponytailRef.position.clone();

  const napeHair = new THREE.Mesh(new THREE.SphereGeometry(1, 28, 20), hairMaterial);
  napeHair.position.set(0, -0.055, 0);
  napeHair.scale.set(0.11, 0.13, 0.17);

  const hairBand = new THREE.Mesh(new THREE.TorusGeometry(0.052, 0.014, 8, 20), hairBandMaterial);
  hairBand.position.set(-0.045, -0.075, 0);
  hairBand.rotation.y = Math.PI / 2;

  const ponytail = new THREE.Mesh(
    makeStrand([
      [-0.045, -0.075, 0],
      [-0.12, -0.12, 0.025],
      [-0.2, -0.2, -0.025],
      [-0.3, -0.3, 0.045],
      [-0.39, -0.43, 0],
    ], 0.054, 30),
    hairMaterial,
  );
  const curlLeft = new THREE.Mesh(
    makeStrand([
      [-0.035, -0.07, 0.04],
      [-0.12, -0.15, 0.085],
      [-0.23, -0.25, 0.035],
      [-0.34, -0.38, 0.075],
    ], 0.024, 24),
    hairMaterial,
  );
  const curlRight = new THREE.Mesh(
    makeStrand([
      [-0.035, -0.07, -0.04],
      [-0.11, -0.16, -0.08],
      [-0.22, -0.27, -0.03],
      [-0.33, -0.4, -0.07],
    ], 0.022, 24),
    hairMaterial,
  );
  for (const mesh of [napeHair, hairBand, ponytail, curlLeft, curlRight]) mesh.castShadow = true;
  ponytailRef.add(napeHair, hairBand, ponytail, curlLeft, curlRight);

  riderGroup.add(headReveal, ponytailRef);
  return { headReveal, ponytailRef, ponytailBase };
}

const MODEL_PATH = `${process.env.NEXT_PUBLIC_BASE_PATH || ''}/models/apoorva-cafe-rider.glb`;

type ExhaustParticle = {
  position: THREE.Vector3;
  velocity: THREE.Vector3;
  age: number;
  lifetime: number;
  size: number;
  spin: number;
};

function ExhaustSmoke({
  anchors,
  drive,
  mode,
  lowQuality,
}: {
  anchors: Array<{ current: THREE.Object3D | null }>;
  drive: DriveRef;
  mode: RideState;
  lowQuality: boolean;
}) {
  const particleCount = lowQuality ? 12 : 26;
  const smoke = useRef<THREE.InstancedMesh>(null);
  const emitterCursor = useRef(0);
  const emissionCarry = useRef(0);
  const intensity = useRef(0);
  const dummy = useMemo(() => new THREE.Object3D(), []);
  const outletQuaternion = useMemo(() => new THREE.Quaternion(), []);
  const particles = useMemo<ExhaustParticle[]>(() => Array.from({ length: particleCount }, (_, index) => ({
    position: new THREE.Vector3(),
    velocity: new THREE.Vector3(),
    age: 999,
    lifetime: 0.7,
    size: 0.06,
    spin: index * 0.73,
  })), [particleCount]);

  useFrame((_, rawDelta) => {
    const delta = Math.min(rawDelta, 0.05);
    const runtime = drive.current;
    const engineOn = mode === 'countdown'
      || mode === 'riding'
      || mode === 'target'
      || mode === 'aiming'
      || mode === 'shot'
      || mode === 'reading'
      || mode === 'summit';
    const throttleLoad = THREE.MathUtils.clamp(
      0.22 + runtime.velocity * 0.62 + Math.max(0, runtime.acceleration) * 0.24,
      0,
      1,
    );
    intensity.current = THREE.MathUtils.damp(intensity.current, engineOn ? throttleLoad : 0, 4.5, delta);
    const emissionRate = (lowQuality ? 6 : 11) * intensity.current;
    emissionCarry.current = Math.min(4, emissionCarry.current + emissionRate * delta);

    let emittedThisFrame = 0;
    while (emissionCarry.current >= 1 && emittedThisFrame < 4) {
      const sequence = emitterCursor.current;
      const anchor = anchors[sequence % anchors.length]?.current;
      if (!anchor) break;

      const particle = particles[sequence % particleCount];
      const jitter = ((sequence * 37) % 101) / 100;
      anchor.getWorldPosition(particle.position);
      anchor.getWorldQuaternion(outletQuaternion);
      particle.velocity
        .set(
          -0.42 - runtime.velocity * 1.75,
          0.13 + jitter * 0.16,
          (jitter - 0.5) * 0.14,
        )
        .applyQuaternion(outletQuaternion);
      particle.velocity.y += 0.16;
      particle.age = 0;
      particle.lifetime = 0.68 + jitter * 0.48;
      particle.size = 0.052 + jitter * 0.042;
      particle.spin = sequence * 0.61;

      emitterCursor.current += 1;
      emissionCarry.current -= 1;
      emittedThisFrame += 1;
    }

    particles.forEach((particle, index) => {
      particle.age += delta;
      const lifeProgress = particle.age / particle.lifetime;
      if (lifeProgress >= 1) {
        dummy.scale.setScalar(0);
      } else {
        particle.velocity.multiplyScalar(Math.exp(-0.42 * delta));
        particle.velocity.y += 0.11 * delta;
        particle.position.addScaledVector(particle.velocity, delta);
        const fade = 1 - THREE.MathUtils.smoothstep(lifeProgress, 0.58, 1);
        const scale = particle.size * (0.55 + lifeProgress * 2.35) * Math.sqrt(Math.max(0, fade));
        dummy.position.copy(particle.position);
        dummy.rotation.set(
          particle.spin + lifeProgress * 0.8,
          particle.spin * 0.7 + lifeProgress,
          particle.spin * 0.35,
        );
        dummy.scale.set(scale * 1.35, scale, scale * 1.15);
      }
      dummy.updateMatrix();
      smoke.current?.setMatrixAt(index, dummy.matrix);
    });

    if (smoke.current) smoke.current.instanceMatrix.needsUpdate = true;
  });

  return <instancedMesh ref={smoke} args={[undefined, undefined, particleCount]} frustumCulled={false} renderOrder={3}>
    <icosahedronGeometry args={[1, 1]} />
    <meshBasicMaterial
      color="#c9d1d0"
      transparent
      opacity={0.17}
      depthWrite={false}
      blending={THREE.NormalBlending}
    />
  </instancedMesh>;
}

function RideRig({
  controller,
  drive,
  lowQuality,
}: {
  controller: RideController;
  drive: DriveRef;
  lowQuality: boolean;
}) {
  const { scene } = useGLTF(MODEL_PATH);
  const { camera } = useThree();
  const bikeRoot = useRef<THREE.Group>(null);
  const visual = useRef<THREE.Group>(null);
  const leftExhaustAnchor = useRef<THREE.Group>(null);
  const rightExhaustAnchor = useRef<THREE.Group>(null);
  const kickstand = useRef<THREE.Group>(null);
  const tracerImpact = useRef<THREE.Mesh>(null);
  const point = useMemo(() => new THREE.Vector3(), []);
  const tangent = useMemo(() => new THREE.Vector3(), []);
  const tangentAhead = useMemo(() => new THREE.Vector3(), []);
  const heading = useMemo(() => new THREE.Vector3(), []);
  const side = useMemo(() => new THREE.Vector3(), []);
  const frameSide = useMemo(() => new THREE.Vector3(), []);
  const frameUp = useMemo(() => new THREE.Vector3(), []);
  const worldUp = useMemo(() => new THREE.Vector3(0, 1, 0), []);
  const desiredCamera = useMemo(() => new THREE.Vector3(), []);
  const desiredLook = useMemo(() => new THREE.Vector3(), []);
  const lookAt = useMemo(() => new THREE.Vector3(), []);
  const cameraBase = useMemo(() => camera.position.clone(), [camera]);
  const pathQuaternion = useMemo(() => new THREE.Quaternion(), []);
  const frameMatrix = useMemo(() => new THREE.Matrix4(), []);
  const signFocus = useMemo(
    () => controller.activeStop ? getRoadsidePose(controller.activeStop).position : new THREE.Vector3(),
    [controller.activeIndex, controller.activeStop],
  );
  const summitPoint = useMemo(() => roadCurve.getPointAt(SUMMIT_PROGRESS), []);
  const summitTangent = useMemo(() => roadCurve.getTangentAt(SUMMIT_PROGRESS).normalize(), []);
  const summitSide = useMemo(() => new THREE.Vector3(-summitTangent.z, 0, summitTangent.x).normalize(), [summitTangent]);
  const sunPosition = useMemo(() => new THREE.Vector3(...SUN_POSITION), []);
  const finaleStartedAt = useRef(-1);
  const previousRideMode = useRef<RideState>('intro');
  const aimWeight = useRef(0);
  const shotFiredAt = useRef(-1);
  const lastShotStage = useRef(-1);
  const muzzleWorldPos = useMemo(() => new THREE.Vector3(), []);
  const tracerMidPos = useMemo(() => new THREE.Vector3(), []);

  const {
    model,
    steeringGroup,
    floorOffset,
    riderGroup,
    helmetGroup,
    helmetBase,
    headReveal,
    ponytailRef,
    ponytailBase,
    scarfObj,
    gunGroup,
    muzzleTip,
    muzzleFlash,
    torsoObj,
    torsoBaseScale,
    riderOriginals,
  } = useMemo(() => {
    const clone = scene.clone(true);
    clone.traverse((object) => {
      if (object instanceof THREE.Mesh) {
        object.castShadow = true;
        object.receiveShadow = true;
      }
    });

    for (const name of ['RearWheelSpin', 'FrontWheelSpin']) {
      const pivot = clone.getObjectByName(name);
      if (!pivot) continue;
      const axle = pivot.position.clone();
      for (const child of [...pivot.children]) {
        if (/caliper/i.test(child.name)) {
          pivot.remove(child);
          clone.add(child);
        } else {
          child.position.sub(axle);
        }
      }
    }

    const steeringGroup = new THREE.Group();
    steeringGroup.name = 'FrontSteering';
    steeringGroup.position.set(1.08, 1.28, 0);
    clone.add(steeringGroup);
    clone.updateMatrixWorld(true);
    const steeringPartNames = [
      'FrontWheelSpin',
      'Front wheel brake caliper',
      'Front fork',
      'Front fork.001',
      'Fork brace',
      'Fork brace.001',
      'Handle bar',
      'Left clip-on',
      'Right clip-on',
      'Headlight shell',
      'Headlight lens',
      'Headlight bracket',
      'Headlight bracket.001',
      'Turn indicator',
      'Turn indicator.001',
    ];
    for (const name of steeringPartNames) {
      const object = clone.getObjectByName(name);
      if (object) steeringGroup.attach(object);
    }

    const riderGroup = new THREE.Group();
    riderGroup.name = 'RiderDismount';
    const helmetGroup = new THREE.Group();
    helmetGroup.name = 'HelmetRemoval';
    helmetGroup.position.set(0.09, 2.25, 0);
    const helmetBase = helmetGroup.position.clone();
    clone.add(riderGroup);
    clone.updateMatrixWorld(true);

    for (const name of RIDER_PART_NAMES) {
      const object = resolveModelPart(clone, name);
      if (object) riderGroup.attach(object);
    }
    riderGroup.add(helmetGroup);
    clone.updateMatrixWorld(true);
    for (const name of HELMET_PART_NAMES) {
      const object = resolveModelPart(clone, name);
      if (object) helmetGroup.attach(object);
    }

    const { torsoObj, torsoBaseScale } = softenRiderMeshes(riderGroup);

    const riderParts = RIDER_PART_NAMES
      .map((name) => riderGroup.getObjectByName(name))
      .filter((object): object is THREE.Object3D => !!object);
    const riderOriginals = riderParts.map((object) => ({
      object,
      position: object.position.clone(),
      quaternion: object.quaternion.clone(),
    }));

    const scarfObj = riderGroup.getObjectByName('Rider scarf');

    // Attach prominent, stylish sci-fi pistol to right glove
    const rightGlove = riderGroup.getObjectByName('Glove.001');
    const gunGroup = new THREE.Group();
    gunGroup.name = 'RiderGun';
    gunGroup.position.set(0.14, -0.02, 0.08);
    gunGroup.rotation.set(0.14, -0.15, 0.08);
    gunGroup.scale.set(2.2, 2.2, 2.2);

    const gunBody = new THREE.Mesh(
      new THREE.BoxGeometry(0.3, 0.14, 0.07),
      new THREE.MeshStandardMaterial({ color: '#111518', metalness: 0.94, roughness: 0.18 }),
    );
    gunBody.castShadow = true;

    const gunSlide = new THREE.Mesh(
      new THREE.BoxGeometry(0.35, 0.08, 0.076),
      new THREE.MeshStandardMaterial({ color: '#c4d8e8', metalness: 0.98, roughness: 0.12 }),
    );
    gunSlide.position.set(0.02, 0.08, 0);

    const energyCore = new THREE.Mesh(
      new THREE.BoxGeometry(0.18, 0.032, 0.082),
      new THREE.MeshStandardMaterial({ color: '#ffe882', emissive: '#ffaa22', emissiveIntensity: 5.0 }),
    );
    energyCore.position.set(-0.02, 0.028, 0);

    const barrel = new THREE.Mesh(
      new THREE.CylinderGeometry(0.03, 0.032, 0.22, 12),
      new THREE.MeshStandardMaterial({ color: '#242b32', metalness: 0.95, roughness: 0.18 }),
    );
    barrel.rotation.z = -Math.PI / 2;
    barrel.position.set(0.26, 0.08, 0);

    const muzzleTip = new THREE.Group();
    muzzleTip.name = 'GunMuzzleTip';
    muzzleTip.position.set(0.38, 0.08, 0);

    const laserDiode = new THREE.Mesh(
      new THREE.SphereGeometry(0.025, 12, 12),
      new THREE.MeshBasicMaterial({ color: '#ffea78', toneMapped: false }),
    );
    laserDiode.position.set(0.36, 0.04, 0);

    const muzzleFlash = new THREE.Mesh(
      new THREE.OctahedronGeometry(0.22, 1),
      new THREE.MeshBasicMaterial({ color: '#fff9d6', transparent: true, opacity: 0, toneMapped: false }),
    );
    muzzleFlash.name = 'GunMuzzleFlash';
    muzzleFlash.position.set(0.38, 0.08, 0);
    muzzleFlash.scale.set(2.8, 1.5, 1.5);

    const grip = new THREE.Mesh(
      new THREE.BoxGeometry(0.08, 0.17, 0.06),
      new THREE.MeshStandardMaterial({ color: '#090b0d', roughness: 0.9 }),
    );
    grip.position.set(-0.1, -0.11, 0);
    grip.rotation.z = -0.28;

    gunGroup.add(gunBody, gunSlide, energyCore, barrel, laserDiode, muzzleTip, muzzleFlash, grip);
    if (rightGlove) rightGlove.add(gunGroup);

    const { headReveal, ponytailRef, ponytailBase } = createHumanizedHead(riderGroup);

    clone.updateMatrixWorld(true);
    const bounds = new THREE.Box3().setFromObject(clone);
    return {
      model: clone,
      steeringGroup,
      riderGroup,
      helmetGroup,
      helmetBase,
      headReveal,
      ponytailRef,
      ponytailBase,
      scarfObj,
      gunGroup,
      muzzleTip,
      muzzleFlash,
      torsoObj,
      torsoBaseScale,
      riderOriginals,
      floorOffset: 0.08 - bounds.min.y * BIKE_SCALE,
    };
  }, [scene]);

  const rearWheel = useMemo(() => model.getObjectByName('RearWheelSpin'), [model]);
  const frontWheel = useMemo(() => model.getObjectByName('FrontWheelSpin'), [model]);



  useFrame(({ clock }, rawDelta) => {
    const delta = Math.min(rawDelta, 0.05);
    const runtime = drive.current;
    const activeStop = controller.activeStop;

    if (previousRideMode.current !== controller.mode) {
      if (controller.mode === 'finale') {
        finaleStartedAt.current = clock.elapsedTime;
      }
      if (controller.mode === 'shot' && lastShotStage.current !== controller.activeIndex) {
        lastShotStage.current = controller.activeIndex;
        shotFiredAt.current = clock.elapsedTime;
      }
      if (controller.mode === 'aiming') runtime.velocity = Math.min(runtime.velocity, 0.16);
      previousRideMode.current = controller.mode;
    }
    const terminalScene = controller.mode === 'finale';
    if (terminalScene && finaleStartedAt.current < 0) finaleStartedAt.current = clock.elapsedTime;
    const finaleElapsed = terminalScene ? Math.max(0, clock.elapsedTime - finaleStartedAt.current) : 0;

    // Finale: settle the motorcycle onto its kickstand, then reveal and hold the summit view.
    const parkingStand = terminalScene ? THREE.MathUtils.smootherstep(finaleElapsed, 0.15, 1.1) : 0;
    const viewReveal = terminalScene ? THREE.MathUtils.smootherstep(finaleElapsed, 1.15, 3.6) : 0;

    // Gun aiming & shooting weights
    const isAimingMode = (controller.mode === 'target' || controller.mode === 'aiming' || controller.mode === 'shot') && !terminalScene;
    const targetAimWeight = isAimingMode ? 1 : 0;
    aimWeight.current = THREE.MathUtils.damp(aimWeight.current, targetAimWeight, 14, delta);

    const timeSinceShot = shotFiredAt.current >= 0 ? clock.elapsedTime - shotFiredAt.current : 999;
    const isLaserShooting = timeSinceShot >= 0 && timeSinceShot < 0.45;
    const recoilKick = Math.sin(THREE.MathUtils.clamp(timeSinceShot / 0.28, 0, 1) * Math.PI);

    if (terminalScene) {
      // In finale, gun is holstered
      if (gunGroup) gunGroup.visible = false;
      riderGroup.position.set(0, 0, 0);
      riderGroup.rotation.set(0, 0, 0);
      helmetGroup.position.copy(helmetBase);
      helmetGroup.rotation.set(0, 0, 0);
      headReveal.visible = false;
      headReveal.scale.setScalar(0);
      headReveal.rotation.set(0, 0, 0);

      for (const snapshot of riderOriginals) {
        snapshot.object.position.copy(snapshot.position);
        snapshot.object.quaternion.copy(snapshot.quaternion);
      }
    } else {
      // Normal driving / aiming posture
      riderGroup.position.set(0, 0, 0);
      riderGroup.rotation.set(0, 0, 0);
      helmetGroup.position.copy(helmetBase);
      helmetGroup.rotation.set(0, 0, 0);
      headReveal.visible = false;
      headReveal.scale.setScalar(0);
      headReveal.rotation.set(0, 0, 0);

      const currentAim = aimWeight.current;
      if (gunGroup) gunGroup.visible = currentAim > 0.02;

      const targetSide = activeStop ? (activeStop.side ?? -1) : -1;

      for (const snapshot of riderOriginals) {
        snapshot.object.position.copy(snapshot.position);
        snapshot.object.quaternion.copy(snapshot.quaternion);

        // One-handed driving + right arm dramatically raised & pointing gun towards target on either Left or Right roadside
        if (currentAim > 0.001) {
          if (snapshot.object.name === 'Jacket arm.001') {
            snapshot.object.position.y += 0.48 * currentAim;
            snapshot.object.position.z += targetSide * 0.65 * currentAim;
            snapshot.object.position.x += 0.35 * currentAim;
            snapshot.object.rotation.z += 0.72 * currentAim;
            snapshot.object.rotation.y += targetSide * 0.95 * currentAim;
          } else if (snapshot.object.name === 'Gloved forearm.001') {
            snapshot.object.position.y += 0.78 * currentAim;
            snapshot.object.position.z += targetSide * 1.15 * currentAim;
            snapshot.object.position.x += 0.55 * currentAim;
            snapshot.object.rotation.z += 0.62 * currentAim;
            snapshot.object.rotation.y += targetSide * 1.22 * currentAim;
          } else if (snapshot.object.name === 'Glove.001') {
            snapshot.object.position.y += 0.92 * currentAim + (isLaserShooting ? recoilKick * 0.14 : 0);
            snapshot.object.position.z += targetSide * 1.55 * currentAim;
            snapshot.object.position.x += 0.72 * currentAim - (isLaserShooting ? recoilKick * 0.28 : 0);
            snapshot.object.rotation.z += 0.48 * currentAim - (isLaserShooting ? recoilKick * 0.45 : 0);
            snapshot.object.rotation.y += targetSide * 1.45 * currentAim;
          }
        }
      }

      // Upper torso and helmet turn towards the target side when aiming
      if (torsoObj && currentAim > 0.001) {
        torsoObj.rotation.y = targetSide * 0.45 * currentAim;
        torsoObj.rotation.z = targetSide * 0.1 * currentAim;
      }
      if (helmetGroup && currentAim > 0.001) {
        helmetGroup.rotation.y = targetSide * 0.68 * currentAim;
        helmetGroup.rotation.x = -0.12 * currentAim;
      }
    }

    // Soft, continuous secondary motion keeps the rider from reading as a rigid mannequin.
    const breath = Math.sin(clock.elapsedTime * 1.65) * 0.007;
    if (torsoObj && torsoBaseScale) {
      torsoObj.scale.set(
        torsoBaseScale.x * (1 + breath * 0.24),
        torsoBaseScale.y * (1 + breath),
        torsoBaseScale.z * (1 + breath * 0.36),
      );
    }

    const motionVelocity = THREE.MathUtils.clamp(runtime.velocity / 0.72, 0, 1);
    if (!terminalScene) {
      const naturalHeadWeight = 1 - aimWeight.current;
      helmetGroup.position.y += Math.sin(clock.elapsedTime * 2.1) * 0.004 * naturalHeadWeight;
      helmetGroup.rotation.y += Math.sin(clock.elapsedTime * 0.62) * 0.026 * naturalHeadWeight;
      helmetGroup.rotation.z += (
        Math.sin(clock.elapsedTime * 1.45) * 0.012 - runtime.steer * 0.035
      ) * naturalHeadWeight;
    }

    ponytailRef.position.copy(ponytailBase);
    ponytailRef.position.y += Math.sin(clock.elapsedTime * 3.2) * (terminalScene ? 0.006 : 0.01);
    ponytailRef.rotation.z = (terminalScene ? 0.08 : 0.13)
      + Math.sin(clock.elapsedTime * (terminalScene ? 2.8 : 4.2)) * (0.045 + motionVelocity * 0.07);
    ponytailRef.rotation.y = Math.sin(clock.elapsedTime * 2.35) * (0.035 + motionVelocity * 0.04);
    ponytailRef.rotation.x = Math.cos(clock.elapsedTime * 2.75) * 0.018;

    if (scarfObj) {
      const scarfFlutter = Math.sin(clock.elapsedTime * (4.1 + motionVelocity * 2.2))
        * (terminalScene ? 0.05 : 0.025 + motionVelocity * 0.045);
      scarfObj.rotation.x += scarfFlutter;
    }

    if (runtime.resetApplied !== controller.rideReset) {
      runtime.progress = RIDE_START_PROGRESS;
      runtime.velocity = 0;
      runtime.acceleration = 0;
      runtime.lane = 0;
      runtime.steer = 0;
      runtime.wheelAngle = 0;
      runtime.touchSteer = 0;
      runtime.touchThrottle = false;
      runtime.touchBrake = false;
      runtime.gestureThrottle = 0;
      runtime.targetHit = false;
      runtime.telemetryElapsed = 0;
      runtime.hasLastPosition = false;
      runtime.resetApplied = controller.rideReset;
      runtime.stageApplied = controller.activeIndex;
      runtime.checkpointResetApplied = controller.checkpointReset;
      runtime.summitReported = false;
      finaleStartedAt.current = -1;
      shotFiredAt.current = -1;
      lastShotStage.current = -1;
      if (activeStop) controller.reportApproach(controller.activeIndex, 0, activeStop.distance - RIDE_START_DISTANCE);
      controller.reportVehicleSpeed(0);
    }

    if (runtime.checkpointResetApplied !== controller.checkpointReset && activeStop) {
      runtime.progress = THREE.MathUtils.clamp(activeStop.progress - 24 / ROAD_LENGTH, RIDE_START_PROGRESS, SUMMIT_PROGRESS);
      runtime.velocity = 0.28;
      runtime.acceleration = 0;
      runtime.lane = 0;
      runtime.steer = 0;
      runtime.touchSteer = 0;
      runtime.touchThrottle = false;
      runtime.touchBrake = false;
      runtime.targetHit = false;
      runtime.hasLastPosition = false;
      runtime.stageApplied = controller.activeIndex;
      runtime.checkpointResetApplied = controller.checkpointReset;
      controller.reportApproach(controller.activeIndex, 0.4, 24);
    }
    if (runtime.stageApplied !== controller.activeIndex) {
      runtime.targetHit = false;
      runtime.stageApplied = controller.activeIndex;
      runtime.hasLastPosition = false;
      runtime.summitReported = false;
      if (activeStop) {
        controller.reportApproach(
          controller.activeIndex,
          0,
          activeStop.distance - runtime.progress * ROAD_LENGTH,
        );
      }
    }

    const movingMode = ['riding', 'target', 'aiming', 'summit'].includes(controller.mode);
    const controlMode = ['riding', 'target', 'aiming', 'summit'].includes(controller.mode);
    if ((controller.mode === 'shot' || controller.mode === 'reading') && !controller.previewing) runtime.targetHit = true;

    const keyboardSteer = controlMode ? (runtime.right ? 1 : 0) - (runtime.left ? 1 : 0) : 0;
    const pointerSteer = controller.mode === 'riding' || controller.mode === 'summit' ? runtime.pointerX * 0.72 : 0;
    const touchSteer = controlMode ? runtime.touchSteer : 0;
    const desiredSteer = THREE.MathUtils.clamp(keyboardSteer + pointerSteer + touchSteer, -1, 1);
    runtime.steer = THREE.MathUtils.damp(runtime.steer, desiredSteer, 9.5, delta);

    runtime.gestureThrottle = THREE.MathUtils.damp(runtime.gestureThrottle, 0, 2.8, delta);
    const heldThrottle = controlMode && (runtime.forward || runtime.mouseThrottle || runtime.touchThrottle) ? 1 : 0;
    const braking = controlMode && (runtime.brake || runtime.touchBrake || runtime.gestureThrottle < -0.08);
    const throttle = Math.max(heldThrottle, controlMode ? Math.max(0, runtime.gestureThrottle) : 0);
    let desiredVelocity = movingMode ? CRUISE_SPEED + (1 - CRUISE_SPEED) * throttle : 0;

    if (controller.mode === 'aiming' && !runtime.targetHit) desiredVelocity = Math.min(desiredVelocity, AIM_CRAWL_SPEED);
    if (controller.mode === 'shot' || controller.mode === 'reading') desiredVelocity = 0;

    const currentDistance = runtime.progress * ROAD_LENGTH;
    const summitRemaining = SUMMIT_DISTANCE - currentDistance;
    let terminalBraking = false;
    if (controller.mode === 'summit') {
      const allTargetsHit = controller.completedCount === PORTFOLIO_STOPS.length;
      const maxVelocity = allTargetsHit ? 1.43 : 1;
      desiredVelocity = Math.max(0.52, Math.min(CRUISE_SPEED + (maxVelocity - CRUISE_SPEED) * throttle, maxVelocity));
      if (summitRemaining < 18) {
        const summitLimit = THREE.MathUtils.lerp(0.12, 0.58, THREE.MathUtils.clamp(summitRemaining / 18, 0, 1));
        desiredVelocity = Math.min(desiredVelocity, summitLimit);
      }
      if (summitRemaining <= 0.8) {
        desiredVelocity = 0;
        terminalBraking = true;
      }
    }
    if (braking || terminalBraking) desiredVelocity = 0;

    const previousVelocity = runtime.velocity;
    const velocityDelta = desiredVelocity - runtime.velocity;
    const accelerationRate = THREE.MathUtils.lerp(0.78, 0.42, Math.min(runtime.velocity, 1));
    const decelerationRate = braking || terminalBraking
      ? 2.2
      : controller.mode === 'aiming'
        ? 1.25
        : controller.mode === 'summit'
          ? 1.25
          : controller.mode === 'target'
            ? 0.62
            : 0.34;
    const velocityRate = velocityDelta >= 0 ? accelerationRate : decelerationRate;
    runtime.velocity += THREE.MathUtils.clamp(velocityDelta, -velocityRate * delta, velocityRate * delta);
    const accelerationSample = (runtime.velocity - previousVelocity) / Math.max(delta, 0.001);
    runtime.acceleration = THREE.MathUtils.damp(
      runtime.acceleration,
      THREE.MathUtils.clamp(accelerationSample, -1.8, 1.1),
      5.5,
      delta,
    );

    const timeScale = movingMode ? controller.speed : 0;
    let laneVelocity = 0;
    if (movingMode) {
      const lateralSpeed = Math.min(runtime.velocity, 1) * THREE.MathUtils.lerp(2.2, 4.2, Math.min(runtime.velocity, 1));
      laneVelocity = runtime.steer * lateralSpeed * timeScale;
      runtime.lane = THREE.MathUtils.clamp(
        runtime.lane + laneVelocity * delta,
        -MAX_LANE_OFFSET,
        MAX_LANE_OFFSET,
      );
    }

    const routeDistance = runtime.velocity * ROUTE_TOP_SPEED * delta * timeScale;
    let nextProgress = runtime.progress + routeDistance / ROAD_LENGTH;
    if (controller.mode === 'summit') nextProgress = Math.min(nextProgress, SUMMIT_PROGRESS);
    runtime.progress = THREE.MathUtils.clamp(nextProgress, RIDE_START_PROGRESS, SUMMIT_PROGRESS);

    if (activeStop && !runtime.targetHit && (controller.mode === 'riding' || controller.mode === 'target' || controller.mode === 'aiming')) {
      const distanceToTarget = activeStop.distance - runtime.progress * ROAD_LENGTH;
      const approach = THREE.MathUtils.clamp((32 - distanceToTarget) / 22, 0, 1);
      controller.reportApproach(controller.activeIndex, approach, distanceToTarget);

      // Target can only be shot from the front. The moment the bike reaches or passes the billboard (distanceToTarget <= 0.2m),
      // immediately exit slow-mo/aiming, keep engine sound roaring, and surge forward at full throttle.
      if ((controller.mode === 'aiming' || controller.mode === 'target') && distanceToTarget <= 0.2) {
        controller.bypassTarget();
      }
    }

    // Smooth continuous forward ride to summit ascent at progress >= 0.88
    if (
      runtime.progress >= 0.88
      && controller.mode !== 'summit'
      && controller.mode !== 'finale'
      && controller.mode !== 'countdown'
      && controller.mode !== 'intro'
    ) {
      controller.bypassTarget();
    }

    if (
      controller.mode === 'summit'
      && !runtime.summitReported
      && (summitRemaining <= 0.85 || (summitRemaining <= 4.0 && runtime.velocity <= 0.065))
    ) {
      runtime.summitReported = true;
      controller.reachFinale();
    }

    runtime.telemetryElapsed += delta;
    if (runtime.telemetryElapsed > 0.075) {
      runtime.telemetryElapsed = 0;
      controller.reportVehicleSpeed(runtime.velocity * timeScale);
    }

    // Direct menu playback uses the same summit staging as a naturally completed ride.
    const renderProgress = terminalScene ? SUMMIT_PROGRESS : runtime.progress;
    roadCurve.getPointAt(renderProgress, point);
    roadCurve.getTangentAt(renderProgress, tangent).normalize();
    side.set(-tangent.z, 0, tangent.x).normalize();
    point.addScaledVector(side, terminalScene ? 0 : runtime.lane);

    const distanceTravelled = !terminalScene && runtime.hasLastPosition ? point.distanceTo(runtime.lastPosition) : 0;
    runtime.lastPosition.copy(point);
    runtime.hasLastPosition = true;
    runtime.wheelAngle += distanceTravelled / WHEEL_RADIUS_WORLD;

    roadCurve.getTangentAt(Math.min(renderProgress + 0.012, 1), tangentAhead).normalize();
    const turnAngle = Math.atan2(
      tangent.z * tangentAhead.x - tangent.x * tangentAhead.z,
      THREE.MathUtils.clamp(tangent.dot(tangentAhead), -1, 1),
    );
    const curvature = turnAngle / (ROAD_LENGTH * 0.012);
    const actualSpeed = runtime.velocity * ROUTE_TOP_SPEED * timeScale;
    const curveLean = -Math.atan((actualSpeed * actualSpeed * curvature) / 9.81);
    const steeringLean = runtime.steer * runtime.velocity * (0.05 + runtime.velocity * 0.12);
    const leanTarget = terminalScene
      ? 0.085 * parkingStand
      : THREE.MathUtils.clamp(curveLean + steeringLean, -0.46, 0.46);

    heading
      .copy(tangent)
      .multiplyScalar(Math.max(actualSpeed, 0.25))
      .addScaledVector(side, laneVelocity)
      .normalize();
    frameSide.crossVectors(heading, worldUp).normalize();
    frameUp.crossVectors(frameSide, heading).normalize();
    frameMatrix.makeBasis(heading, frameUp, frameSide);
    pathQuaternion.setFromRotationMatrix(frameMatrix);

    if (bikeRoot.current) {
      bikeRoot.current.position.set(point.x, point.y + floorOffset, point.z);
      bikeRoot.current.quaternion.slerp(pathQuaternion, 1 - Math.exp(-delta * (10.5 + runtime.velocity * 3)));
    }

    if (visual.current) {
      visual.current.rotation.x = THREE.MathUtils.damp(visual.current.rotation.x, leanTarget, 6.8, delta);
      const pitchTarget = terminalScene ? 0 : THREE.MathUtils.clamp(runtime.acceleration * 0.052, -0.09, 0.055);
      const roadBuzz = terminalScene
        ? 0
        : (
          Math.sin(runtime.wheelAngle * 0.18)
          + Math.sin(runtime.wheelAngle * 0.43 + 1.7) * 0.48
        ) * runtime.velocity * 0.012;
      const suspensionCompression = terminalScene ? 0 : -Math.abs(runtime.acceleration) * 0.006;
      visual.current.rotation.z = THREE.MathUtils.damp(visual.current.rotation.z, pitchTarget, braking ? 11.5 : 6.2, delta);
      visual.current.position.y = THREE.MathUtils.damp(
        visual.current.position.y,
        roadBuzz + suspensionCompression,
        12.5,
        delta,
      );
    }
    const steeringAngle = terminalScene
      ? 0
      : -runtime.steer * THREE.MathUtils.lerp(0.28, 0.12, runtime.velocity);
    steeringGroup.rotation.y = THREE.MathUtils.damp(steeringGroup.rotation.y, steeringAngle, 11, delta);
    if (kickstand.current) {
      kickstand.current.rotation.x = THREE.MathUtils.lerp(-0.18, -0.42, parkingStand);
      kickstand.current.rotation.z = THREE.MathUtils.lerp(-1.35, 0, parkingStand);
    }
    if (rearWheel) rearWheel.rotation.z = -runtime.wheelAngle;
    if (frontWheel) frontWheel.rotation.z = -runtime.wheelAngle;

    // Synchronize bullet tracer and muzzle flash with the exact world position of the gun in her hand
    if (bikeRoot.current) bikeRoot.current.updateMatrixWorld(true);
    muzzleTip.getWorldPosition(muzzleWorldPos);

    if (muzzleFlash) {
      const flashOpacity = isLaserShooting ? Math.max(0, 1 - timeSinceShot * 4.5) : 0;
      (muzzleFlash.material as THREE.MeshBasicMaterial).opacity = flashOpacity;
      muzzleFlash.scale.setScalar(THREE.MathUtils.lerp(2.8, 0.4, THREE.MathUtils.clamp(timeSinceShot / 0.35, 0, 1)));
    }

    if (tracerImpact.current && isLaserShooting && activeStop) {
      const targetPose = getRoadsidePose(activeStop);
      const targetWorld = targetPose.position.clone();
      targetWorld.y += 0.05;

      tracerImpact.current.visible = true;
      tracerImpact.current.position.copy(targetWorld);
      const impactProgress = THREE.MathUtils.clamp(timeSinceShot / 0.42, 0, 1);
      const impactScale = THREE.MathUtils.lerp(0.8, 3.8, impactProgress);
      tracerImpact.current.scale.setScalar(impactScale);
      const fade = Math.max(0, 1 - impactProgress);
      (tracerImpact.current.material as THREE.MeshBasicMaterial).opacity = fade * 0.95;
    } else {
      if (tracerImpact.current) tracerImpact.current.visible = false;
    }

    const signFocus = activeStop
      ? getRoadsidePose(activeStop).position.clone().add(new THREE.Vector3(0, 0.25, 0))
      : point.clone().addScaledVector(tangent, 10);

    const speed01 = runtime.velocity;
    const focusTarget = controller.mode === 'target' || controller.mode === 'aiming' || controller.mode === 'shot';

    if (terminalScene) {
      // Beat 1: close parking shot while the kickstand deploys.
      const cam1Pos = summitPoint.clone().addScaledVector(summitTangent, -4.8).addScaledVector(summitSide, 3.2);
      cam1Pos.y = summitPoint.y + 1.85;
      const cam1Look = summitPoint.clone().addScaledVector(summitTangent, 0.8);
      cam1Look.y = summitPoint.y + 1.25;

      // Beat 2: pull out to the landscape and hold there.
      const cam4Pos = summitPoint.clone().addScaledVector(summitTangent, -10.5).addScaledVector(summitSide, 8.8);
      cam4Pos.y = summitPoint.y + 6.2;
      const cam4Look = sunPosition.clone();

      desiredCamera.lerpVectors(cam1Pos, cam4Pos, viewReveal);
      desiredLook.lerpVectors(cam1Look, cam4Look, viewReveal);
    } else {
      const isAiming = controller.mode === 'aiming' || controller.mode === 'shot';
      const isTarget = controller.mode === 'target';

      if (isAiming && activeStop) {
        // Dramatic close-up over-shoulder combat camera:
        // Positioned behind the rider, framing helmet, raised sidearm, and elevated target
        const stopSide = activeStop.side ?? -1;
        const cameraBack = 2.45;
        const cameraSide = -stopSide * 1.45;
        const cameraHeight = 1.85;
        desiredCamera.copy(point).addScaledVector(tangent, -(cameraBack - (braking ? 0.2 : 0))).addScaledVector(side, cameraSide);
        desiredCamera.y = point.y + cameraHeight - (braking ? 0.05 : 0);

        // Frame the sightline from weapon directly out to the elevated roadside billboard
        const aimCenter = signFocus.clone().lerp(point.clone().addScaledVector(tangent, 3.2), 0.2);
        desiredLook.copy(aimCenter);
      } else if (isTarget && activeStop) {
        const stopSide = activeStop.side ?? -1;
        const cameraBack = 3.8;
        const cameraSide = -stopSide * 1.75;
        const cameraHeight = 2.05;
        desiredCamera.copy(point).addScaledVector(tangent, -cameraBack).addScaledVector(side, cameraSide);
        desiredCamera.y = point.y + cameraHeight;
        desiredLook.copy(signFocus).lerp(point.clone().addScaledVector(tangent, 3.8), 0.22);
      } else {
        const lookAhead = THREE.MathUtils.lerp(5.5, 10.5, speed01);
        const cameraBack = THREE.MathUtils.lerp(7.6, 9.5, speed01);
        const cameraSide = THREE.MathUtils.lerp(1.5, 0.75, speed01);
        const cameraHeight = THREE.MathUtils.lerp(2.2, 2.65, speed01);
        desiredCamera.copy(point).addScaledVector(tangent, -(cameraBack - (braking ? 0.4 : 0))).addScaledVector(side, cameraSide);
        desiredCamera.y = point.y + cameraHeight - (braking ? 0.1 : 0);
        desiredLook.copy(point).addScaledVector(tangent, lookAhead).addScaledVector(side, runtime.steer * 0.35);
        desiredLook.y = point.y + 1.25 - runtime.pointerY * 0.2;
      }
    }

    const finaleCameraEntry = terminalScene && finaleElapsed < 0.45;
    const cameraRate = terminalScene
      ? finaleCameraEntry
        ? 22
        : THREE.MathUtils.lerp(5.0, 2.0, viewReveal)
      : (controller.mode === 'aiming' || controller.mode === 'shot')
        ? 6.8
        : 4.8;
    cameraBase.lerp(desiredCamera, 1 - Math.exp(-delta * cameraRate));
    const lookRate = finaleCameraEntry ? 22 : terminalScene ? 5.0 : 7.2;
    lookAt.lerp(desiredLook, 1 - Math.exp(-delta * lookRate));
    camera.position.copy(cameraBase);
    const modeShake = terminalScene ? 0 : focusTarget ? 0.08 : controller.mode === 'reading' ? 0.06 : 1;
    const shake = speed01 * speed01 * modeShake;
    const time = clock.elapsedTime;
    camera.position.addScaledVector(side, Math.sin(time * 18.7) * 0.035 * shake);
    camera.position.y += (Math.sin(time * 23.3) + Math.sin(time * 9.1) * 0.45) * 0.018 * shake;
    camera.lookAt(lookAt);

    // Subtle cinematic Dutch tilt during aiming / cornering
    if (!terminalScene) {
      const aimTilt = (controller.mode === 'aiming' || controller.mode === 'shot') ? -0.042 : 0;
      camera.rotation.z += aimTilt;
    }

    const perspective = camera as THREE.PerspectiveCamera;
    const desiredFov = terminalScene
      ? THREE.MathUtils.lerp(48, 46, THREE.MathUtils.smootherstep(finaleElapsed, 11.0, 14.5))
      : controller.mode === 'reading'
        ? 43
        : controller.mode === 'aiming' || controller.mode === 'shot'
          ? 44
          : controller.mode === 'target'
            ? 50
            : 49 + speed01 * 15 - (braking ? 2.5 : 0);
    perspective.fov += (desiredFov - perspective.fov) * (1 - Math.exp(-delta * (terminalScene ? 1.2 : braking ? 5.5 : 4.5)));
    perspective.updateProjectionMatrix();
  });

  return <>
    <group ref={bikeRoot}>
      <mesh
        position={[0, -floorOffset + 0.138, 0]}
        rotation={[-Math.PI / 2, 0, 0]}
        scale={[1.75, 0.48, 1]}
        renderOrder={1}
      >
        <circleGeometry args={[1, 40]} />
        <meshBasicMaterial
          color="#030708"
          transparent
          opacity={0.3}
          depthWrite={false}
          polygonOffset
          polygonOffsetFactor={-3}
        />
      </mesh>
      <group ref={visual} scale={BIKE_SCALE}>
        <primitive object={model} />
        <group ref={leftExhaustAnchor} position={[-1.43, 0.72, 0.29]} />
        <group ref={rightExhaustAnchor} position={[-1.43, 0.72, -0.29]} />
        <group ref={kickstand} position={[-0.45, 0.55, 0.34]} rotation={[-0.18, 0, -1.35]}>
          <mesh position={[0, -0.38, 0]} castShadow>
            <cylinderGeometry args={[0.035, 0.045, 0.76, 8]} />
            <meshStandardMaterial color="#202326" metalness={0.78} roughness={0.32} />
          </mesh>
          <mesh position={[0, -0.76, 0]} scale={[1.5, 0.35, 1]} castShadow>
            <sphereGeometry args={[0.08, 10, 8]} />
            <meshStandardMaterial color="#202326" metalness={0.78} roughness={0.32} />
          </mesh>
        </group>
      </group>
    </group>

    <ExhaustSmoke
      anchors={[leftExhaustAnchor, rightExhaustAnchor]}
      drive={drive}
      mode={controller.mode}
      lowQuality={lowQuality}
    />

    {/* Instant Target Hit Flash on Billboard Core */}
    <mesh ref={tracerImpact} visible={false}>
      <sphereGeometry args={[0.55, 24, 24]} />
      <meshBasicMaterial color="#fff3b0" transparent opacity={0.95} toneMapped={false} />
    </mesh>
  </>;
}

function createSignTexture(label: string, color: string, fontSize: number) {
  const canvas = document.createElement('canvas');
  canvas.width = 1536;
  canvas.height = 384;
  const context = canvas.getContext('2d');
  if (!context) return new THREE.Texture();
  context.clearRect(0, 0, canvas.width, canvas.height);
  context.fillStyle = color;
  context.font = '800 ' + fontSize + 'px Arial, sans-serif';
  context.textAlign = 'center';
  context.textBaseline = 'middle';
  context.letterSpacing = '14px';
  context.fillText(label, canvas.width / 2, canvas.height / 2 + 10);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.needsUpdate = true;
  return texture;
}

type TargetStatus = 'completed' | 'active' | 'upcoming';

function RouteTarget({
  stop: portfolioStop,
  status,
  mode,
  misses,
  missPulse,
  onShoot,
  onAimChange,
  onVulnerabilityChange,
}: {
  stop: PortfolioStop;
  status: TargetStatus;
  mode: RideState;
  misses: number;
  missPulse: number;
  onShoot: (confirmed?: boolean) => void;
  onAimChange: (value: boolean) => void;
  onVulnerabilityChange: (value: boolean) => void;
}) {
  const group = useRef<THREE.Group>(null);
  const board = useRef<THREE.Group>(null);
  const core = useRef<THREE.Group>(null);
  const phaseStartedAt = useRef(0);
  const previousMode = useRef<RideState>('intro');
  const vulnerableRef = useRef(false);
  const missKick = useRef(0);
  const [vulnerable, setVulnerable] = useState(false);
  const [showMiss, setShowMiss] = useState(false);
  const active = status === 'active';
  const pose = useMemo(() => getRoadsidePose(portfolioStop), [portfolioStop]);
  const titleTexture = useMemo(
    () => createSignTexture(portfolioStop.label, status === 'upcoming' ? '#879599' : '#f7ebd5', portfolioStop.label.length > 8 ? 120 : 155),
    [portfolioStop.label, status],
  );
  const subtitleTexture = useMemo(
    () => createSignTexture(status === 'completed' ? 'CHECKPOINT COMPLETE' : portfolioStop.signSubtitle, status === 'completed' ? '#f6c87a' : '#d4a065', 46),
    [portfolioStop.signSubtitle, status],
  );

  useEffect(() => () => {
    titleTexture.dispose();
    subtitleTexture.dispose();
  }, [titleTexture, subtitleTexture]);

  useEffect(() => {
    previousMode.current = 'intro';
    vulnerableRef.current = false;
    setVulnerable(false);
    setShowMiss(false);
    if (!active) {
      onAimChange(false);
      onVulnerabilityChange(false);
    }
  }, [active]);

  useEffect(() => {
    if (!active || missPulse <= 0) return;
    missKick.current = 1;
    setShowMiss(true);
    const timer = window.setTimeout(() => setShowMiss(false), 230);
    return () => window.clearTimeout(timer);
  }, [active, missPulse]);

  useFrame(({ clock }, delta) => {
    if (!group.current || !board.current) return;
    if (!active) {
      const settled = status === 'completed' ? -0.2 : 0;
      board.current.rotation.z = THREE.MathUtils.damp(board.current.rotation.z, settled, 5, delta);
      board.current.position.y = 0;
      return;
    }

    if (previousMode.current !== mode) {
      previousMode.current = mode;
      phaseStartedAt.current = clock.elapsedTime;
      if (mode !== 'aiming' && vulnerableRef.current) {
        vulnerableRef.current = false;
        setVulnerable(false);
        onVulnerabilityChange(false);
      }
      if (mode !== 'aiming') onAimChange(false);
    }

    const impact = mode === 'shot' || mode === 'reading' ? 1 : 0;
    missKick.current = Math.max(0, missKick.current - delta * 3.4);
    board.current.rotation.z += ((impact ? -0.38 : 0) - board.current.rotation.z) * (1 - Math.exp(-delta * 8));
    board.current.rotation.y = Math.sin(clock.elapsedTime * 47) * 0.085 * missKick.current;
    board.current.position.y = Math.sin(clock.elapsedTime * 2.4) * 0.025;

    if (!core.current) return;
    const aiming = mode === 'aiming';
    const phaseTime = Math.max(0, clock.elapsedTime - phaseStartedAt.current);
    const cycle = phaseTime % 2;
    const assist = misses >= 2;
    const nextVulnerable = aiming && cycle >= 0.62 && cycle < (assist ? 1.47 : 1.3);
    if (nextVulnerable !== vulnerableRef.current) {
      vulnerableRef.current = nextVulnerable;
      setVulnerable(nextVulnerable);
      onVulnerabilityChange(nextVulnerable);
    }

    const motionScale = assist ? 0.8 : 1;
    const targetX = aiming ? Math.sin(phaseTime * 1.65) * 0.72 * motionScale : 0;
    const targetY = aiming ? Math.sin(phaseTime * 2.3 + 0.65) * 0.38 * motionScale : 0;
    core.current.position.x = THREE.MathUtils.damp(core.current.position.x, targetX, 9, delta);
    core.current.position.y = THREE.MathUtils.damp(core.current.position.y, targetY, 9, delta);
    core.current.position.z = 0.18;
    core.current.rotation.z = phaseTime * (vulnerable ? 2.2 : 0.9);
    core.current.scale.setScalar(vulnerable ? 1.15 + Math.sin(clock.elapsedTime * 15) * 0.06 : 0.95 + Math.sin(clock.elapsedTime * 5) * 0.03);
  });

  const hit = (event: ThreeEvent<MouseEvent>) => {
    event.stopPropagation();
    if (active) onShoot(true);
  };
  const miss = (event: ThreeEvent<MouseEvent>) => {
    event.stopPropagation();
    if (active && mode === 'aiming') {
      onAimChange(false);
      onShoot(false);
    }
  };
  const lock = (event: ThreeEvent<PointerEvent>) => {
    event.stopPropagation();
    if (active && mode === 'aiming') onAimChange(true);
  };
  const unlock = (event: ThreeEvent<PointerEvent>) => {
    event.stopPropagation();
    if (active) onAimChange(false);
  };

  const assist = misses >= 2;
  const position: [number, number, number] = [pose.position.x, pose.position.y, pose.position.z];

  return <group ref={group} position={position} rotation={[0, pose.rotationY, 0]} scale={active ? 1.32 : 1.15}>
    <group ref={board}>
      {active && <mesh onClick={miss} position={[0, 0, 0.12]}>
        <planeGeometry args={[5.5, 3.2]} />
        <meshBasicMaterial transparent opacity={0} depthWrite={false} />
      </mesh>}
      <mesh castShadow receiveShadow>
        <boxGeometry args={[5.2, 2.9, 0.22]} />
        <meshStandardMaterial
          color={status === 'completed' ? '#4f4a39' : status === 'active' ? '#132127' : '#1e2c31'}
          metalness={0.55}
          roughness={0.32}
          transparent={status === 'upcoming'}
          opacity={status === 'upcoming' ? 0.82 : 1}
        />
      </mesh>
      <mesh position={[0, 0.82, 0.14]}>
        <planeGeometry args={[4.4, 0.85]} />
        <meshBasicMaterial map={titleTexture} transparent depthWrite={false} />
      </mesh>
      <mesh position={[0, -0.92, 0.14]}>
        <planeGeometry args={[4.4, 0.42]} />
        <meshBasicMaterial map={subtitleTexture} transparent depthWrite={false} />
      </mesh>

      {active ? <group ref={core} position={[0, 0, 0.22]}>
        {/* High-contrast dark circular backing plate so the glowing rings pop out intensely */}
        <mesh position={[0, 0, -0.04]}>
          <circleGeometry args={[1.05, 32]} />
          <meshStandardMaterial color="#080e12" metalness={0.8} roughness={0.2} />
        </mesh>

        {/* Interactive Pointer/Click Zone */}
        <mesh position={[0, 0, 0.1]} onClick={hit} onPointerOver={lock} onPointerMove={lock} onPointerOut={unlock}>
          <circleGeometry args={[assist ? 0.95 : 0.85, 32]} />
          <meshBasicMaterial transparent opacity={0} depthWrite={false} />
        </mesh>

        {/* Large Outer Glowing Bullseye Ring */}
        <mesh scale={vulnerable ? 1.2 : 1.0}>
          <torusGeometry args={[0.78, 0.085, 16, 48]} />
          <meshStandardMaterial
            color={vulnerable ? '#ffe259' : '#ff3b30'}
            emissive={vulnerable ? '#ffaa00' : '#cc1100'}
            emissiveIntensity={vulnerable ? 5.5 : 2.5}
            metalness={0.6}
            roughness={0.15}
          />
        </mesh>

        {/* Inner Glowing Core Ring */}
        <mesh scale={vulnerable ? 1.15 : 0.92}>
          <torusGeometry args={[0.45, 0.07, 16, 48]} />
          <meshStandardMaterial
            color={vulnerable ? '#ffffff' : '#ff7755'}
            emissive={vulnerable ? '#ffdd44' : '#ff2211'}
            emissiveIntensity={vulnerable ? 6.0 : 2.8}
            metalness={0.4}
            roughness={0.1}
          />
        </mesh>

        {/* Center Glowing Bullseye Core Disc */}
        <mesh position={[0, 0, 0.04]}>
          <circleGeometry args={[0.24, 32]} />
          <meshStandardMaterial
            color={vulnerable ? '#fffce0' : '#8a1f18'}
            emissive={vulnerable ? '#ffcc00' : '#ff3322'}
            emissiveIntensity={vulnerable ? 6.5 : 2.0}
            roughness={0.1}
          />
        </mesh>

        {/* Dynamic Diamond Pulse Target Frame */}
        <mesh rotation={[0, 0, Math.PI / 4]} scale={vulnerable ? 1.25 : 0.95}>
          <torusGeometry args={[0.95, 0.04, 8, 4]} />
          <meshBasicMaterial color={vulnerable ? '#fff6c7' : '#ff5544'} transparent opacity={vulnerable ? 0.95 : 0.65} toneMapped={false} />
        </mesh>
      </group> : <group position={[0, 0, 0.22]}>
        <mesh><torusGeometry args={[0.62, 0.06, 12, 36]} /><meshStandardMaterial color={status === 'completed' ? '#f5c978' : '#5e6e73'} emissive={status === 'completed' ? '#a36825' : '#19292e'} emissiveIntensity={status === 'completed' ? 2.5 : 0.4} /></mesh>
        <mesh><circleGeometry args={[0.25, 28]} /><meshBasicMaterial color={status === 'completed' ? '#ffe0a2' : '#48585d'} /></mesh>
      </group>}

      <mesh position={[-1.85, -3.7, 0]} castShadow>
        <cylinderGeometry args={[0.12, 0.15, 5.2, 12]} />
        <meshStandardMaterial color="#3a4145" metalness={0.78} roughness={0.35} />
      </mesh>
      <mesh position={[1.85, -3.7, 0]} castShadow>
        <cylinderGeometry args={[0.12, 0.15, 5.2, 12]} />
        <meshStandardMaterial color="#3a4145" metalness={0.78} roughness={0.35} />
      </mesh>
    </group>
    {active && (mode === 'shot' || mode === 'reading') && <Sparkles count={110} scale={[5.5, 3.2, 1.8]} size={4.5} speed={1.2} color="#ffb65e" />}
    {active && showMiss && mode === 'aiming' && <Sparkles key={missPulse} count={32} scale={[3.8, 2.4, 1.2]} size={2.8} speed={1.8} color="#ef4e38" />}
    {active && <pointLight color={vulnerable ? '#ffd47b' : '#ff5944'} intensity={vulnerable ? 16 : mode === 'aiming' ? 7 : 3.5} distance={16} />}
  </group>;
}

function Scene({ controller, drive, lowQuality }: { controller: RideController; drive: DriveRef; lowQuality: boolean }) {
  const isFinale = controller.mode === 'finale';
  return <>
    <color attach="background" args={[isFinale ? '#cc6c48' : '#657d8b']} />
    <fog attach="fog" args={[isFinale ? '#8c483a' : '#708592', isFinale ? 18 : 26, isFinale ? 340 : 175]} />
    <ambientLight intensity={isFinale ? 1.15 : 0.82} color={isFinale ? '#f8b496' : '#8cb7cc'} />
    <hemisphereLight args={[isFinale ? '#f8be8c' : '#9fc6da', isFinale ? '#3c1e28' : '#263a31', isFinale ? 1.45 : 1.25]} />
    <directionalLight position={[-38, 48, 410]} color={isFinale ? '#ffa45a' : '#ffc37c'} intensity={isFinale ? 4.2 : 3.1} castShadow shadow-mapSize={lowQuality ? 512 : 1024} shadow-bias={-0.00025} />
    <pointLight position={[3, 5, -70]} color="#ff8158" intensity={2.2} distance={18} />
    <Sky distance={450000} sunPosition={isFinale ? [-28, 12, 140] : [-20, 22, 120]} inclination={isFinale ? 0.58 : 0.46} azimuth={0.18} turbidity={isFinale ? 7.4 : 5.2} rayleigh={isFinale ? 2.1 : 1.2} mieCoefficient={0.008} mieDirectionalG={0.84} />
    <Atmosphere />
    <Terrain />
    <Road lowQuality={lowQuality} />
    <TreeField count={lowQuality ? 58 : 126} />
    <SummitVista />
    <Sparkles
      position={[0, 22, 230]}
      count={lowQuality ? 48 : 125}
      scale={[70, 42, 690]}
      size={2.5}
      speed={0.25 + controller.vehicleSpeed * 1.45}
      opacity={0.5}
      color="#f8d7a5"
      noise={2.4}
    />
    {isFinale && <Sparkles
      position={[32, 28, 780]}
      count={lowQuality ? 60 : 140}
      scale={[48, 24, 48]}
      size={4.8}
      speed={0.35}
      opacity={0.85}
      color="#ffd67d"
      noise={1.8}
    />}
    <RideRig controller={controller} drive={drive} lowQuality={lowQuality} />
    {PORTFOLIO_STOPS.map((portfolioStop, index) => {
      const status: TargetStatus = controller.completedStops.includes(index)
        ? 'completed'
        : index === controller.activeIndex
          ? 'active'
          : 'upcoming';
      const activeMode = index === controller.activeIndex && !controller.previewing ? controller.mode : 'riding';
      const effectiveStop = getEffectiveStop(index, controller.stopDistances) ?? portfolioStop;
      return <RouteTarget
        key={portfolioStop.id}
        stop={effectiveStop}
        status={status}
        mode={activeMode}
        misses={index === controller.activeIndex ? controller.misses : 0}
        missPulse={index === controller.activeIndex ? controller.missPulse : 0}
        onShoot={controller.shoot}
        onAimChange={controller.setAimLocked}
        onVulnerabilityChange={controller.setTargetVulnerable}
      />;
    })}
    <EffectComposer multisampling={0} enabled={!lowQuality}>
      <Bloom intensity={controller.mode === 'finale' ? 0.58 : 0.44} luminanceThreshold={0.84} luminanceSmoothing={0.38} mipmapBlur />
      <Vignette eskil={false} offset={0.24} darkness={controller.mode === 'finale' ? 0.48 : 0.68} />
      <SMAA />
    </EffectComposer>
  </>;
}

function SectionPanel({ controller }: { controller: RideController }) {
  const portfolioStop = controller.panelStop;
  if (!portfolioStop) return null;
  const actionLabel = controller.previewing
    ? controller.previewReturnMode === 'finale' ? 'CLOSE DETAILS' : 'RETURN TO RIDE'
    : portfolioStop.id === 'contact'
      ? 'RIDE TO SUMMIT'
      : 'CONTINUE RIDE';

  return <motion.section
    className="skills-overlay"
    initial={{ opacity: 0, y: 26 }}
    animate={{ opacity: 1, y: 0 }}
    exit={{ opacity: 0, y: 18 }}
    transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
    aria-labelledby={'section-' + portfolioStop.id}
  >
    <div className="skills-heading">
      <p>{portfolioStop.number} / { portfolioStop.eyebrow}</p>
      <h2 id={'section-' + portfolioStop.id}>{portfolioStop.heading[0]}<br /><em>{portfolioStop.heading[1]}</em></h2>
      <span>{controller.previewing ? 'Quick view - route progress is unchanged' : 'GOING THROUGH THE RIDE'}</span>
      <p className="section-note">{portfolioStop.note}</p>
    </div>
    <div className={'skills-columns group-count-' + portfolioStop.groups.length}>
      {portfolioStop.groups.map((group) => <article key={group.label}>
        <b>{group.label}</b>
        <p>{group.lines.map((line, index) => <span key={line}>{line}{index < group.lines.length - 1 && <br />}</span>)}</p>
        {group.links && <div className="skills-links">
          {group.links.map((link) => {
            const opensNewTab = link.href.startsWith('http');
            return <a key={link.href} href={link.href} target={opensNewTab ? '_blank' : undefined} rel={opensNewTab ? 'noreferrer' : undefined}>{link.label} <span aria-hidden="true">?</span></a>;
          })}
        </div>}
      </article>)}
    </div>
    <div className="skills-footer">
      <span>{controller.previewing ? 'MENU VIEW / NO CHECKPOINT SKIPPED' : portfolioStop.id === 'contact' ? 'ALL CHECKPOINTS COMPLETE' : 'NEXT TARGET IS WAITING'}</span>
      <button type="button" onClick={controller.continueRide}>{actionLabel} <b>↗</b></button>
    </div>
  </motion.section>;
}

type TouchPoint = { active: boolean; x: number; y: number; braking: boolean };

const IDLE_TOUCH: TouchPoint = { active: false, x: 0, y: 0, braking: false };

function getCircularTouchPoint(event: ReactPointerEvent<HTMLButtonElement>) {
  const rect = event.currentTarget.getBoundingClientRect();
  const radius = Math.max(1, rect.width * 0.31);
  let x = event.clientX - (rect.left + rect.width / 2);
  let y = event.clientY - (rect.top + rect.height / 2);
  const distance = Math.hypot(x, y);
  if (distance > radius) {
    const scale = radius / distance;
    x *= scale;
    y *= scale;
  }
  return { x: x / radius, y: y / radius };
}

function TouchDriveControls({ drive }: { drive: DriveRef }) {
  const [steeringTouch, setSteeringTouch] = useState<TouchPoint>(IDLE_TOUCH);
  const [throttleTouch, setThrottleTouch] = useState<TouchPoint>(IDLE_TOUCH);
  const steeringPointer = useRef<number | null>(null);
  const throttlePointer = useRef<number | null>(null);
  const throttleOriginY = useRef<number | null>(null);

  const updateSteering = (event: ReactPointerEvent<HTMLButtonElement>) => {
    if (steeringPointer.current !== event.pointerId) return;
    const point = getCircularTouchPoint(event);
    const magnitude = Math.abs(point.x);
    const steer = magnitude < 0.08
      ? 0
      : Math.sign(point.x) * ((magnitude - 0.08) / 0.92);
    drive.current.touchSteer = THREE.MathUtils.clamp(steer, -1, 1);
    setSteeringTouch({ active: true, ...point, braking: false });
  };

  const startSteering = (event: ReactPointerEvent<HTMLButtonElement>) => {
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    steeringPointer.current = event.pointerId;
    event.currentTarget.setPointerCapture(event.pointerId);
    updateSteering(event);
  };

  const releaseSteering = (event?: ReactPointerEvent<HTMLButtonElement>) => {
    if (event && steeringPointer.current !== event.pointerId) return;
    steeringPointer.current = null;
    drive.current.touchSteer = 0;
    setSteeringTouch(IDLE_TOUCH);
  };

  const updateThrottle = (event: ReactPointerEvent<HTMLButtonElement>, allowBrake = true) => {
    if (throttlePointer.current !== event.pointerId) return;
    const point = getCircularTouchPoint(event);
    const rect = event.currentTarget.getBoundingClientRect();
    const dragDistance = event.clientY - (throttleOriginY.current ?? event.clientY);
    const braking = allowBrake && dragDistance > rect.height * 0.22;
    drive.current.touchThrottle = !braking;
    drive.current.touchBrake = braking;
    setThrottleTouch({ active: true, ...point, braking });
  };

  const startThrottle = (event: ReactPointerEvent<HTMLButtonElement>) => {
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    throttlePointer.current = event.pointerId;
    throttleOriginY.current = event.clientY;
    event.currentTarget.setPointerCapture(event.pointerId);
    updateThrottle(event, false);
  };

  const releaseThrottle = (event?: ReactPointerEvent<HTMLButtonElement>) => {
    if (event && throttlePointer.current !== event.pointerId) return;
    throttlePointer.current = null;
    throttleOriginY.current = null;
    drive.current.touchThrottle = false;
    drive.current.touchBrake = false;
    setThrottleTouch(IDLE_TOUCH);
  };

  useEffect(() => {
    const resetControls = () => {
      steeringPointer.current = null;
      throttlePointer.current = null;
      throttleOriginY.current = null;
      drive.current.touchSteer = 0;
      drive.current.touchThrottle = false;
      drive.current.touchBrake = false;
      setSteeringTouch(IDLE_TOUCH);
      setThrottleTouch(IDLE_TOUCH);
    };
    const onVisibilityChange = () => {
      if (document.hidden) resetControls();
    };
    window.addEventListener('blur', resetControls);
    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => {
      window.removeEventListener('blur', resetControls);
      document.removeEventListener('visibilitychange', onVisibilityChange);
      drive.current.touchSteer = 0;
      drive.current.touchThrottle = false;
      drive.current.touchBrake = false;
    };
  }, [drive]);

  const steeringStyle = {
    '--touch-x': `${steeringTouch.x * 31}px`,
    '--touch-y': `${steeringTouch.y * 31}px`,
  } as CSSProperties;
  const throttleStyle = {
    '--touch-x': `${throttleTouch.x * 25}px`,
    '--touch-y': `${throttleTouch.y * 25}px`,
  } as CSSProperties;

  return <div className="mobile-touch-controls" aria-label="Touch motorcycle controls">
    <div className="touch-control-group touch-navigation">
      <span>NAVIGATION</span>
      <button
        className={'touch-control-ring' + (steeringTouch.active ? ' is-active' : '')}
        style={steeringStyle}
        type="button"
        aria-label="Drag the navigation circle left or right to steer"
        aria-pressed={steeringTouch.active}
        onPointerDown={startSteering}
        onPointerMove={updateSteering}
        onPointerUp={releaseSteering}
        onPointerCancel={releaseSteering}
        onLostPointerCapture={releaseSteering}
        onContextMenu={(event) => event.preventDefault()}
      >
        <i className="touch-control-guide" aria-hidden="true" />
        <b className="touch-control-thumb"><em>DRAG</em></b>
        <small>LEFT / RIGHT</small>
      </button>
    </div>

    <div className="touch-control-group touch-acceleration">
      <span>{throttleTouch.braking ? 'BRAKING' : 'ACCELERATION'}</span>
      <button
        className={'touch-control-ring touch-throttle' + (throttleTouch.active ? ' is-active' : '') + (throttleTouch.braking ? ' is-braking' : '')}
        style={throttleStyle}
        type="button"
        aria-label="Hold the acceleration circle to speed up; drag down to brake"
        aria-pressed={throttleTouch.active}
        onPointerDown={startThrottle}
        onPointerMove={updateThrottle}
        onPointerUp={releaseThrottle}
        onPointerCancel={releaseThrottle}
        onLostPointerCapture={releaseThrottle}
        onContextMenu={(event) => event.preventDefault()}
      >
        <i className="touch-control-guide" aria-hidden="true" />
        <b className="touch-control-thumb"><em>{throttleTouch.braking ? 'BRAKE' : throttleTouch.active ? 'GO' : 'HOLD'}</em></b>
        <small>{throttleTouch.braking ? 'RELEASE TO COAST' : 'PULL DOWN / BRAKE'}</small>
      </button>
    </div>
  </div>;
}

function Hud({ controller, drive }: { controller: RideController; drive: DriveRef }) {
  const { mode, countdown, vehicleSpeed, targetDistance, misses, aimLocked, targetVulnerable, mute, audioReady, setMute, activeStop, begin, shoot } = controller;
  const [menuOpen, setMenuOpen] = useState(false);
  const [showFinale, setShowFinale] = useState(false);

  useEffect(() => {
    if (mode === 'finale') {
      if (showFinale) return;
      const timer = window.setTimeout(() => setShowFinale(true), 3800);
      return () => window.clearTimeout(timer);
    }
    if (!(mode === 'reading' && controller.previewing && controller.previewReturnMode === 'finale')) {
      setShowFinale(false);
    }
  }, [mode, controller.previewing, controller.previewReturnMode, showFinale]);

  const driving = mode === 'riding' || mode === 'target' || mode === 'aiming' || mode === 'summit';
  const playState = mode === 'intro' ? 'READY' : mode === 'countdown' ? 'START' : mode === 'finale' ? 'FINALE' : mode === 'summit' ? 'SUMMIT' : mode === 'reading' ? 'READING' : mode === 'shot' ? 'HIT' : 'CRUISE';
  const targetStatus = mode === 'shot'
    ? 'TARGET UNLOCKED'
    : mode === 'aiming'
      ? (targetVulnerable ? 'VULNERABLE — FIRE SIDEARM' : 'SHIELD ROTATING — HOLD AIM')
      : 'TARGET DETECTED';
  const routeLabel = mode === 'finale'
    ? 'COMPLETE'
    : mode === 'summit'
      ? 'FINAL ASCENT'
      : activeStop?.label ?? 'SUMMIT';
  const routeNumber = mode === 'finale' || mode === 'summit' ? '06' : activeStop?.number ?? '06';
  const journeyComplete = controller.completedCount === PORTFOLIO_STOPS.length;
  const desktopInstruction = mode === 'riding'
    ? 'FULL THROTTLE W / UP ARROW / HOLD MOUSE / A D TO LEAN / S TO BRAKE'
    : mode === 'target'
      ? 'TARGET AHEAD / MAINTAIN SPEED / SLOW-MO AT CLOSE RANGE'
      : mode === 'aiming'
        ? 'TRACK THE MOVING CORE / GOLD = FIRE / RED = WAIT'
        : 'FINAL ASCENT / REACH THE OVERLOOK TO COMPLETE THE JOURNEY';
  const touchInstruction = mode === 'riding'
    ? 'DRAG LEFT CIRCLE TO STEER / HOLD RIGHT CIRCLE TO ACCELERATE'
    : mode === 'target'
      ? 'KEEP HOLDING ACCELERATE / TARGET AHEAD'
      : mode === 'aiming'
        ? 'TAP FIRE WHEN GOLD / DRAG LEFT TO STAY ON LINE'
        : 'HOLD ACCELERATE / DRAG LEFT TO REACH THE OVERLOOK';

  const restartJourney = () => {
    setMenuOpen(false);
    setShowFinale(false);
    begin();
  };

  const hold = (control: 'forward' | 'brake' | 'left' | 'right', active: boolean) => {
    drive.current[control] = active;
  };

  return <div className="ride-ui">
    <header className="ride-header">
      <button className="ride-mark" type="button" onClick={() => window.location.reload()} aria-label="Restart experience"><span>AR</span><i>APOORVA RAWAT</i></button>
      <div className="header-actions">
        <button
          className={'sound-button' + (mute ? ' is-muted' : !audioReady ? ' is-pending' : '')}
          type="button"
          onClick={() => {
            if (!audioReady) setMute(false);
            else setMute(!mute);
          }}
          aria-label={!audioReady ? 'Enable background music and bike engine' : mute ? 'Turn on background music and bike engine' : 'Mute background music and bike engine'}
          aria-pressed={audioReady && !mute}
          title="Background music and bike engine"
        >
          {mute ? 'AUDIO OFF' : audioReady ? 'AUDIO ON' : 'AUDIO READY'} <span aria-hidden="true">{audioReady && !mute ? '●' : '○'}</span>
        </button>
        <button className="menu-button-3d" type="button" onClick={() => setMenuOpen((value) => !value)} aria-expanded={menuOpen}>MENU <b>+</b></button>
      </div>
    </header>

    <AnimatePresence>{menuOpen && <motion.nav className="route-menu" initial={{ opacity: 0, y: -14 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -14 }} aria-label="Portfolio navigation">
      <div><span>DIRECT ACCESS / {controller.completedCount} OF {PORTFOLIO_STOPS.length}</span><button type="button" onClick={() => setMenuOpen(false)} aria-label="Close menu">x</button></div>
      {PORTFOLIO_STOPS.map((portfolioStop, index) => {
        const complete = controller.completedStops.includes(index);
        const active = index === controller.activeIndex && mode !== 'summit' && mode !== 'finale';
        const selected = controller.previewing && controller.panelStop?.id === portfolioStop.id;
        const rideInProgress = mode !== 'finale' && mode !== 'intro';
        const disabled = rideInProgress && !active && !selected;
        return <button
          key={portfolioStop.id}
          className={[complete && 'is-complete', (active || selected) && 'is-active', disabled && 'is-disabled'].filter(Boolean).join(' ')}
          type="button"
          aria-current={selected ? 'page' : undefined}
          disabled={disabled}
          onClick={() => {
            if (disabled) return;
            setMenuOpen(false);
            controller.openSection(index);
          }}
        >
          <span>{portfolioStop.number} / {portfolioStop.label}</span>
          <i className="route-menu-status">{selected ? 'VIEWING' : complete ? (mode === 'finale' ? 'VIEW DETAILS' : 'UNLOCKED') : active ? 'ON ROUTE' : rideInProgress ? 'LOCKED' : 'VIEW DETAILS'}</i>
        </button>;
      })}
      <button
        className={mode === 'finale' && !controller.previewing ? 'is-active' : ''}
        type="button"
        disabled={mode !== 'finale' && mode !== 'intro'}
        onClick={() => {
          setMenuOpen(false);
          controller.openFinale();
        }}
      >
        <span>★ / SUMMIT FINALE</span>
        <i className="route-menu-status">{mode === 'finale' ? (controller.previewing ? 'BACK TO SUMMIT' : 'ACTIVE') : 'PLAY FINALE'}</i>
      </button>
      <button className="route-menu-restart" type="button" onClick={restartJourney}>
        <span>↺ / RESTART JOURNEY</span>
        <i className="route-menu-status">FROM START</i>
      </button>
    </motion.nav>}</AnimatePresence>

    <div className="route-rail" aria-label={'Route progress: ' + controller.completedCount + ' of ' + PORTFOLIO_STOPS.length}>
      <span>ROUTE</span><span className="route-count">{controller.completedCount} / {PORTFOLIO_STOPS.length}</span><i /><b>{routeNumber}</b><em>{routeLabel}</em>
    </div>
    <div className="speed-cluster"><span>{playState}</span><strong>{Math.round(vehicleSpeed * 210).toString().padStart(3, '0')}</strong><small>KM/H</small></div>
    <div className="scene-caption"><span>{mode === 'finale' ? 'HIMALAYAN OVERLOOK' : 'ALPINE REDLINE'}</span><b>{mode === 'summit' || mode === 'finale' ? 'SUMMIT ROUTE / 3D PANORAMA' : 'FULL 3D RIDE / SIX CHECKPOINTS'}</b></div>

    {driving && <div className="drive-controls-mobile" aria-label="Motorcycle drive and action controls">
      <div className="drive-pad" aria-label="Motorcycle steering and throttle pad">
        <span>DRIVE</span>
        <button className="drive-up" type="button" aria-label="Accelerate" onPointerDown={(event) => { event.preventDefault(); hold('forward', true); }} onPointerUp={() => hold('forward', false)} onPointerCancel={() => hold('forward', false)} onPointerLeave={() => hold('forward', false)}>↑<i>W</i></button>
        <button className="drive-left" type="button" aria-label="Steer left" onPointerDown={(event) => { event.preventDefault(); hold('left', true); }} onPointerUp={() => hold('left', false)} onPointerCancel={() => hold('left', false)} onPointerLeave={() => hold('left', false)}>←<i>A</i></button>
        <button className="drive-down" type="button" aria-label="Brake" onPointerDown={(event) => { event.preventDefault(); hold('brake', true); }} onPointerUp={() => hold('brake', false)} onPointerCancel={() => hold('brake', false)} onPointerLeave={() => hold('brake', false)}>↓<i>S</i></button>
        <button className="drive-right" type="button" aria-label="Steer right" onPointerDown={(event) => { event.preventDefault(); hold('right', true); }} onPointerUp={() => hold('right', false)} onPointerCancel={() => hold('right', false)} onPointerLeave={() => hold('right', false)}>→<i>D</i></button>
      </div>

      <TouchDriveControls drive={drive} />

      {(mode === 'target' || mode === 'aiming') && <div className="fire-pad" aria-label="Fire weapon at target">
        <button
          className={'fire-trigger-btn' + (targetVulnerable ? ' is-vulnerable' : '')}
          type="button"
          aria-label="Fire sidearm"
          onClick={() => shoot(true)}
        >
          <span>{targetVulnerable ? 'FIRE NOW' : 'TARGET'}</span>
          <i>🎯</i>
        </button>
      </div>}
    </div>}

    <AnimatePresence>
      {mode === 'intro' && <motion.section className="entry-screen" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
        <p>APOORVA RAWAT PORTFOLIO</p>
        <h1>RIDE<br /><em>WHAT'S NEXT.</em></h1>
        <div><span>Six targets. One high-speed Himalayan ascent.</span><button type="button" onClick={begin}>TAKE THE RIDE <b>↗</b></button></div>
        <small>AUDIO STARTS ON ENTRY / HOLD W / ↑ FOR FULL THROTTLE / A D TO STEER / S TO BRAKE</small>
      </motion.section>}

      {mode === 'countdown' && <motion.section className="countdown-overlay" key={countdown} initial={{ opacity: 0, scale: 0.78, filter: 'blur(14px)' }} animate={{ opacity: 1, scale: 1, filter: 'blur(0px)' }} exit={{ opacity: 0, scale: 1.14, filter: 'blur(8px)' }} transition={{ duration: 0.16 }}>
        <span>IGNITION / {countdown === 0 ? 'ENGINE ROAR' : 'SYSTEM CHECK'}</span>
        <strong>{String(countdown).padStart(2, '0')}</strong>
        <i>{countdown <= 3 ? 'RIDER CONTROL ONLINE' : 'MOUNTAIN DRIVE'}</i>
      </motion.section>}

      {activeStop && (mode === 'target' || mode === 'aiming' || mode === 'shot') && <motion.section
        className={'target-readout' + (targetVulnerable ? ' is-open' : '') + (aimLocked ? ' is-locked' : '')}
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0 }}
      >
        <span aria-live="polite">{targetStatus}</span>
        <h2>{activeStop.label}</h2>
        <div>
          <i>{mode === 'shot' ? '✦' : targetVulnerable ? '◉' : '◎'}</i>
          <b>{mode === 'shot'
            ? 'SYSTEM UNLOCKING'
            : mode === 'aiming'
              ? (targetVulnerable ? 'GOLD WINDOW' : 'TRACK CORE') + ' / ' + misses + ' MISS' + (misses === 1 ? '' : 'ES')
              : targetDistance + 'M'}</b>
        </div>
        {mode === 'target' && <small className="target-prompt">TARGET AHEAD / MAINTAIN SPEED / SLOW-MO AT CLOSE RANGE</small>}
        {mode === 'aiming' && <button type="button" aria-label="Fire when the moving core turns gold" onClick={() => shoot(true)}>{targetVulnerable ? 'FIRE NOW / SPACE' : 'WAIT FOR GOLD / SPACE'}</button>}
        {mode === 'aiming' && misses >= 2 && <small className="aim-assist">AIM CALIBRATED</small>}
      </motion.section>}

      {(mode === 'reading' || (mode === 'finale' && controller.previewing)) && <SectionPanel key={controller.panelStop?.id ?? 'section'} controller={controller} />}

      {mode === 'finale' && !controller.previewing && !showFinale && <motion.p className="finale-sequence" initial={{ opacity: 0 }} animate={{ opacity: 1 }}>KICKSTAND DOWN / SUMMIT VIEW</motion.p>}

      {mode === 'finale' && !controller.previewing && showFinale && <motion.section
        className="finale-overlay"
        initial={{ opacity: 0, y: 24 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: 18 }}
        transition={{ duration: 0.55, ease: [0.16, 1, 0.3, 1] }}
        aria-labelledby="finale-title"
      >
        <p className="finale-kicker">{journeyComplete ? 'JOURNEY COMPLETE / ' + PORTFOLIO_STOPS.length + ' CHECKPOINTS' : 'SUMMIT PREVIEW / DIRECT ACCESS'}</p>
        <h2 id="finale-title">JUST THE END.<br /><em>RIDE STILL GOING ON.</em></h2>
        <p className="finale-copy">{journeyComplete
          ? 'Every portfolio card is unlocked. Open the menu and choose any card to revisit it.'
          : 'Explore any portfolio card from the menu, or restart the journey and unlock every checkpoint on the road.'}</p>
        <div className="finale-actions">
          <button className="finale-menu-action" type="button" onClick={() => setMenuOpen(true)}>EXPLORE CARDS <b>+</b></button>
          <button type="button" onClick={restartJourney}>RESTART JOURNEY <b>↺</b></button>
        </div>
      </motion.section>}
    </AnimatePresence>

    {(mode === 'target' || mode === 'aiming') && <div className={'crosshair-3d' + (targetVulnerable && aimLocked ? ' is-hot' : '')} aria-hidden="true"><i /></div>}
    {driving && <p className="ride-instruction" aria-label={desktopInstruction} data-touch-instruction={touchInstruction}>{mode === 'riding'
      ? 'FULL THROTTLE W / ↑ / HOLD MOUSE / A D TO LEAN / S TO BRAKE'
      : mode === 'target'
        ? 'TARGET AHEAD / MAINTAIN SPEED / SLOW-MO AT CLOSE RANGE'
        : mode === 'aiming'
          ? 'TRACK THE MOVING CORE / GOLD = FIRE / RED = WAIT'
          : 'FINAL ASCENT / REACH THE OVERLOOK TO COMPLETE THE JOURNEY'}</p>}
  </div>;
}

export default function CinematicRide() {
  const controller = useRideController();
  const drive = useRef<DriveRuntime>(createDriveRuntime());
  const [lowQuality, setLowQuality] = useState(false);
  const isMobile = typeof window !== 'undefined' && window.matchMedia('(max-width: 720px), (pointer: coarse)').matches;
  const swipeY = useRef<number | null>(null);
  const swipePointer = useRef<number | null>(null);
  const canDrive = controller.mode === 'riding' || controller.mode === 'target' || controller.mode === 'aiming' || controller.mode === 'summit';

  const addGestureThrottle = (amount: number) => {
    drive.current.gestureThrottle = THREE.MathUtils.clamp(drive.current.gestureThrottle + amount, -1, 1);
  };

  useEffect(() => {
    const setControl = (event: KeyboardEvent, active: boolean) => {
      const target = event.target as HTMLElement | null;
      if (active && target?.closest('button, a, input, textarea, select, [contenteditable="true"]')) return;
      let handled = true;
      if (event.code === 'ArrowUp' || event.code === 'KeyW' || event.key === 'ArrowUp' || event.key === 'w' || event.key === 'W') drive.current.forward = active;
      else if (event.code === 'ArrowDown' || event.code === 'KeyS' || event.key === 'ArrowDown' || event.key === 's' || event.key === 'S') drive.current.brake = active;
      else if (event.code === 'ArrowLeft' || event.code === 'KeyA' || event.key === 'ArrowLeft' || event.key === 'a' || event.key === 'A') drive.current.left = active;
      else if (event.code === 'ArrowRight' || event.code === 'KeyD' || event.key === 'ArrowRight' || event.key === 'd' || event.key === 'D') drive.current.right = active;
      else handled = false;
      if (handled) event.preventDefault();
    };
    const releasePointer = () => {
      drive.current.mouseThrottle = false;
      swipeY.current = null;
      swipePointer.current = null;
    };
    const releaseControls = () => {
      drive.current.forward = false;
      drive.current.brake = false;
      drive.current.left = false;
      drive.current.right = false;
      drive.current.touchSteer = 0;
      drive.current.touchThrottle = false;
      drive.current.touchBrake = false;
      drive.current.gestureThrottle = 0;
      releasePointer();
    };
    const onKeyDown = (event: KeyboardEvent) => setControl(event, true);
    const onKeyUp = (event: KeyboardEvent) => setControl(event, false);
    const onVisibility = () => {
      if (document.hidden) releaseControls();
    };
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('pointerup', releasePointer);
    window.addEventListener('blur', releaseControls);
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('pointerup', releasePointer);
      window.removeEventListener('blur', releaseControls);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, []);

  return <main
    className={'cinematic-ride mode-' + controller.mode}
    style={{ touchAction: canDrive ? 'none' : 'auto' }}
    onWheel={(event) => {
      const target = event.target as HTMLElement;
      if (!canDrive || target.closest('button, a, input, textarea, select')) return;
      event.preventDefault();
      const unit = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? window.innerHeight : 1;
      addGestureThrottle(THREE.MathUtils.clamp((event.deltaY * unit) / 240, -0.6, 0.6));
    }}
    onPointerMove={(event) => {
      const rect = event.currentTarget.getBoundingClientRect();
      if (event.pointerType === 'touch') {
        if (swipePointer.current === event.pointerId && swipeY.current !== null) {
          const deltaY = swipeY.current - event.clientY;
          swipeY.current = event.clientY;
          addGestureThrottle(THREE.MathUtils.clamp(deltaY / 80, -0.35, 0.35));
        }
        return;
      }
      drive.current.pointerX = THREE.MathUtils.clamp(((event.clientX - rect.left) / rect.width) * 2 - 1, -1, 1);
      drive.current.pointerY = THREE.MathUtils.clamp(((event.clientY - rect.top) / rect.height) * 2 - 1, -1, 1);
      event.currentTarget.style.setProperty('--aim-x', event.clientX - rect.left + 'px');
      event.currentTarget.style.setProperty('--aim-y', event.clientY - rect.top + 'px');
    }}
    onPointerDown={(event) => {
      const target = event.target as HTMLElement;
      const interactive = target.closest('button, a, input, textarea, select');
      if (event.pointerType === 'touch') {
        if (canDrive && !interactive) {
          swipePointer.current = event.pointerId;
          swipeY.current = event.clientY;
          if (canDrive) event.currentTarget.setPointerCapture(event.pointerId);
        }
        return;
      }
      if (canDrive && event.button === 0 && !interactive) drive.current.mouseThrottle = true;
    }}
    onPointerUp={(event) => {
      if (swipePointer.current === event.pointerId) {
        swipePointer.current = null;
        swipeY.current = null;
      }
      drive.current.mouseThrottle = false;
    }}
    onPointerCancel={() => {
      swipePointer.current = null;
      swipeY.current = null;
      drive.current.mouseThrottle = false;
    }}
    onPointerLeave={() => { drive.current.mouseThrottle = false; }}
  >
    <Canvas shadows dpr={isMobile || lowQuality ? [1, 1.2] : [1, 1.8]} camera={{ position: [4.9, 3.2, -12.2], fov: 47 }} gl={{ antialias: true, toneMapping: THREE.ACESFilmicToneMapping, toneMappingExposure: 1.12 }}>
      <PerformanceMonitor onDecline={() => setLowQuality(true)} />
      <AdaptiveDpr pixelated />
      <Suspense fallback={null}><Scene controller={controller} drive={drive} lowQuality={isMobile || lowQuality} /></Suspense>
    </Canvas>
    <div className="cinematic-wash" aria-hidden="true" />
    <Hud controller={controller} drive={drive} />
  </main>;
}

useGLTF.preload(MODEL_PATH);
