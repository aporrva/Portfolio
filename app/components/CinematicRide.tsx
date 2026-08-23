'use client';

import { AnimatePresence, motion } from 'framer-motion';
import gsap from 'gsap';
import { Suspense, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Canvas, ThreeEvent, useFrame, useThree } from '@react-three/fiber';
import { AdaptiveDpr, PerformanceMonitor, Sky, Sparkles, useGLTF } from '@react-three/drei';
import { Bloom, EffectComposer, SMAA, Vignette } from '@react-three/postprocessing';
import * as THREE from 'three';

type RideState = 'intro' | 'countdown' | 'riding' | 'target' | 'aiming' | 'shot' | 'reading' | 'summit' | 'finale';
type SectionId = 'skills' | 'about' | 'experience' | 'projects' | 'resume' | 'contact';

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
  groups: Array<{ label: string; lines: string[] }>;
  note: string;
};

type RideController = {
  begin: () => void;
  shoot: (confirmed?: boolean) => void;
  continueRide: () => void;
  openSection: (index: number) => void;
  reportApproach: (stageIndex: number, value: number, distance: number) => void;
  reportVehicleSpeed: (value: number) => void;
  reachFinale: () => void;
  setAimLocked: (value: boolean) => void;
  setTargetVulnerable: (value: boolean) => void;
  mute: boolean;
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
  activeIndex: number;
  completedCount: number;
  activeStop: PortfolioStop | null;
  panelStop: PortfolioStop | null;
  previewing: boolean;
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
  mouseThrottle: boolean;
  gestureThrottle: number;
  forward: boolean;
  brake: boolean;
  left: boolean;
  right: boolean;
  targetHit: boolean;
  resetApplied: number;
  stageApplied: number;
  summitReported: boolean;
  telemetryElapsed: number;
  lastPosition: THREE.Vector3;
  hasLastPosition: boolean;
};

type DriveRef = { current: DriveRuntime };

const MAX_LANE_OFFSET = 1.28;
const ROUTE_TOP_SPEED = 10.5;
const CRUISE_SPEED = 0.22;
const AIM_CRAWL_SPEED = 0.055;
const RIDE_START_DISTANCE = 25;
const SUMMIT_DISTANCE = 625;

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
  new THREE.Vector3(-4, 33, 415),
  new THREE.Vector3(0, 36, 475),
  new THREE.Vector3(0, 36, 540),
]);
roadCurve.curveType = 'centripetal';
const ROAD_LENGTH = roadCurve.getLength();
const RIDE_START_PROGRESS = RIDE_START_DISTANCE / ROAD_LENGTH;
const SUMMIT_PROGRESS = SUMMIT_DISTANCE / ROAD_LENGTH;

const stop = (
  id: SectionId,
  label: string,
  number: string,
  distance: number,
  signSubtitle: string,
  eyebrow: string,
  heading: [string, string],
  groups: Array<{ label: string; lines: string[] }>,
  note: string,
): PortfolioStop => ({
  id,
  label,
  number,
  distance,
  progress: distance / ROAD_LENGTH,
  side: -1,
  signSubtitle,
  eyebrow,
  heading,
  groups,
  note,
});

const PORTFOLIO_STOPS: PortfolioStop[] = [
  stop('skills', 'SKILLS', '01', 90, 'UNLOCK THE TOOLKIT', 'SKILLS UNLOCKED', ['THE TOOLKIT', 'BEHIND THE RIDE.'], [
    { label: 'FRONTEND', lines: ['React', 'Next.js', 'TypeScript'] },
    { label: '3D / MOTION', lines: ['Three.js', 'React Three Fiber', 'GSAP'] },
    { label: 'BACKEND', lines: ['Node.js', 'APIs', 'Databases'] },
  ], 'A practical stack for expressive, production-ready digital products.'),
  stop('about', 'ABOUT', '02', 180, 'MEET THE RIDER', 'RIDER PROFILE', ['DESIGN THINKING.', 'ENGINEERING DRIVE.'], [
    { label: 'PROFILE', lines: ['Full-stack developer', 'Creative technologist'] },
    { label: 'APPROACH', lines: ['Design X engineering', 'Story-led interaction'] },
    { label: 'FOCUS', lines: ['Useful products', 'Memorable interfaces'] },
  ], 'I turn ambitious ideas into clear, usable experiences with personality.'),
  stop('experience', 'EXPERIENCE', '03', 270, 'TRACE THE JOURNEY', 'EXPERIENCE UNLOCKED', ['BUILT THROUGH', 'REAL DELIVERY.'], [
    { label: 'ENGINEERING', lines: ['Frontend systems', 'Typed architecture'] },
    { label: 'PRODUCT', lines: ['Full-stack workflows', 'API-driven applications'] },
    { label: 'DELIVERY', lines: ['Concept to launch', 'Performance and polish'] },
  ], 'Hands-on experience across product thinking, implementation, and refinement.'),
  stop('projects', 'PROJECTS', '04', 360, 'OPEN THE GARAGE', 'PROJECT DATABASE', ['SELECTED WORK.', 'MADE TO MOVE.'], [
    { label: 'IMMERSIVE WEB', lines: ['3D Ride Portfolio', 'Three.js experience'] },
    { label: 'PRODUCT BUILDS', lines: ['Responsive applications', 'End-to-end workflows'] },
    { label: 'INTERACTION', lines: ['Motion systems', 'Accessible interfaces'] },
  ], 'Projects where interaction, technology, and a strong visual point of view meet.'),
  stop('resume', 'RESUME', '05', 450, 'VIEW THE RECORD', 'RESUME UNLOCKED', ['THE ROUTE.', 'AT A GLANCE.'], [
    { label: 'CORE', lines: ['React / TypeScript', 'Node.js / APIs'] },
    { label: 'CREATIVE', lines: ['Three.js / WebGL', 'GSAP / Motion'] },
    { label: 'PRACTICE', lines: ['Databases / Accessibility', 'Performance'] },
  ], 'A compact view of the capabilities behind the work.'),
  stop('contact', 'CONTACT', '06', 540, 'START A CONVERSATION', 'FINAL CHECKPOINT', ["LET'S BUILD", "WHAT'S NEXT."], [
    { label: 'COLLABORATE', lines: ['Product experiences', 'Interactive platforms'] },
    { label: 'CONNECT', lines: ['Email', 'LinkedIn'] },
    { label: 'FOLLOW', lines: ['GitHub', 'Selected work'] },
  ], 'The road continues with the right people and the right idea.'),
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
    mouseThrottle: false,
    gestureThrottle: 0,
    forward: false,
    brake: false,
    left: false,
    right: false,
    targetHit: false,
    resetApplied: -1,
    stageApplied: -1,
    summitReported: false,
    telemetryElapsed: 0,
    lastPosition: new THREE.Vector3(),
    hasLastPosition: false,
  };
}

function createRoadGeometry(width: number, elevation: number, start = 0, end = 1, widenAtSummit = false) {
  const segments = Math.max(32, Math.ceil((end - start) * ROAD_LENGTH * 0.8));
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
    const left = point.clone().addScaledVector(side, localWidth / 2);
    const right = point.clone().addScaledVector(side, -localWidth / 2);
    positions.push(left.x, left.y + elevation, left.z, right.x, right.y + elevation, right.z);
    uvs.push(0, fraction * Math.max(18, ROAD_LENGTH / 5), 1, fraction * Math.max(18, ROAD_LENGTH / 5));
  }

  for (let index = 0; index < segments; index += 1) {
    const offset = index * 2;
    indices.push(offset, offset + 1, offset + 2, offset + 1, offset + 3, offset + 2);
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

function makeTerrain(width: number, depth: number, segmentsX: number, segmentsZ: number, amplitude: number, centerZ = 220) {
  const geometry = new THREE.PlaneGeometry(width, depth, segmentsX, segmentsZ);
  geometry.rotateX(-Math.PI / 2);
  geometry.translate(0, 0, centerZ);
  const position = geometry.getAttribute('position') as THREE.BufferAttribute;

  for (let index = 0; index < position.count; index += 1) {
    const x = position.getX(index);
    const z = position.getZ(index);
    const broad = Math.sin(x * 0.028 + z * 0.015) * amplitude * 0.42;
    const ridges = Math.sin(x * 0.082 - z * 0.034) * amplitude * 0.2;
    const detail = Math.sin(x * 0.25 + z * 0.11) * amplitude * 0.04;
    position.setY(index, broad + ridges + detail - 7.5);
  }
  geometry.computeVertexNormals();
  return geometry;
}

function getRoadsidePose(portfolioStop: PortfolioStop) {
  const point = roadCurve.getPointAt(portfolioStop.progress);
  const tangent = roadCurve.getTangentAt(portfolioStop.progress).normalize();
  const side = new THREE.Vector3(-tangent.z, 0, tangent.x).normalize();
  const position = point.clone().addScaledVector(side, portfolioStop.side * 4.35);
  position.y += 1.62;
  return {
    position,
    tangent,
    side,
    rotationY: Math.atan2(-tangent.x, -tangent.z),
  };
}

function useRideController(): RideController {
  const initialDistance = Math.round(PORTFOLIO_STOPS[0].distance - RIDE_START_DISTANCE);
  const [mode, setMode] = useState<RideState>('intro');
  const [countdown, setCountdown] = useState(10);
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
  const [mute, setMute] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const [panelIndex, setPanelIndex] = useState<number | null>(null);
  const [previewing, setPreviewing] = useState(false);

  const muteRef = useRef(false);
  const modeRef = useRef<RideState>('intro');
  const activeIndexRef = useRef(0);
  const previewingRef = useRef(false);
  const returnModeRef = useRef<RideState>('riding');
  const returnSpeedRef = useRef(1);
  const aimLockedRef = useRef(false);
  const targetVulnerableRef = useRef(false);
  const targetDistanceRef = useRef(initialDistance);
  const contextRef = useRef<AudioContext | null>(null);
  const engineRef = useRef<{
    low: OscillatorNode;
    high: OscillatorNode;
    gain: GainNode;
    filter: BiquadFilterNode;
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
    if (typeof window === 'undefined') return null;
    const AudioContextClass = window.AudioContext || (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioContextClass) return null;
    const context = contextRef.current ?? new AudioContextClass();
    contextRef.current = context;
    if (context.state === 'suspended') void context.resume();
    return context;
  }

  function updateEngine(speedValue: number) {
    const engine = engineRef.current;
    const context = contextRef.current;
    if (!engine || !context || context.state === 'closed') return;
    const active = ['riding', 'target', 'aiming', 'shot', 'reading', 'summit'].includes(modeRef.current);
    const now = context.currentTime;
    const level = !muteRef.current && active ? 0.009 + speedValue * 0.031 : 0.0001;
    engine.gain.gain.setTargetAtTime(level, now, 0.08);
    engine.low.frequency.setTargetAtTime(48 + speedValue * 92, now, 0.055);
    engine.high.frequency.setTargetAtTime(102 + speedValue * 215, now, 0.05);
    engine.filter.frequency.setTargetAtTime(380 + speedValue * 1450, now, 0.07);
  }

  function ensureEngine() {
    const context = getAudioContext();
    if (!context || engineRef.current) return;
    const low = context.createOscillator();
    const high = context.createOscillator();
    const filter = context.createBiquadFilter();
    const gain = context.createGain();
    low.type = 'sawtooth';
    high.type = 'triangle';
    low.frequency.value = 48;
    high.frequency.value = 102;
    filter.type = 'lowpass';
    filter.frequency.value = 420;
    filter.Q.value = 1.15;
    gain.gain.value = 0.0001;
    low.connect(filter);
    high.connect(filter);
    filter.connect(gain).connect(context.destination);
    low.start();
    high.start();
    engineRef.current = { low, high, gain, filter };
    updateEngine(reportedSpeed.current);
  }

  function transition(next: RideState) {
    modeRef.current = next;
    setMode(next);
    updateEngine(reportedSpeed.current);
  }

  function setAimLocked(value: boolean) {
    if (aimLockedRef.current === value) return;
    aimLockedRef.current = value;
    setAimLockedState(value);
  }

  function setTargetVulnerable(value: boolean) {
    if (targetVulnerableRef.current === value) return;
    targetVulnerableRef.current = value;
    setTargetVulnerableState(value);
    if (value) setMissMessage('');
  }

  function sound(frequency: number, duration: number, type: OscillatorType = 'sine', volume = 0.028) {
    if (muteRef.current) return;
    const context = getAudioContext();
    if (!context) return;
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

  function killTimelines() {
    mainTimeline.current?.kill();
  }

  function resetChallenge(nextDistance: number) {
    reportedApproach.current = 0;
    reportedDistance.current = Math.round(Math.abs(nextDistance));
    targetDistanceRef.current = nextDistance;
    lastAttemptAt.current = 0;
    setAimLocked(false);
    setTargetVulnerable(false);
    setMisses(0);
    setMissPulse(0);
    setMissMessage('');
    setTargetProgress(0);
    setTargetDistance(Math.round(Math.abs(nextDistance)));
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

    if (modeRef.current === 'riding' && next > 0.02) {
      transition('target');
      sound(520, 0.12, 'square', 0.026);
    } else if (modeRef.current === 'target' && next > 0.7) {
      setAimLocked(false);
      setTargetVulnerable(false);
      transition('aiming');
      sound(760, 0.16, 'sine', 0.035);
    }
  }

  function reportVehicleSpeed(value: number) {
    const next = THREE.MathUtils.clamp(value, 0, 1);
    updateEngine(next);
    if (Math.abs(next - reportedSpeed.current) > 0.014 || next === 0) {
      reportedSpeed.current = next;
      setVehicleSpeed(next);
    }
  }

  function begin() {
    killTimelines();
    activeIndexRef.current = 0;
    setActiveIndex(0);
    setPanelIndex(null);
    previewingRef.current = false;
    setPreviewing(false);
    resetChallenge(PORTFOLIO_STOPS[0].distance - RIDE_START_DISTANCE);
    reportedSpeed.current = 0;
    setCountdown(10);
    setVehicleSpeed(0);
    setSpeed(0);
    setRideReset((value) => value + 1);
    transition('countdown');
    ensureEngine();
    sound(125, 0.1, 'square', 0.02);

    const timeline = gsap.timeline();
    mainTimeline.current = timeline;
    for (let value = 10; value >= 0; value -= 1) {
      const index = 10 - value;
      timeline.call(() => {
        setCountdown(value);
        const base = value > 5 ? 220 : value > 2 ? 140 : 90;
        sound(base + index * 18, value === 0 ? 0.5 : 0.055, value < 4 ? 'sawtooth' : 'square', value === 0 ? 0.075 : 0.026);
      }, [], index * 0.245);
    }
    timeline.call(() => {
      transition('riding');
      setSpeed(1);
    }, [], 2.78);
  }

  function registerMiss(message: string) {
    setMissMessage(message);
    setMisses((value) => value + 1);
    setMissPulse((value) => value + 1);
    sound(92, 0.14, 'square', 0.045);
  }

  function shoot(confirmed = false) {
    if (modeRef.current !== 'aiming' || activeIndexRef.current >= PORTFOLIO_STOPS.length) return;
    const now = typeof performance !== 'undefined' ? performance.now() : Date.now();
    if (now - lastAttemptAt.current < 350) return;
    lastAttemptAt.current = now;

    const distance = Math.abs(targetDistanceRef.current);
    if (distance > 18) {
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
    const hitIndex = activeIndexRef.current;
    setPanelIndex(hitIndex);
    previewingRef.current = false;
    setPreviewing(false);
    setAimLocked(false);
    setTargetVulnerable(false);
    setMissMessage('DIRECT HIT');
    transition('shot');
    setTargetProgress(1);
    sound(76, 0.2, 'sawtooth', 0.09);
    const driver = { value: 1 };
    const timeline = gsap.timeline();
    mainTimeline.current = timeline;
    timeline
      .to(driver, {
        value: 0.2,
        duration: 0.62,
        ease: 'power3.out',
        onUpdate: () => setSpeed(driver.value),
      })
      .call(() => {
        sound(410, 0.12, 'square', 0.04);
        transition('reading');
      });
  }

  function continueRide() {
    if (modeRef.current !== 'reading') return;
    killTimelines();
    setAimLocked(false);
    setTargetVulnerable(false);
    setMissMessage('');

    if (previewingRef.current) {
      const returnMode = returnModeRef.current;
      previewingRef.current = false;
      setPreviewing(false);
      setPanelIndex(null);
      transition(returnMode);
      setSpeed(returnSpeedRef.current);
      return;
    }

    const currentIndex = activeIndexRef.current;
    if (currentIndex >= PORTFOLIO_STOPS.length) return;
    const nextIndex = currentIndex + 1;
    activeIndexRef.current = nextIndex;
    setActiveIndex(nextIndex);
    setPanelIndex(null);

    if (nextIndex < PORTFOLIO_STOPS.length) {
      const distance = PORTFOLIO_STOPS[nextIndex].distance - PORTFOLIO_STOPS[currentIndex].distance;
      resetChallenge(distance);
      transition('riding');
    } else {
      resetChallenge(SUMMIT_DISTANCE - PORTFOLIO_STOPS[currentIndex].distance);
      transition('summit');
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
    sound(nextIndex < PORTFOLIO_STOPS.length ? 105 : 132, 0.4, 'sawtooth', 0.052);
  }

  function openSection(index: number) {
    if (index < 0 || index >= PORTFOLIO_STOPS.length) return;
    if (modeRef.current === 'countdown' || modeRef.current === 'shot' || modeRef.current === 'reading') return;
    killTimelines();
    returnModeRef.current = modeRef.current;
    returnSpeedRef.current = modeRef.current === 'intro' || modeRef.current === 'finale' ? 0 : 1;
    previewingRef.current = true;
    setPreviewing(true);
    setPanelIndex(index);
    setAimLocked(false);
    setTargetVulnerable(false);
    transition('reading');
    setSpeed(returnSpeedRef.current === 0 ? 0 : 0.2);
  }

  function reachFinale() {
    if (modeRef.current !== 'summit' || activeIndexRef.current < PORTFOLIO_STOPS.length) return;
    killTimelines();
    setSpeed(0);
    reportedSpeed.current = 0;
    setVehicleSpeed(0);
    transition('finale');
    sound(196, 0.8, 'sine', 0.045);
    window.setTimeout(() => sound(392, 1.1, 'sine', 0.03), 260);
  }

  useEffect(() => {
    muteRef.current = mute;
    updateEngine(reportedSpeed.current);
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
    return () => {
      mainTimeline.current?.kill();
      const engine = engineRef.current;
      if (engine) {
        try {
          engine.low.stop();
          engine.high.stop();
        } catch {
          // Audio context may already be closed during fast refresh.
        }
      }
      engineRef.current = null;
      if (contextRef.current && contextRef.current.state !== 'closed') void contextRef.current.close();
    };
  }, []);

  return {
    begin,
    shoot,
    continueRide,
    openSection,
    reportApproach,
    reportVehicleSpeed,
    reachFinale,
    setAimLocked,
    setTargetVulnerable,
    mute,
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
    activeIndex,
    completedCount: Math.min(activeIndex, PORTFOLIO_STOPS.length),
    activeStop: PORTFOLIO_STOPS[activeIndex] ?? null,
    panelStop: panelIndex === null ? null : PORTFOLIO_STOPS[panelIndex],
    previewing,
  };
}

function Road() {
  const road = useMemo(() => createRoadGeometry(5.2, 0.08, 0, 1, true), []);
  const shoulder = useMemo(() => createRoadGeometry(7.2, 0.035, 0, 1, true), []);
  const localZ = useMemo(() => new THREE.Vector3(0, 0, 1), []);
  const lines = useMemo(() => Array.from({ length: Math.floor(ROAD_LENGTH / 7) }, (_, index) => {
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
      const progress = index / 169;
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
    for (let distance = 10; distance < ROAD_LENGTH - 10; distance += 11) {
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
    <mesh geometry={shoulder} receiveShadow><meshStandardMaterial color="#38424a" roughness={0.93} /></mesh>
    <mesh geometry={road} receiveShadow><meshStandardMaterial color="#171b20" roughness={0.82} metalness={0.03} /></mesh>
    {lines.map(({ point, quaternion }, index) => <mesh key={index} position={[point.x, point.y + 0.105, point.z]} quaternion={quaternion} receiveShadow>
      <boxGeometry args={[0.16, 0.016, 2.35]} /><meshStandardMaterial color="#e6c888" emissive="#64461e" emissiveIntensity={0.14} roughness={0.6} />
    </mesh>)}
    {rails.map((curve, index) => <mesh key={index} castShadow receiveShadow>
      <tubeGeometry args={[curve, 320, 0.045, 8, false]} />
      <meshStandardMaterial color="#697078" metalness={0.78} roughness={0.31} />
    </mesh>)}
    {posts.map(({ position, key }) => <mesh key={key} position={position} castShadow>
      <cylinderGeometry args={[0.045, 0.055, 0.74, 8]} />
      <meshStandardMaterial color="#5b6268" metalness={0.75} roughness={0.35} />
    </mesh>)}
  </group>;
}

function Terrain() {
  const valley = useMemo(() => makeTerrain(220, 760, 44, 100, 18, 220), []);
  const roadMountain = useMemo(() => createRoadGeometry(92, -1.35), []);
  const snowShelf = useMemo(() => createRoadGeometry(76, -0.9, 0.67, 1), []);
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
    [-22, 11, -10, 4.2], [18, 15, 74, 5.1], [-19, 18, 175, 4.7], [17, 22, 282, 5.5],
    [-28, 25, 365, 6.2], [22, 27, 450, 7.1], [-12, 24, 520, 5.8],
  ] as const, []);
  return <group>
    <mesh position={[-24, 54, 585]}><sphereGeometry args={[8.5, 32, 24]} /><meshBasicMaterial color="#ffc578" toneMapped={false} /></mesh>
    <mesh position={[-24, 54, 585]} scale={1.72}><sphereGeometry args={[8.5, 32, 24]} /><meshBasicMaterial color="#ff9c63" transparent opacity={0.055} depthWrite={false} /></mesh>
    {clouds.map(([x, y, z, scale], index) => <group key={index} position={[x, y, z]} scale={scale}>
      <mesh scale={[1.1, 0.23, 0.34]}><sphereGeometry args={[1, 20, 12]} /><meshStandardMaterial color="#d9e2df" transparent opacity={0.14} roughness={1} depthWrite={false} /></mesh>
      <mesh position={[0.7, 0.14, 0.1]} scale={[0.72, 0.19, 0.26]}><sphereGeometry args={[1, 20, 12]} /><meshStandardMaterial color="#e9e4d8" transparent opacity={0.11} roughness={1} depthWrite={false} /></mesh>
    </group>)}
  </group>;
}

function SummitVista() {
  const summit = useMemo(() => roadCurve.getPointAt(SUMMIT_PROGRESS), []);
  const tangent = useMemo(() => roadCurve.getTangentAt(SUMMIT_PROGRESS).normalize(), []);
  const side = useMemo(() => new THREE.Vector3(-tangent.z, 0, tangent.x).normalize(), [tangent]);
  const mountains = useMemo(() => [
    { lateral: -48, forward: 104, height: 55, radius: 31, color: '#637c89' },
    { lateral: 42, forward: 112, height: 68, radius: 38, color: '#536c7b' },
    { lateral: -8, forward: 132, height: 83, radius: 43, color: '#405a6d' },
    { lateral: 77, forward: 155, height: 91, radius: 48, color: '#354e61' },
    { lateral: -82, forward: 160, height: 88, radius: 46, color: '#385365' },
  ].map((peak) => {
    const position = summit.clone().addScaledVector(tangent, peak.forward).addScaledVector(side, peak.lateral);
    position.y = summit.y + peak.height * 0.34;
    return { ...peak, position };
  }), [side, summit, tangent]);
  const heading = Math.atan2(tangent.x, tangent.z);

  return <group>
    <mesh position={[summit.x, summit.y + 0.035, summit.z]} rotation={[-Math.PI / 2, 0, heading]}>
      <circleGeometry args={[8.6, 48]} />
      <meshStandardMaterial color="#657276" roughness={0.96} />
    </mesh>
    <group position={[summit.x, summit.y + 0.35, summit.z]} rotation={[0, heading, 0]}>
      {[0, 1, 2, 3].map((index) => <mesh key={index} position={[-4.4, index * 0.26, 2.8]} scale={[0.7 - index * 0.1, 0.3, 0.6 - index * 0.08]} rotation={[0, index * 0.73, 0]} castShadow>
        <dodecahedronGeometry args={[1, 0]} /><meshStandardMaterial color={index % 2 ? '#8b9795' : '#596968'} roughness={1} flatShading />
      </mesh>)}
      <mesh position={[-4.4, 1.4, 2.8]}>
        <octahedronGeometry args={[0.18, 0]} /><meshStandardMaterial color="#ffdd91" emissive="#ffad45" emissiveIntensity={2.4} />
      </mesh>
    </group>
    {mountains.map((peak, index) => <group key={index} position={peak.position}>
      <mesh scale={[peak.radius, peak.height, peak.radius]} rotation={[0, index * 0.43, 0]}>
        <coneGeometry args={[1, 1, 5, 1]} /><meshStandardMaterial color={peak.color} roughness={1} flatShading />
      </mesh>
      <mesh position={[0, peak.height * 0.33, 0]} scale={[peak.radius * 0.43, peak.height * 0.34, peak.radius * 0.43]} rotation={[0, index * 0.43, 0]}>
        <coneGeometry args={[1, 1, 5, 1]} /><meshStandardMaterial color={index % 2 ? '#e8ece7' : '#cfdadd'} roughness={0.9} flatShading />
      </mesh>
    </group>)}
  </group>;
}

const BIKE_SCALE = 1.28;
const WHEEL_RADIUS_WORLD = 0.495 * BIKE_SCALE;

function RideRig({ controller, drive }: { controller: RideController; drive: DriveRef }) {
  const { scene } = useGLTF('/models/apoorva-cafe-rider.glb');
  const { camera } = useThree();
  const bikeRoot = useRef<THREE.Group>(null);
  const visual = useRef<THREE.Group>(null);
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

  const { model, floorOffset } = useMemo(() => {
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
    clone.updateMatrixWorld(true);
    const bounds = new THREE.Box3().setFromObject(clone);
    return {
      model: clone,
      floorOffset: 0.08 - bounds.min.y * BIKE_SCALE,
    };
  }, [scene]);

  const rearWheel = useMemo(() => model.getObjectByName('RearWheelSpin'), [model]);
  const frontWheel = useMemo(() => model.getObjectByName('FrontWheelSpin'), [model]);

  useFrame(({ clock }, rawDelta) => {
    const delta = Math.min(rawDelta, 0.05);
    const runtime = drive.current;
    const activeStop = controller.activeStop;

    if (runtime.resetApplied !== controller.rideReset) {
      runtime.progress = RIDE_START_PROGRESS;
      runtime.velocity = 0;
      runtime.acceleration = 0;
      runtime.lane = 0;
      runtime.steer = 0;
      runtime.wheelAngle = 0;
      runtime.gestureThrottle = 0;
      runtime.targetHit = false;
      runtime.telemetryElapsed = 0;
      runtime.hasLastPosition = false;
      runtime.resetApplied = controller.rideReset;
      runtime.stageApplied = controller.activeIndex;
      runtime.summitReported = false;
      if (activeStop) controller.reportApproach(controller.activeIndex, 0, activeStop.distance - RIDE_START_DISTANCE);
      controller.reportVehicleSpeed(0);
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

    const movingMode = ['riding', 'target', 'aiming', 'shot', 'reading', 'summit'].includes(controller.mode);
    const controlMode = ['riding', 'target', 'aiming', 'summit'].includes(controller.mode);
    if ((controller.mode === 'shot' || controller.mode === 'reading') && !controller.previewing) runtime.targetHit = true;

    const keyboardSteer = controlMode ? (runtime.left ? 1 : 0) - (runtime.right ? 1 : 0) : 0;
    const pointerSteer = controller.mode === 'riding' || controller.mode === 'summit' ? -runtime.pointerX * 0.72 : 0;
    const desiredSteer = THREE.MathUtils.clamp(keyboardSteer + pointerSteer, -1, 1);
    runtime.steer = THREE.MathUtils.damp(runtime.steer, desiredSteer, 6.5, delta);

    runtime.gestureThrottle = THREE.MathUtils.damp(runtime.gestureThrottle, 0, 2.8, delta);
    const heldThrottle = controlMode && (runtime.forward || runtime.mouseThrottle) ? 1 : 0;
    const braking = controlMode && (runtime.brake || runtime.gestureThrottle < -0.08);
    const throttle = Math.max(heldThrottle, controlMode ? Math.max(0, runtime.gestureThrottle) : 0);
    let desiredVelocity = movingMode ? CRUISE_SPEED + (1 - CRUISE_SPEED) * throttle : 0;

    if (controller.mode === 'target') desiredVelocity = Math.min(desiredVelocity, 0.72);
    if (controller.mode === 'aiming' && !runtime.targetHit) desiredVelocity = Math.min(desiredVelocity, AIM_CRAWL_SPEED);
    if (controller.mode === 'shot' || controller.mode === 'reading') desiredVelocity = 0.28;

    const currentDistance = runtime.progress * ROAD_LENGTH;
    const summitRemaining = SUMMIT_DISTANCE - currentDistance;
    let terminalBraking = false;
    if (controller.mode === 'summit') {
      if (summitRemaining < 30) {
        const summitLimit = THREE.MathUtils.lerp(0.045, 0.62, THREE.MathUtils.clamp(summitRemaining / 30, 0, 1));
        desiredVelocity = Math.min(desiredVelocity, summitLimit);
      }
      if (summitRemaining <= 0.28) {
        desiredVelocity = 0;
        terminalBraking = true;
      }
    }
    if (braking || terminalBraking) desiredVelocity = 0;

    const previousVelocity = runtime.velocity;
    const velocityDelta = desiredVelocity - runtime.velocity;
    const accelerationRate = THREE.MathUtils.lerp(0.78, 0.42, runtime.velocity);
    const decelerationRate = braking || terminalBraking
      ? 1.65
      : controller.mode === 'aiming'
        ? 1.15
        : controller.mode === 'target' || controller.mode === 'summit'
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
    if (movingMode) {
      const lateralSpeed = runtime.velocity * THREE.MathUtils.lerp(1.2, 2, runtime.velocity);
      runtime.lane = THREE.MathUtils.clamp(
        runtime.lane + runtime.steer * lateralSpeed * delta * timeScale,
        -MAX_LANE_OFFSET,
        MAX_LANE_OFFSET,
      );
    }

    const routeDistance = runtime.velocity * ROUTE_TOP_SPEED * delta * timeScale;
    let nextProgress = runtime.progress + routeDistance / ROAD_LENGTH;
    if (controller.mode === 'summit') nextProgress = Math.min(nextProgress, SUMMIT_PROGRESS);
    runtime.progress = THREE.MathUtils.clamp(nextProgress, RIDE_START_PROGRESS, SUMMIT_PROGRESS);

    if (activeStop && !runtime.targetHit) {
      const distanceToTarget = activeStop.distance - runtime.progress * ROAD_LENGTH;
      const approach = THREE.MathUtils.clamp((34 - distanceToTarget) / 24, 0, 1);
      controller.reportApproach(controller.activeIndex, approach, distanceToTarget);
    }

    if (
      controller.mode === 'summit'
      && !runtime.summitReported
      && SUMMIT_DISTANCE - runtime.progress * ROAD_LENGTH <= 0.08
      && runtime.velocity <= 0.025
    ) {
      runtime.summitReported = true;
      controller.reachFinale();
    }

    runtime.telemetryElapsed += delta;
    if (runtime.telemetryElapsed > 0.075) {
      runtime.telemetryElapsed = 0;
      controller.reportVehicleSpeed(runtime.velocity * timeScale);
    }

    roadCurve.getPointAt(runtime.progress, point);
    roadCurve.getTangentAt(runtime.progress, tangent).normalize();
    side.set(-tangent.z, 0, tangent.x).normalize();
    point.addScaledVector(side, runtime.lane);

    const distanceTravelled = runtime.hasLastPosition ? point.distanceTo(runtime.lastPosition) : 0;
    runtime.lastPosition.copy(point);
    runtime.hasLastPosition = true;
    runtime.wheelAngle += distanceTravelled / WHEEL_RADIUS_WORLD;

    roadCurve.getTangentAt(Math.min(runtime.progress + 0.012, 1), tangentAhead).normalize();
    const turnAngle = Math.atan2(
      tangent.z * tangentAhead.x - tangent.x * tangentAhead.z,
      THREE.MathUtils.clamp(tangent.dot(tangentAhead), -1, 1),
    );
    const curvature = turnAngle / (ROAD_LENGTH * 0.012);
    const actualSpeed = runtime.velocity * ROUTE_TOP_SPEED * timeScale;
    const curveLean = -Math.atan((actualSpeed * actualSpeed * curvature) / 9.81);
    const steeringLean = runtime.steer * runtime.velocity * (0.05 + runtime.velocity * 0.12);
    const leanTarget = controller.mode === 'finale'
      ? 0
      : THREE.MathUtils.clamp(curveLean + steeringLean, -0.46, 0.46);

    heading.copy(tangent).addScaledVector(side, runtime.steer * 0.08).normalize();
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
      const pitchTarget = controller.mode === 'finale' ? 0 : THREE.MathUtils.clamp(runtime.acceleration * 0.032, -0.055, 0.032);
      visual.current.rotation.z = THREE.MathUtils.damp(visual.current.rotation.z, pitchTarget, braking ? 10 : 5.5, delta);
      visual.current.position.y = THREE.MathUtils.damp(visual.current.position.y, 0, 10, delta);
    }
    if (rearWheel) rearWheel.rotation.z = -runtime.wheelAngle;
    if (frontWheel) frontWheel.rotation.z = -runtime.wheelAngle;

    const focusTarget = !!activeStop && (controller.mode === 'target' || controller.mode === 'aiming' || controller.mode === 'shot');
    const speed01 = runtime.velocity;

    if (controller.mode === 'finale') {
      desiredCamera.copy(summitPoint).addScaledVector(summitTangent, -10.5).addScaledVector(summitSide, 8.5);
      desiredCamera.y = summitPoint.y + 5.6;
      desiredLook.copy(summitPoint).addScaledVector(summitTangent, 62);
      desiredLook.y = summitPoint.y + 18;
    } else {
      const cameraBack = focusTarget ? 7.2 : THREE.MathUtils.lerp(7.6, 9.5, speed01);
      const cameraSide = focusTarget ? 1.6 : THREE.MathUtils.lerp(1.5, 0.75, speed01);
      const cameraHeight = focusTarget ? 2.35 : THREE.MathUtils.lerp(2.2, 2.65, speed01);
      desiredCamera.copy(point).addScaledVector(tangent, -(cameraBack - (braking ? 0.4 : 0))).addScaledVector(side, cameraSide);
      desiredCamera.y = point.y + cameraHeight - (braking ? 0.1 : 0);

      if (focusTarget) {
        desiredLook.copy(signFocus);
      } else {
        const lookAhead = THREE.MathUtils.lerp(5.5, 10.5, speed01);
        desiredLook.copy(point).addScaledVector(tangent, lookAhead).addScaledVector(side, runtime.steer * 0.35);
        desiredLook.y = point.y + 1.25 - runtime.pointerY * 0.2;
      }
    }

    const cameraRate = controller.mode === 'finale' ? 1.15 : 4.8;
    cameraBase.lerp(desiredCamera, 1 - Math.exp(-delta * cameraRate));
    lookAt.lerp(desiredLook, 1 - Math.exp(-delta * (controller.mode === 'finale' ? 1.35 : 6.5)));
    camera.position.copy(cameraBase);
    const modeShake = focusTarget ? 0.15 : controller.mode === 'reading' ? 0.08 : controller.mode === 'finale' ? 0 : 1;
    const shake = speed01 * speed01 * modeShake;
    const time = clock.elapsedTime;
    camera.position.addScaledVector(side, Math.sin(time * 18.7) * 0.035 * shake);
    camera.position.y += (Math.sin(time * 23.3) + Math.sin(time * 9.1) * 0.45) * 0.018 * shake;
    camera.lookAt(lookAt);

    const perspective = camera as THREE.PerspectiveCamera;
    const desiredFov = controller.mode === 'finale'
      ? 47
      : controller.mode === 'reading'
        ? 43
        : focusTarget
          ? 52
          : 49 + speed01 * 15 - (braking ? 2.5 : 0);
    perspective.fov += (desiredFov - perspective.fov) * (1 - Math.exp(-delta * (controller.mode === 'finale' ? 1.2 : braking ? 5.5 : 3.4)));
    perspective.updateProjectionMatrix();
  });

  return <group ref={bikeRoot}>
    <group ref={visual} scale={BIKE_SCALE}>
      <primitive object={model} />
    </group>
  </group>;
}

function createSignTexture(label: string, color: string, fontSize: number) {
  const canvas = document.createElement('canvas');
  canvas.width = 1024;
  canvas.height = 256;
  const context = canvas.getContext('2d');
  if (!context) return new THREE.Texture();
  context.clearRect(0, 0, canvas.width, canvas.height);
  context.fillStyle = color;
  context.font = '700 ' + fontSize + 'px Arial';
  context.textAlign = 'center';
  context.textBaseline = 'middle';
  context.letterSpacing = '12px';
  context.fillText(label, canvas.width / 2, canvas.height / 2 + 8);
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
    () => createSignTexture(portfolioStop.label, status === 'upcoming' ? '#879599' : '#f7ebd5', portfolioStop.label.length > 8 ? 92 : 124),
    [portfolioStop.label, status],
  );
  const subtitleTexture = useMemo(
    () => createSignTexture(status === 'completed' ? 'CHECKPOINT COMPLETE' : portfolioStop.signSubtitle, status === 'completed' ? '#f6c87a' : '#d4a065', 34),
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
    const targetX = aiming ? Math.sin(phaseTime * 1.65) * 0.58 * motionScale : 0;
    const targetY = aiming ? Math.sin(phaseTime * 2.3 + 0.65) * 0.28 * motionScale : 0;
    core.current.position.x = THREE.MathUtils.damp(core.current.position.x, targetX, 9, delta);
    core.current.position.y = THREE.MathUtils.damp(core.current.position.y, targetY, 9, delta);
    core.current.position.z = 0.16;
    core.current.rotation.z = phaseTime * (vulnerable ? 2.2 : 0.9);
    core.current.scale.setScalar(vulnerable ? 1.12 + Math.sin(clock.elapsedTime * 15) * 0.05 : 0.92 + Math.sin(clock.elapsedTime * 5) * 0.03);
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

  return <group ref={group} position={position} rotation={[0, pose.rotationY, 0]}>
    <group ref={board}>
      {active && <mesh onClick={miss} position={[0, 0, 0.1]}>
        <planeGeometry args={[3.82, 2.28]} />
        <meshBasicMaterial transparent opacity={0} depthWrite={false} />
      </mesh>}
      <mesh castShadow receiveShadow>
        <boxGeometry args={[3.55, 2.05, 0.16]} />
        <meshStandardMaterial
          color={status === 'completed' ? '#4f4a39' : status === 'active' ? '#132127' : '#1e2c31'}
          metalness={0.52}
          roughness={0.34}
          transparent={status === 'upcoming'}
          opacity={status === 'upcoming' ? 0.82 : 1}
        />
      </mesh>
      <mesh position={[0, 0.61, 0.11]}>
        <planeGeometry args={[2.52, 0.5]} />
        <meshBasicMaterial map={titleTexture} transparent depthWrite={false} />
      </mesh>
      <mesh position={[0, -0.65, 0.11]}>
        <planeGeometry args={[2.78, 0.23]} />
        <meshBasicMaterial map={subtitleTexture} transparent depthWrite={false} />
      </mesh>

      {active ? <group ref={core} position={[0, 0, 0.16]}>
        <mesh position={[0, 0, 0.09]} onClick={hit} onPointerOver={lock} onPointerMove={lock} onPointerOut={unlock}>
          <circleGeometry args={[assist ? 0.34 : 0.3, 32]} />
          <meshBasicMaterial transparent opacity={0} depthWrite={false} />
        </mesh>
        <mesh scale={vulnerable ? 1.18 : 0.92}>
          <torusGeometry args={[0.29, 0.047, 12, 36]} />
          <meshStandardMaterial
            color={vulnerable ? '#fff0a6' : '#d75c45'}
            emissive={vulnerable ? '#ffbf4d' : '#7d2018'}
            emissiveIntensity={vulnerable ? 3.2 : 0.75}
            metalness={0.42}
            roughness={0.25}
          />
        </mesh>
        <mesh position={[0, 0, 0.025]}>
          <circleGeometry args={[0.155, 32]} />
          <meshStandardMaterial
            color={vulnerable ? '#fff7ce' : '#5e2726'}
            emissive={vulnerable ? '#ffcf62' : '#7a1616'}
            emissiveIntensity={vulnerable ? 3.8 : 0.55}
            roughness={0.2}
          />
        </mesh>
        <mesh rotation={[0, 0, Math.PI / 4]} scale={vulnerable ? 1.1 : 0.82}>
          <torusGeometry args={[0.41, 0.018, 8, 4]} />
          <meshBasicMaterial color={vulnerable ? '#fff6c7' : '#9b4339'} transparent opacity={vulnerable ? 0.92 : 0.55} />
        </mesh>
      </group> : <group position={[0, 0, 0.17]}>
        <mesh><torusGeometry args={[0.3, 0.035, 10, 32]} /><meshStandardMaterial color={status === 'completed' ? '#f5c978' : '#5e6e73'} emissive={status === 'completed' ? '#a36825' : '#19292e'} emissiveIntensity={status === 'completed' ? 1.4 : 0.25} /></mesh>
        <mesh><circleGeometry args={[0.11, 24]} /><meshBasicMaterial color={status === 'completed' ? '#ffe0a2' : '#48585d'} /></mesh>
      </group>}

      <mesh position={[-1.13, -1.72, 0]} castShadow>
        <cylinderGeometry args={[0.07, 0.09, 1.65, 10]} />
        <meshStandardMaterial color="#3a4145" metalness={0.75} roughness={0.37} />
      </mesh>
      <mesh position={[1.13, -1.72, 0]} castShadow>
        <cylinderGeometry args={[0.07, 0.09, 1.65, 10]} />
        <meshStandardMaterial color="#3a4145" metalness={0.75} roughness={0.37} />
      </mesh>
    </group>
    {active && (mode === 'shot' || mode === 'reading') && <Sparkles count={90} scale={[3.8, 2.4, 1.4]} size={3.5} speed={1.2} color="#ffb65e" />}
    {active && showMiss && mode === 'aiming' && <Sparkles key={missPulse} count={24} scale={[2.8, 1.8, 0.8]} size={2.2} speed={1.8} color="#ef4e38" />}
    {active && <pointLight color={vulnerable ? '#ffd47b' : '#ff5944'} intensity={vulnerable ? 12 : mode === 'aiming' ? 5 : 2.5} distance={12} />}
  </group>;
}

function Scene({ controller, drive, lowQuality }: { controller: RideController; drive: DriveRef; lowQuality: boolean }) {
  return <>
    <color attach="background" args={[controller.mode === 'finale' ? '#7892a0' : '#657d8b']} />
    <fog attach="fog" args={['#708592', 26, controller.mode === 'finale' ? 245 : 175]} />
    <ambientLight intensity={0.82} color="#8cb7cc" />
    <hemisphereLight args={['#9fc6da', '#263a31', 1.25]} />
    <directionalLight position={[-28, 52, 390]} color="#ffc37c" intensity={3.1} castShadow shadow-mapSize={lowQuality ? 512 : 1024} shadow-bias={-0.00025} />
    <pointLight position={[3, 5, -70]} color="#ff8158" intensity={2.2} distance={18} />
    <Sky distance={450000} sunPosition={[-20, 22, 120]} inclination={0.46} azimuth={0.18} turbidity={5.2} rayleigh={1.2} mieCoefficient={0.008} mieDirectionalG={0.84} />
    <Atmosphere />
    <Terrain />
    <Road />
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
    <RideRig controller={controller} drive={drive} />
    {PORTFOLIO_STOPS.map((portfolioStop, index) => {
      const status: TargetStatus = index < controller.completedCount
        ? 'completed'
        : index === controller.activeIndex
          ? 'active'
          : 'upcoming';
      const activeMode = index === controller.activeIndex && !controller.previewing ? controller.mode : 'riding';
      return <RouteTarget
        key={portfolioStop.id}
        stop={portfolioStop}
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
    ? 'RETURN TO RIDE'
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
      <p>{portfolioStop.number} / {controller.previewing ? 'DIRECT ACCESS' : portfolioStop.eyebrow}</p>
      <h2 id={'section-' + portfolioStop.id}>{portfolioStop.heading[0]}<br /><em>{portfolioStop.heading[1]}</em></h2>
      <span>{controller.previewing ? 'Quick view - route progress is unchanged' : 'World speed reduced to 20%'}</span>
      <p className="section-note">{portfolioStop.note}</p>
    </div>
    <div className="skills-columns">
      {portfolioStop.groups.map((group) => <article key={group.label}>
        <b>{group.label}</b>
        <p>{group.lines.map((line, index) => <span key={line}>{line}{index < group.lines.length - 1 && <br />}</span>)}</p>
      </article>)}
    </div>
    <div className="skills-footer">
      <span>{controller.previewing ? 'MENU VIEW / NO CHECKPOINT SKIPPED' : portfolioStop.id === 'contact' ? 'ALL CHECKPOINTS COMPLETE' : 'NEXT TARGET IS WAITING'}</span>
      <button type="button" onClick={controller.continueRide}>{actionLabel} <b>↗</b></button>
    </div>
  </motion.section>;
}

function Hud({ controller, drive }: { controller: RideController; drive: DriveRef }) {
  const {
    mode,
    countdown,
    vehicleSpeed,
    targetDistance,
    aimLocked,
    targetVulnerable,
    misses,
    missMessage,
    activeStop,
    begin,
    shoot,
    mute,
    setMute,
  } = controller;
  const [menuOpen, setMenuOpen] = useState(false);
  const playState = mode === 'finale'
    ? 'SUMMIT / PARKED'
    : mode === 'summit'
      ? 'RIDE / FINAL ASCENT'
      : mode === 'reading'
        ? 'SLOW / 0.2X'
        : vehicleSpeed > 0.72
          ? 'RIDE / REDLINE'
          : mode === 'riding' || mode === 'target' || mode === 'aiming'
            ? 'RIDE / LIVE'
            : 'SYSTEM / READY';
  const driving = mode === 'riding' || mode === 'target' || mode === 'aiming' || mode === 'summit';
  const targetStatus = mode === 'shot'
    ? 'HIT CONFIRMED'
    : mode === 'aiming'
      ? missMessage || (targetVulnerable ? 'CORE OPEN' : 'SHIELD CYCLING')
      : 'TARGET DETECTED';
  const routeLabel = mode === 'finale'
    ? 'COMPLETE'
    : mode === 'summit'
      ? 'FINAL ASCENT'
      : activeStop?.label ?? 'SUMMIT';
  const routeNumber = mode === 'finale' || mode === 'summit' ? '06' : activeStop?.number ?? '06';

  const hold = (control: 'forward' | 'brake' | 'left' | 'right', active: boolean) => {
    drive.current[control] = active;
  };

  return <div className="ride-ui">
    <header className="ride-header">
      <button className="ride-mark" type="button" onClick={() => window.location.reload()} aria-label="Restart experience"><span>AR</span><i>APOORVA RAWAT</i></button>
      <div className="header-actions">
        <button className="sound-button" type="button" onClick={() => setMute(!mute)} aria-label={mute ? 'Enable sound' : 'Mute sound'}>{mute ? 'SOUND OFF' : 'SOUND ON'}</button>
        <button className="menu-button-3d" type="button" onClick={() => setMenuOpen((value) => !value)} aria-expanded={menuOpen}>MENU <b>+</b></button>
      </div>
    </header>

    <AnimatePresence>{menuOpen && <motion.nav className="route-menu" initial={{ opacity: 0, y: -14 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -14 }} aria-label="Portfolio navigation">
      <div><span>DIRECT ACCESS / {controller.completedCount} OF {PORTFOLIO_STOPS.length}</span><button type="button" onClick={() => setMenuOpen(false)} aria-label="Close menu">x</button></div>
      {PORTFOLIO_STOPS.map((portfolioStop, index) => {
        const complete = index < controller.completedCount;
        const active = index === controller.activeIndex && mode !== 'summit' && mode !== 'finale';
        return <button
          key={portfolioStop.id}
          className={complete ? 'is-complete' : active ? 'is-active' : ''}
          type="button"
          onClick={() => {
            setMenuOpen(false);
            controller.openSection(index);
          }}
        >
          <span>{portfolioStop.number} / {portfolioStop.label}</span>
          <i className="route-menu-status">{complete ? 'UNLOCKED' : active ? 'ON ROUTE' : 'QUICK VIEW'}</i>
        </button>;
      })}
    </motion.nav>}</AnimatePresence>

    <div className="route-rail" aria-label={'Route progress: ' + controller.completedCount + ' of ' + PORTFOLIO_STOPS.length}>
      <span>ROUTE</span><span className="route-count">{controller.completedCount} / {PORTFOLIO_STOPS.length}</span><i /><b>{routeNumber}</b><em>{routeLabel}</em>
    </div>
    <div className="speed-cluster"><span>{playState}</span><strong>{Math.round(vehicleSpeed * 168).toString().padStart(3, '0')}</strong><small>KM/H</small></div>
    <div className="scene-caption"><span>{mode === 'finale' ? 'HIMALAYAN OVERLOOK' : 'ALPINE REDLINE'}</span><b>{mode === 'summit' || mode === 'finale' ? 'SUMMIT ROUTE / 3D PANORAMA' : 'FULL 3D RIDE / SIX CHECKPOINTS'}</b></div>

    {driving && <div className="drive-pad" aria-label="Motorcycle controls">
      <span>DRIVE</span>
      <button className="drive-up" type="button" aria-label="Accelerate" onPointerDown={(event) => { event.preventDefault(); hold('forward', true); }} onPointerUp={() => hold('forward', false)} onPointerCancel={() => hold('forward', false)} onPointerLeave={() => hold('forward', false)}>↑<i>W</i></button>
      <button className="drive-left" type="button" aria-label="Steer left" onPointerDown={(event) => { event.preventDefault(); hold('left', true); }} onPointerUp={() => hold('left', false)} onPointerCancel={() => hold('left', false)} onPointerLeave={() => hold('left', false)}>←<i>A</i></button>
      <button className="drive-down" type="button" aria-label="Brake" onPointerDown={(event) => { event.preventDefault(); hold('brake', true); }} onPointerUp={() => hold('brake', false)} onPointerCancel={() => hold('brake', false)} onPointerLeave={() => hold('brake', false)}>↓<i>S</i></button>
      <button className="drive-right" type="button" aria-label="Steer right" onPointerDown={(event) => { event.preventDefault(); hold('right', true); }} onPointerUp={() => hold('right', false)} onPointerCancel={() => hold('right', false)} onPointerLeave={() => hold('right', false)}>→<i>D</i></button>
    </div>}

    <AnimatePresence>
      {mode === 'intro' && <motion.section className="entry-screen" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
        <p>APOORVA RAWAT / INTERACTIVE PORTFOLIO</p>
        <h1>RIDE INTO<br /><em>WHAT'S NEXT.</em></h1>
        <div><span>Six targets. One high-speed Himalayan ascent.</span><button type="button" onClick={begin}>ENTER EXPERIENCE <b>↗</b></button></div>
        <small>HOLD W / ↑ FOR FULL THROTTLE / A D TO STEER / S TO BRAKE</small>
      </motion.section>}

      {mode === 'countdown' && <motion.section className="countdown-overlay" key={countdown} initial={{ opacity: 0, scale: 0.78, filter: 'blur(14px)' }} animate={{ opacity: 1, scale: 1, filter: 'blur(0px)' }} exit={{ opacity: 0, scale: 1.14, filter: 'blur(8px)' }} transition={{ duration: 0.16 }}>
        <span>IGNITION / {countdown === 0 ? 'ENGINE ROAR' : 'SYSTEM CHECK'}</span>
        <strong>{String(countdown).padStart(2, '0')}</strong>
        <i>{countdown <= 3 ? 'RIDER CONTROL ONLINE' : 'MOUNTAIN DRIVE'}</i>
      </motion.section>}

      {activeStop && (mode === 'target' || mode === 'aiming' || mode === 'shot') && <motion.section
        className={'target-readout' + (targetVulnerable ? ' is-open' : '') + (targetVulnerable && aimLocked ? ' is-locked' : '')}
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
        {mode === 'target' && <small className="target-prompt">TARGET AHEAD / HOLD YOUR LINE</small>}
        {mode === 'aiming' && <button type="button" aria-label="Fire when the moving core turns gold" onClick={() => shoot(true)}>{targetVulnerable ? 'FIRE NOW / SPACE' : 'WAIT FOR GOLD / SPACE'}</button>}
        {mode === 'aiming' && misses >= 2 && <small className="aim-assist">AIM CALIBRATED</small>}
      </motion.section>}

      {mode === 'reading' && <SectionPanel controller={controller} />}

      {mode === 'finale' && <motion.section className="finale-overlay" initial={{ opacity: 0, y: 28 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 1.1, ease: [0.16, 1, 0.3, 1] }} aria-labelledby="summit-title">
        <p className="finale-kicker">SUMMIT / JOURNEY COMPLETE</p>
        <h2 id="summit-title">THE VIEW<br />AFTER THE CLIMB.</h2>
        <p className="finale-copy">Apoorva Rawat is a full-stack developer crafting interactive digital experiences where thoughtful engineering meets a strong visual point of view.</p>
        <div className="finale-links" aria-label="Contact channels"><span>EMAIL</span><span>LINKEDIN</span><span>GITHUB</span></div>
        <div className="finale-actions">
          <button type="button" onClick={() => window.location.reload()}>RESTART RIDE</button>
          <button type="button" onClick={() => setMenuOpen(true)}>VIEW SECTIONS</button>
        </div>
      </motion.section>}
    </AnimatePresence>

    {(mode === 'target' || mode === 'aiming') && <div className={'crosshair-3d' + (targetVulnerable && aimLocked ? ' is-hot' : '')} aria-hidden="true"><i /></div>}
    {driving && <p className="ride-instruction">{mode === 'riding'
      ? 'FULL THROTTLE W / ↑ / HOLD MOUSE / A D TO LEAN / S TO BRAKE'
      : mode === 'target'
        ? 'TARGET AHEAD / BRAKE LATE / MOVE INTO RANGE'
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
      if (event.code === 'ArrowUp' || event.code === 'KeyW') drive.current.forward = active;
      else if (event.code === 'ArrowDown' || event.code === 'KeyS') drive.current.brake = active;
      else if (event.code === 'ArrowLeft' || event.code === 'KeyA') drive.current.left = active;
      else if (event.code === 'ArrowRight' || event.code === 'KeyD') drive.current.right = active;
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

useGLTF.preload('/models/apoorva-cafe-rider.glb');
