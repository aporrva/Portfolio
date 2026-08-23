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
    checkpointResetApplied: -1,
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
  const position = point.clone().addScaledVector(side, portfolioStop.side * 7.5);
  position.y += 2.85;
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
  const [mute, setMute] = useState(false);
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
    targetVulnerableRef.current = value;
    setTargetVulnerableState(value);
  }

  function sound(freq: number, duration: number, type: OscillatorType = 'sine', volume = 0.035) {
    if (muteRef.current || typeof window === 'undefined') return;
    const context = getAudioContext();
    if (!context || context.state === 'closed') return;
    try {
      const osc = context.createOscillator();
      const gain = context.createGain();
      const now = context.currentTime;
      osc.type = type;
      osc.frequency.setValueAtTime(freq, now);
      gain.gain.setValueAtTime(volume, now);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);
      osc.connect(gain);
      gain.connect(context.destination);
      osc.start(now);
      osc.stop(now + duration);
    } catch {
      // Audio autoplay policy fallback
    }
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
    const next = THREE.MathUtils.clamp(value, 0, 1);
    updateEngine(next);
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
    ensureEngine();
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
    window.setTimeout(() => sound(540, 0.18, 'sine', 0.04), 90);
    window.setTimeout(() => {
      transition('reading');
    }, 720);
  }

  function continueRide() {
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

  function openFinale() {
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
    window.setTimeout(() => sound(392, 1.1, 'sine', 0.03), 260);
  }

  function reachFinale() {
    if (modeRef.current === 'finale') return;
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
  };
}

function Road() {
  const road = useMemo(() => createRoadGeometry(5.2, 0.12, 0, ROAD_END_PROGRESS, true), []);
  const shoulder = useMemo(() => createRoadGeometry(7.2, 0.09, 0, ROAD_END_PROGRESS, true), []);
  const localZ = useMemo(() => new THREE.Vector3(0, 0, 1), []);
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
    <mesh geometry={shoulder} receiveShadow><meshStandardMaterial color="#24272a" roughness={0.9} polygonOffset polygonOffsetFactor={1} polygonOffsetUnits={1} /></mesh>
    <mesh geometry={road} receiveShadow><meshStandardMaterial color="#24272a" roughness={0.86} metalness={0.02} polygonOffset polygonOffsetFactor={-1} polygonOffsetUnits={-1} /></mesh>
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

const STANDING_RIDER_POSITIONS: Record<string, [number, number, number]> = {
  'Rider hips': [-0.38, 1.38, 0],
  'Rider torso jacket': [-0.32, 1.78, 0],
  'Shoulder left': [-0.28, 1.98, 0.25],
  'Shoulder right': [-0.28, 1.98, -0.25],
  'Rider neck': [-0.23, 2.13, 0],
  'Jacket arm': [-0.28, 1.68, 0.31],
  'Gloved forearm': [-0.28, 1.28, 0.32],
  'Glove': [-0.24, 1.02, 0.32],
  'Jacket arm.001': [-0.28, 1.68, -0.31],
  'Gloved forearm.001': [-0.28, 1.28, -0.32],
  'Glove.001': [-0.24, 1.02, -0.32],
  'Riding thigh': [-0.36, 1.03, 0.18],
  'Riding shin': [-0.35, 0.57, 0.18],
  'Riding boot': [-0.24, 0.18, 0.18],
  'Riding thigh.001': [-0.36, 1.03, -0.18],
  'Riding shin.001': [-0.35, 0.57, -0.18],
  'Riding boot.001': [-0.24, 0.18, -0.18],
  'Rider scarf': [-0.36, 2.12, 0],
};
const STRAIGHTEN_RIDER_PARTS = new Set([
  'Jacket arm', 'Gloved forearm', 'Glove', 'Jacket arm.001', 'Gloved forearm.001', 'Glove.001',
  'Riding thigh', 'Riding shin', 'Riding boot', 'Riding thigh.001', 'Riding shin.001', 'Riding boot.001',
]);

const MODEL_PATH = `${process.env.NEXT_PUBLIC_BASE_PATH || ''}/models/apoorva-cafe-rider.glb`;

function RideRig({ controller, drive }: { controller: RideController; drive: DriveRef }) {
  const { scene } = useGLTF(MODEL_PATH);
  const { camera } = useThree();
  const bikeRoot = useRef<THREE.Group>(null);
  const visual = useRef<THREE.Group>(null);
  const kickstand = useRef<THREE.Group>(null);
  const tracerGroup = useRef<THREE.Group>(null);
  const tracerMesh = useRef<THREE.Mesh>(null);
  const tracerGlowMesh = useRef<THREE.Mesh>(null);
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
  const sunPosition = useMemo(() => new THREE.Vector3(-24, 54, 585), []);
  const sunDirection = useMemo(() => sunPosition.clone().sub(summitPoint).normalize(), [summitPoint, sunPosition]);
  const finalRiderYaw = useMemo(() => {
    const localForward = sunDirection.dot(summitTangent);
    const localSide = sunDirection.dot(summitSide);
    return Math.atan2(-localSide, localForward);
  }, [summitSide, summitTangent, sunDirection]);
  const finaleStartedAt = useRef(-1);
  const previousRideMode = useRef<RideState>('intro');
  const riderTarget = useMemo(() => new THREE.Vector3(), []);
  const identityQuaternion = useMemo(() => new THREE.Quaternion(), []);
  const aimWeight = useRef(0);
  const shotFiredAt = useRef(-1);
  const lastShotStage = useRef(-1);
  const muzzleWorldPos = useMemo(() => new THREE.Vector3(), []);
  const tracerMidPos = useMemo(() => new THREE.Vector3(), []);

  const {
    model,
    floorOffset,
    riderGroup,
    helmetGroup,
    helmetBase,
    headReveal,
    ponytailRef,
    scarfObj,
    gunGroup,
    muzzleTip,
    muzzleFlash,
    torsoObj,
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

    const riderNames = [
      'Rider hips', 'Rider torso jacket', 'Shoulder left', 'Shoulder right', 'Rider neck',
      'Jacket arm', 'Gloved forearm', 'Glove', 'Jacket arm.001', 'Gloved forearm.001', 'Glove.001',
      'Riding thigh', 'Riding shin', 'Riding boot', 'Riding thigh.001', 'Riding shin.001', 'Riding boot.001',
      'Rider scarf',
    ];
    const helmetNames = ['Rider helmet', 'Helmet crown', 'Helmet visor', 'Helmet rear'];
    const riderGroup = new THREE.Group();
    riderGroup.name = 'RiderDismount';
    const helmetGroup = new THREE.Group();
    helmetGroup.name = 'HelmetRemoval';
    helmetGroup.position.set(0.09, 2.25, 0);
    const helmetBase = helmetGroup.position.clone();
    clone.add(riderGroup);
    clone.updateMatrixWorld(true);

    for (const name of riderNames) {
      const object = clone.getObjectByName(name);
      if (object) riderGroup.attach(object);
    }
    riderGroup.add(helmetGroup);
    clone.updateMatrixWorld(true);
    for (const name of helmetNames) {
      const object = clone.getObjectByName(name);
      if (object) helmetGroup.attach(object);
    }

    const riderParts = riderNames
      .map((name) => riderGroup.getObjectByName(name))
      .filter((object): object is THREE.Object3D => !!object);
    const riderOriginals = riderParts.map((object) => ({
      object,
      position: object.position.clone(),
      quaternion: object.quaternion.clone(),
    }));

    const scarfObj = riderGroup.getObjectByName('Rider scarf');
    const torsoObj = riderGroup.getObjectByName('Rider torso jacket');

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

    const headReveal = new THREE.Group();
    headReveal.name = 'RiderHeadReveal';
    headReveal.position.set(0.06, 2.22, 0);
    headReveal.visible = false;

    // Face / head base
    const face = new THREE.Mesh(
      new THREE.SphereGeometry(0.22, 24, 18),
      new THREE.MeshStandardMaterial({ color: '#9b624c', roughness: 0.78 }),
    );
    face.scale.set(1.04, 1.16, 0.96);

    // Styled hair crown
    const hair = new THREE.Mesh(
      new THREE.SphereGeometry(0.238, 22, 18, 0, Math.PI * 2, 0, Math.PI * 0.64),
      new THREE.MeshStandardMaterial({ color: '#1a1410', roughness: 0.88 }),
    );
    hair.position.set(-0.03, 0.09, 0);

    // Front bangs / fringe
    const bangs = new THREE.Mesh(
      new THREE.SphereGeometry(0.18, 16, 12, 0, Math.PI, 0, Math.PI * 0.45),
      new THREE.MeshStandardMaterial({ color: '#1a1410', roughness: 0.88 }),
    );
    bangs.position.set(0.13, 0.12, 0);
    bangs.rotation.set(0, Math.PI / 2, -0.3);

    // Cool dark sunglasses
    const shades = new THREE.Mesh(
      new THREE.BoxGeometry(0.11, 0.065, 0.28),
      new THREE.MeshStandardMaterial({ color: '#111518', roughness: 0.25, metalness: 0.8 }),
    );
    shades.position.set(0.18, 0.035, 0);

    // Ponytail with hair band
    const ponytailRef = new THREE.Group();
    ponytailRef.name = 'PonytailGroup';
    ponytailRef.position.set(-0.21, 0.02, 0);

    const hairBand = new THREE.Mesh(
      new THREE.TorusGeometry(0.045, 0.018, 8, 16),
      new THREE.MeshStandardMaterial({ color: '#d28236', roughness: 0.45 }),
    );
    hairBand.rotation.y = Math.PI / 2;

    const ponytail = new THREE.Mesh(
      new THREE.ConeGeometry(0.09, 0.42, 12),
      new THREE.MeshStandardMaterial({ color: '#1a1410', roughness: 0.9 }),
    );
    ponytail.position.set(-0.12, -0.16, 0);
    ponytail.rotation.z = 0.55;

    ponytailRef.add(hairBand, ponytail);
    headReveal.add(face, hair, bangs, shades, ponytailRef);
    riderGroup.add(headReveal);

    clone.updateMatrixWorld(true);
    const bounds = new THREE.Box3().setFromObject(clone);
    return {
      model: clone,
      riderGroup,
      helmetGroup,
      helmetBase,
      headReveal,
      ponytailRef,
      scarfObj,
      gunGroup,
      muzzleTip,
      muzzleFlash,
      torsoObj,
      riderOriginals,
      floorOffset: 0.08 - bounds.min.y * BIKE_SCALE,
    };
  }, [scene]);

  const rearWheel = useMemo(() => model.getObjectByName('RearWheelSpin'), [model]);
  const frontWheel = useMemo(() => model.getObjectByName('FrontWheelSpin'), [model]);

  // Cylinder geometry aligned along Z axis for laser beam
  const tracerBeamGeometry = useMemo(() => {
    const geom = new THREE.CylinderGeometry(0.042, 0.042, 1, 8);
    geom.rotateX(Math.PI / 2);
    return geom;
  }, []);

  const tracerGlowGeometry = useMemo(() => {
    const geom = new THREE.CylinderGeometry(0.09, 0.09, 1, 8);
    geom.rotateX(Math.PI / 2);
    return geom;
  }, []);

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

    // Timeline phases:
    // 0.2s - 2.0s: Puts bike on kickstand & bike settles with realistic lean
    // 2.0s - 4.8s: Dismounts from bike (swings right leg over, stands on ground)
    // 4.8s - 7.6s: Takes helmet off (arms reach up, lifts helmet, reveals face/hair, carries helmet to hip)
    // 7.6s - 11.5s: Walks to the end of the road / scenic overlook edge
    // 11.5s+: Stands at the edge of the road staring directly at the sun
    const parkingStand = terminalScene ? THREE.MathUtils.smootherstep(finaleElapsed, 0.2, 1.8) : 0;
    const dismountProgress = terminalScene ? THREE.MathUtils.smootherstep(finaleElapsed, 2.0, 4.8) : 0;
    const armLiftProgress = terminalScene ? THREE.MathUtils.smootherstep(finaleElapsed, 4.8, 5.9) : 0;
    const helmetLift = terminalScene ? THREE.MathUtils.smootherstep(finaleElapsed, 5.6, 6.7) : 0;
    const helmetCarry = terminalScene ? THREE.MathUtils.smootherstep(finaleElapsed, 6.4, 7.6) : 0;
    const walkProgress = terminalScene ? THREE.MathUtils.smootherstep(finaleElapsed, 7.8, 11.6) : 0;

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

      const sideX = -0.22 * dismountProgress;
      const sideZ = 1.25 * dismountProgress;
      const walkWeight = Math.sin(Math.PI * walkProgress);
      const walkStride = Math.sin(finaleElapsed * 6.8) * walkWeight;

      // Rider root position & rotation
      const riderTargetX = THREE.MathUtils.lerp(sideX, 4.8, walkProgress);
      const riderTargetZ = THREE.MathUtils.lerp(sideZ, 0.55, walkProgress);
      const riderTargetY = -0.05 * dismountProgress + Math.abs(walkStride) * 0.025;

      riderGroup.position.set(riderTargetX, riderTargetY, riderTargetZ);
      riderGroup.rotation.x = -0.065 * parkingStand * dismountProgress;
      riderGroup.rotation.y = THREE.MathUtils.lerp(-0.04 * dismountProgress, finalRiderYaw, walkProgress);

      // Rider body parts articulation
      for (const snapshot of riderOriginals) {
        const target = STANDING_RIDER_POSITIONS[snapshot.object.name];
        if (target) {
          riderTarget.set(target[0], target[1], target[2]);
          snapshot.object.position.lerpVectors(snapshot.position, riderTarget, dismountProgress);

          // Right leg swing over the cafe seat during dismount
          if (snapshot.object.name.startsWith('Riding') && snapshot.object.name.endsWith('.001')) {
            const stepArc = Math.sin(dismountProgress * Math.PI);
            snapshot.object.position.y += stepArc * 0.28;
            snapshot.object.position.z -= stepArc * 0.32;
          }

          // Natural walking leg stride
          if (walkProgress > 0 && walkProgress < 1 && snapshot.object.name.startsWith('Riding')) {
            const legPhase = snapshot.object.name.endsWith('.001') ? -walkStride : walkStride;
            snapshot.object.position.x += legPhase * 0.12;
            snapshot.object.position.y += Math.max(0, -legPhase) * 0.04;
          }

          // Arm animation: Raising to helmet, lifting, and carrying down to hip
          const isLeftArm = snapshot.object.name === 'Jacket arm' || snapshot.object.name === 'Gloved forearm' || snapshot.object.name === 'Glove';
          const isRightArm = snapshot.object.name === 'Jacket arm.001' || snapshot.object.name === 'Gloved forearm.001' || snapshot.object.name === 'Glove.001';

          if (dismountProgress >= 0.95) {
            if (isLeftArm) {
              const liftY = 0.58 * armLiftProgress - 0.42 * helmetCarry;
              const liftX = 0.32 * armLiftProgress - 0.24 * helmetCarry;
              const liftZ = 0.08 * armLiftProgress + 0.18 * helmetCarry;
              snapshot.object.position.y += liftY;
              snapshot.object.position.x += liftX;
              snapshot.object.position.z += liftZ;
            } else if (isRightArm) {
              const liftY = 0.58 * armLiftProgress - 0.58 * helmetCarry;
              const liftX = 0.32 * armLiftProgress - 0.32 * helmetCarry;
              snapshot.object.position.y += liftY;
              snapshot.object.position.x += liftX;
              if (walkProgress > 0 && walkProgress < 1) {
                snapshot.object.position.x += walkStride * 0.12;
              }
            }
          }
        }

        if (STRAIGHTEN_RIDER_PARTS.has(snapshot.object.name)) {
          snapshot.object.quaternion.slerpQuaternions(snapshot.quaternion, identityQuaternion, dismountProgress);
        }
      }

      // Helmet removal animation (lifts up from head, moves down to rest beside left hip)
      helmetGroup.position.set(
        helmetBase.x - 0.26 * helmetCarry,
        helmetBase.y + 0.42 * helmetLift - 1.34 * helmetCarry,
        helmetBase.z + 0.44 * helmetCarry,
      );
      helmetGroup.rotation.x = 0.54 * helmetCarry;
      helmetGroup.rotation.z = -0.2 * helmetCarry;

      // Reveal head/face and hair once helmet begins lifting
      headReveal.visible = finaleElapsed > 5.5;
      const headScale = THREE.MathUtils.smootherstep(finaleElapsed, 5.5, 6.1);
      headReveal.scale.setScalar(headScale);

      // Ponytail & scarf gentle wind sway
      if (ponytailRef) {
        ponytailRef.rotation.z = 0.12 + Math.sin(clock.elapsedTime * 3.6) * 0.09;
        ponytailRef.rotation.y = Math.sin(clock.elapsedTime * 2.4) * 0.06;
      }
      if (scarfObj) {
        scarfObj.rotation.x = Math.sin(clock.elapsedTime * 4.2) * 0.06;
      }
    } else {
      // Normal driving / aiming posture
      riderGroup.position.set(0, 0, 0);
      riderGroup.rotation.set(0, 0, 0);
      helmetGroup.position.copy(helmetBase);
      helmetGroup.rotation.set(0, 0, 0);
      headReveal.visible = false;

      const currentAim = aimWeight.current;
      if (gunGroup) gunGroup.visible = currentAim > 0.02;

      for (const snapshot of riderOriginals) {
        snapshot.object.position.copy(snapshot.position);
        snapshot.object.quaternion.copy(snapshot.quaternion);

        // One-handed driving + right arm dramatically raised & pointing gun towards target
        if (currentAim > 0.001) {
          if (snapshot.object.name === 'Jacket arm.001') {
            snapshot.object.position.y += 0.48 * currentAim;
            snapshot.object.position.z -= 0.65 * currentAim;
            snapshot.object.position.x += 0.35 * currentAim;
            snapshot.object.rotation.z += 0.72 * currentAim;
            snapshot.object.rotation.y -= 0.95 * currentAim;
          } else if (snapshot.object.name === 'Gloved forearm.001') {
            snapshot.object.position.y += 0.78 * currentAim;
            snapshot.object.position.z -= 1.15 * currentAim;
            snapshot.object.position.x += 0.55 * currentAim;
            snapshot.object.rotation.z += 0.62 * currentAim;
            snapshot.object.rotation.y -= 1.22 * currentAim;
          } else if (snapshot.object.name === 'Glove.001') {
            snapshot.object.position.y += 0.92 * currentAim + (isLaserShooting ? recoilKick * 0.14 : 0);
            snapshot.object.position.z -= 1.55 * currentAim;
            snapshot.object.position.x += 0.72 * currentAim - (isLaserShooting ? recoilKick * 0.28 : 0);
            snapshot.object.rotation.z += 0.48 * currentAim - (isLaserShooting ? recoilKick * 0.45 : 0);
            snapshot.object.rotation.y -= 1.45 * currentAim;
          }
        }
      }

      // Upper torso and helmet turn towards the target when aiming
      if (torsoObj && currentAim > 0.001) {
        torsoObj.rotation.y = -0.45 * currentAim;
        torsoObj.rotation.z = -0.1 * currentAim;
      }
      if (helmetGroup && currentAim > 0.001) {
        helmetGroup.rotation.y = -0.68 * currentAim;
        helmetGroup.rotation.x = -0.12 * currentAim;
      }
    }

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

    const movingMode = ['riding', 'target', 'aiming', 'shot', 'reading', 'summit'].includes(controller.mode);
    const controlMode = ['riding', 'target', 'aiming', 'summit'].includes(controller.mode);
    if ((controller.mode === 'shot' || controller.mode === 'reading') && !controller.previewing) runtime.targetHit = true;

    const keyboardSteer = controlMode ? (runtime.right ? 1 : 0) - (runtime.left ? 1 : 0) : 0;
    const pointerSteer = controller.mode === 'riding' || controller.mode === 'summit' ? runtime.pointerX * 0.72 : 0;
    const desiredSteer = THREE.MathUtils.clamp(keyboardSteer + pointerSteer, -1, 1);
    runtime.steer = THREE.MathUtils.damp(runtime.steer, desiredSteer, 9.5, delta);

    runtime.gestureThrottle = THREE.MathUtils.damp(runtime.gestureThrottle, 0, 2.8, delta);
    const heldThrottle = controlMode && (runtime.forward || runtime.mouseThrottle) ? 1 : 0;
    const braking = controlMode && (runtime.brake || runtime.gestureThrottle < -0.08);
    const throttle = Math.max(heldThrottle, controlMode ? Math.max(0, runtime.gestureThrottle) : 0);
    let desiredVelocity = movingMode ? CRUISE_SPEED + (1 - CRUISE_SPEED) * throttle : 0;

    if (controller.mode === 'aiming' && !runtime.targetHit) desiredVelocity = Math.min(desiredVelocity, AIM_CRAWL_SPEED);
    if (controller.mode === 'shot' || controller.mode === 'reading') desiredVelocity = 0.28;

    const currentDistance = runtime.progress * ROAD_LENGTH;
    const summitRemaining = SUMMIT_DISTANCE - currentDistance;
    let terminalBraking = false;
    if (controller.mode === 'summit') {
      desiredVelocity = Math.max(0.52, CRUISE_SPEED + (1 - CRUISE_SPEED) * throttle);
      if (summitRemaining < 36) {
        const summitLimit = THREE.MathUtils.lerp(0.04, 0.52, THREE.MathUtils.clamp(summitRemaining / 36, 0, 1));
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
    const accelerationRate = THREE.MathUtils.lerp(0.78, 0.42, runtime.velocity);
    const decelerationRate = braking || terminalBraking
      ? 1.65
      : controller.mode === 'aiming'
        ? 1.25
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
      const lateralSpeed = THREE.MathUtils.lerp(2.2, 4.2, runtime.velocity);
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
    const leanTarget = terminalScene
      ? 0.085 * parkingStand
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
      const pitchTarget = terminalScene ? 0 : THREE.MathUtils.clamp(runtime.acceleration * 0.032, -0.055, 0.032);
      visual.current.rotation.z = THREE.MathUtils.damp(visual.current.rotation.z, pitchTarget, braking ? 10 : 5.5, delta);
      visual.current.position.y = THREE.MathUtils.damp(visual.current.position.y, 0, 10, delta);
    }
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

    if (tracerGroup.current && isLaserShooting && activeStop) {
      const targetPose = getRoadsidePose(activeStop);
      const targetWorld = targetPose.position.clone();
      targetWorld.y += 0.05;

      const totalDist = muzzleWorldPos.distanceTo(targetWorld);
      
      // Fast bullet projectile flight (0.0s to 0.16s flight time from gun muzzle to billboard)
      const flightProgress = THREE.MathUtils.clamp(timeSinceShot / 0.16, 0, 1);
      const bulletHead = new THREE.Vector3().lerpVectors(muzzleWorldPos, targetWorld, flightProgress);
      // Trail stretches behind the bullet from muzzle up to a max trail length of 7.5m
      const trailLength = Math.min(totalDist * flightProgress, 7.5);
      const trailStart = bulletHead.clone().addScaledVector(bulletHead.clone().sub(muzzleWorldPos).normalize(), -trailLength);
      
      const segmentMid = new THREE.Vector3().lerpVectors(trailStart, bulletHead, 0.5);
      const segmentLen = Math.max(trailStart.distanceTo(bulletHead), 0.2);

      tracerGroup.current.visible = true;
      tracerGroup.current.position.copy(segmentMid);
      tracerGroup.current.lookAt(targetWorld);
      tracerGroup.current.scale.set(1, 1, segmentLen);

      const fade = Math.max(0, 1 - timeSinceShot / 0.45);
      if (tracerMesh.current) (tracerMesh.current.material as THREE.MeshBasicMaterial).opacity = fade * 0.98;
      if (tracerGlowMesh.current) (tracerGlowMesh.current.material as THREE.MeshBasicMaterial).opacity = fade * 0.65;
      
      if (tracerImpact.current) {
        tracerImpact.current.visible = flightProgress >= 0.75;
        tracerImpact.current.position.copy(targetWorld);
        const impactScale = flightProgress >= 0.75 ? THREE.MathUtils.lerp(0.5, 2.5, (timeSinceShot - 0.12) / 0.25) : 0;
        tracerImpact.current.scale.setScalar(Math.max(0, impactScale));
        (tracerImpact.current.material as THREE.MeshBasicMaterial).opacity = fade * (flightProgress >= 0.75 ? 0.9 : 0);
      }
    } else {
      if (tracerGroup.current) tracerGroup.current.visible = false;
      if (tracerImpact.current) tracerImpact.current.visible = false;
    }

    const signFocus = activeStop
      ? getRoadsidePose(activeStop).position.clone().add(new THREE.Vector3(0, 0.25, 0))
      : point.clone().addScaledVector(tangent, 10);

    const speed01 = runtime.velocity;
    const focusTarget = controller.mode === 'target' || controller.mode === 'aiming' || controller.mode === 'shot';

    if (terminalScene) {
      // Keyframe 1: Arrival & Kickstand Parking Shot (0.0s - 4.8s)
      const cam1Pos = summitPoint.clone().addScaledVector(summitTangent, -4.8).addScaledVector(summitSide, 3.2);
      cam1Pos.y = summitPoint.y + 1.85;
      const cam1Look = summitPoint.clone().addScaledVector(summitTangent, 0.8);
      cam1Look.y = summitPoint.y + 1.25;

      // Keyframe 2: Helmet Removal Close-up Portrait (4.8s - 7.6s)
      const cam2Pos = summitPoint.clone().addScaledVector(summitTangent, 1.2).addScaledVector(summitSide, 2.8);
      cam2Pos.y = summitPoint.y + 2.3;
      const cam2Look = summitPoint.clone().addScaledVector(summitTangent, -0.2).addScaledVector(summitSide, 1.25);
      cam2Look.y = summitPoint.y + 2.15;

      // Keyframe 3: Walking Tracking (7.6s - 11.5s)
      const currentRiderPos = summitPoint.clone()
        .addScaledVector(summitTangent, THREE.MathUtils.lerp(-0.22, 4.8, walkProgress))
        .addScaledVector(summitSide, THREE.MathUtils.lerp(1.25, 0.55, walkProgress));
      currentRiderPos.y = summitPoint.y + 1.6;

      const cam3Pos = summitPoint.clone()
        .addScaledVector(summitTangent, THREE.MathUtils.lerp(-2.6, 1.8, walkProgress))
        .addScaledVector(summitSide, 5.2);
      cam3Pos.y = summitPoint.y + 2.6;
      const cam3Look = currentRiderPos;

      // Keyframe 4: Majestic Wide Vista at Sun (11.5s+)
      const cam4Pos = summitPoint.clone().addScaledVector(summitTangent, -10.5).addScaledVector(summitSide, 8.8);
      cam4Pos.y = summitPoint.y + 6.2;
      const cam4Look = summitPoint.clone().addScaledVector(sunDirection, 65);
      cam4Look.y = summitPoint.y + 2.8;

      // Smooth blends between keyframe stages
      const t12 = THREE.MathUtils.smootherstep(finaleElapsed, 4.2, 5.4);
      const t23 = THREE.MathUtils.smootherstep(finaleElapsed, 7.2, 8.4);
      const t34 = THREE.MathUtils.smootherstep(finaleElapsed, 11.0, 14.5);

      const blend12Pos = new THREE.Vector3().lerpVectors(cam1Pos, cam2Pos, t12);
      const blend12Look = new THREE.Vector3().lerpVectors(cam1Look, cam2Look, t12);

      const blend23Pos = new THREE.Vector3().lerpVectors(blend12Pos, cam3Pos, t23);
      const blend23Look = new THREE.Vector3().lerpVectors(blend12Look, cam3Look, t23);

      desiredCamera.lerpVectors(blend23Pos, cam4Pos, t34);
      desiredLook.lerpVectors(blend23Look, cam4Look, t34);
    } else {
      const isAiming = controller.mode === 'aiming' || controller.mode === 'shot';
      const isTarget = controller.mode === 'target';

      if (isAiming) {
        // Dramatic close-up over-the-left-shoulder combat camera:
        // Positioned 2.35m behind her left shoulder, framing the rider's helmet, raised right arm, and sidearm weapon in the foreground
        // with the 45-degree angled billboard directly down her sightline on the right!
        const cameraBack = 2.35;
        const cameraSide = 1.35;
        const cameraHeight = 1.65;
        desiredCamera.copy(point).addScaledVector(tangent, -(cameraBack - (braking ? 0.2 : 0))).addScaledVector(side, cameraSide);
        desiredCamera.y = point.y + cameraHeight - (braking ? 0.05 : 0);

        // Frame the sightline from her gun barrel directly out to the roadside billboard
        const aimCenter = signFocus.clone().lerp(point.clone().addScaledVector(tangent, 3.2), 0.22);
        desiredLook.copy(aimCenter);
      } else if (isTarget) {
        const cameraBack = 3.6;
        const cameraSide = 1.75;
        const cameraHeight = 1.82;
        desiredCamera.copy(point).addScaledVector(tangent, -cameraBack).addScaledVector(side, cameraSide);
        desiredCamera.y = point.y + cameraHeight;
        desiredLook.copy(signFocus).lerp(point.clone().addScaledVector(tangent, 3.8), 0.25);
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

    const cameraRate = terminalScene
      ? THREE.MathUtils.lerp(2.6, 1.1, THREE.MathUtils.smootherstep(finaleElapsed, 11.0, 14.5))
      : (controller.mode === 'aiming' || controller.mode === 'shot')
        ? 6.8
        : 4.8;
    cameraBase.lerp(desiredCamera, 1 - Math.exp(-delta * cameraRate));
    lookAt.lerp(desiredLook, 1 - Math.exp(-delta * (terminalScene ? 3.2 : 7.2)));
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
      <group ref={visual} scale={BIKE_SCALE}>
        <primitive object={model} />
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

    {/* Dynamic Laser Tracer Beam fired from Gun in Girl's hand to Target */}
    <group ref={tracerGroup} visible={false}>
      <mesh ref={tracerMesh} geometry={tracerBeamGeometry}>
        <meshBasicMaterial color="#ffffff" transparent opacity={0.98} toneMapped={false} />
      </mesh>
      <mesh ref={tracerGlowMesh} geometry={tracerGlowGeometry}>
        <meshBasicMaterial color="#ffaa22" transparent opacity={0.65} toneMapped={false} />
      </mesh>
    </group>
    <mesh ref={tracerImpact} visible={false}>
      <sphereGeometry args={[0.38, 16, 16]} />
      <meshBasicMaterial color="#ffe882" transparent opacity={0.9} toneMapped={false} />
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

      <mesh position={[-1.85, -2.8, 0]} castShadow>
        <cylinderGeometry args={[0.11, 0.14, 3.4, 12]} />
        <meshStandardMaterial color="#3a4145" metalness={0.78} roughness={0.35} />
      </mesh>
      <mesh position={[1.85, -2.8, 0]} castShadow>
        <cylinderGeometry args={[0.11, 0.14, 3.4, 12]} />
        <meshStandardMaterial color="#3a4145" metalness={0.78} roughness={0.35} />
      </mesh>
    </group>
    {active && (mode === 'shot' || mode === 'reading') && <Sparkles count={110} scale={[5.5, 3.2, 1.8]} size={4.5} speed={1.2} color="#ffb65e" />}
    {active && showMiss && mode === 'aiming' && <Sparkles key={missPulse} count={32} scale={[3.8, 2.4, 1.2]} size={2.8} speed={1.8} color="#ef4e38" />}
    {active && <pointLight color={vulnerable ? '#ffd47b' : '#ff5944'} intensity={vulnerable ? 16 : mode === 'aiming' ? 7 : 3.5} distance={16} />}
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
  const { mode, countdown, vehicleSpeed, targetDistance, misses, aimLocked, targetVulnerable, mute, setMute, activeStop, begin, shoot } = controller;
  const [menuOpen, setMenuOpen] = useState(false);
  const [showFinale, setShowFinale] = useState(false);

  useEffect(() => {
    if (mode !== 'finale') {
      setShowFinale(false);
      return;
    }
    const timer = window.setTimeout(() => setShowFinale(true), 11500);
    return () => window.clearTimeout(timer);
  }, [mode]);

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
        const complete = controller.completedStops.includes(index);
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
      <button
        className={mode === 'finale' ? 'is-active' : ''}
        type="button"
        onClick={() => {
          setMenuOpen(false);
          controller.openFinale();
        }}
      >
        <span>★ / SUMMIT FINALE</span>
        <i className="route-menu-status">{mode === 'finale' ? 'ACTIVE' : 'PLAY FINALE'}</i>
      </button>
    </motion.nav>}</AnimatePresence>

    <div className="route-rail" aria-label={'Route progress: ' + controller.completedCount + ' of ' + PORTFOLIO_STOPS.length}>
      <span>ROUTE</span><span className="route-count">{controller.completedCount} / {PORTFOLIO_STOPS.length}</span><i /><b>{routeNumber}</b><em>{routeLabel}</em>
    </div>
    <div className="speed-cluster"><span>{playState}</span><strong>{Math.round(vehicleSpeed * 210).toString().padStart(3, '0')}</strong><small>KM/H</small></div>
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
        {mode === 'target' && <small className="target-prompt">TARGET AHEAD / MAINTAIN SPEED / SLOW-MO AT CLOSE RANGE</small>}
        {mode === 'aiming' && <button type="button" aria-label="Fire when the moving core turns gold" onClick={() => shoot(true)}>{targetVulnerable ? 'FIRE NOW / SPACE' : 'WAIT FOR GOLD / SPACE'}</button>}
        {mode === 'aiming' && misses >= 2 && <small className="aim-assist">AIM CALIBRATED</small>}
      </motion.section>}

      {mode === 'reading' && <SectionPanel controller={controller} />}

      {mode === 'finale' && !showFinale && <motion.p className="finale-sequence" initial={{ opacity: 0 }} animate={{ opacity: 1 }}>PARK / DISMOUNT / HELMET OFF / SUNSET OVERLOOK</motion.p>}

      {mode === 'finale' && showFinale && <motion.section className="finale-overlay" initial={{ opacity: 0, y: 28 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 1.1, ease: [0.16, 1, 0.3, 1] }} aria-labelledby="summit-title">
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
