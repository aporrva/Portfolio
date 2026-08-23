'use client';

import { AnimatePresence, motion } from 'framer-motion';
import gsap from 'gsap';
import { Suspense, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Canvas, ThreeEvent, useFrame, useThree } from '@react-three/fiber';
import { AdaptiveDpr, PerformanceMonitor, Sky, Sparkles, useGLTF } from '@react-three/drei';
import { Bloom, EffectComposer, SMAA, Vignette } from '@react-three/postprocessing';
import * as THREE from 'three';

type RideState = 'intro' | 'countdown' | 'riding' | 'target' | 'aiming' | 'shot' | 'reading';

type RideController = {
  begin: () => void;
  shoot: (confirmed?: boolean) => void;
  continueRide: () => void;
  reportApproach: (value: number, distance: number) => void;
  reportVehicleSpeed: (value: number) => void;
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
  telemetryElapsed: number;
  lastPosition: THREE.Vector3;
  hasLastPosition: boolean;
};

type DriveRef = { current: DriveRuntime };

const RIDE_START_PROGRESS = 0.31;
const SKILLS_SIGN_PROGRESS = 0.64;
const MAX_LANE_OFFSET = 1.28;
const ROUTE_TOP_SPEED = 10.5;
const CRUISE_SPEED = 0.22;
const AIM_STOP_DISTANCE = 7.5;

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
    telemetryElapsed: 0,
    lastPosition: new THREE.Vector3(),
    hasLastPosition: false,
  };
}

const roadCurve = new THREE.CatmullRomCurve3([
  new THREE.Vector3(-1.8, 0, -58),
  new THREE.Vector3(1.8, 0, -45),
  new THREE.Vector3(-2.1, 0, -27),
  new THREE.Vector3(0.5, 0, -7),
  new THREE.Vector3(-0.8, 0, 13),
  new THREE.Vector3(3.7, 0, 31),
  new THREE.Vector3(-2.4, 0, 53),
  new THREE.Vector3(0.8, 0, 78),
]);
roadCurve.curveType = 'centripetal';
const ROAD_LENGTH = roadCurve.getLength();

function createRoadGeometry(width: number, elevation: number) {
  const segments = 240;
  const positions: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];

  for (let index = 0; index <= segments; index += 1) {
    const progress = index / segments;
    const point = roadCurve.getPointAt(progress);
    const tangent = roadCurve.getTangentAt(progress).normalize();
    const side = new THREE.Vector3(-tangent.z, 0, tangent.x).normalize();
    const left = point.clone().addScaledVector(side, width / 2);
    const right = point.clone().addScaledVector(side, -width / 2);
    positions.push(left.x, elevation, left.z, right.x, elevation, right.z);
    uvs.push(0, progress * 18, 1, progress * 18);
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

function makeTerrain(size: number, segments: number, amplitude: number, zOffset = 0) {
  const geometry = new THREE.PlaneGeometry(size, size, segments, segments);
  geometry.rotateX(-Math.PI / 2);
  const position = geometry.getAttribute('position') as THREE.BufferAttribute;

  for (let index = 0; index < position.count; index += 1) {
    const x = position.getX(index);
    const z = position.getZ(index) + zOffset;
    const broad = Math.sin(x * 0.035 + z * 0.017) * amplitude * 0.33;
    const ridges = Math.sin(x * 0.095 - z * 0.041) * amplitude * 0.16;
    const detail = Math.sin(x * 0.31 + z * 0.14) * amplitude * 0.03;
    const valley = Math.exp(-(x * x) / 135) * amplitude * 0.28;
    position.setY(index, broad + ridges + detail - valley - 1.85);
  }
  geometry.computeVertexNormals();
  return geometry;
}

function useRideController(): RideController {
  const initialDistance = Math.round((SKILLS_SIGN_PROGRESS - RIDE_START_PROGRESS) * ROAD_LENGTH);
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
  const muteRef = useRef(false);
  const modeRef = useRef<RideState>('intro');
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
    const active = modeRef.current === 'riding' || modeRef.current === 'target' || modeRef.current === 'aiming' || modeRef.current === 'shot' || modeRef.current === 'reading';
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

  function reportApproach(value: number, distance: number) {
    const next = THREE.MathUtils.clamp(value, 0, 1);
    const roundedDistance = Math.max(0, Math.round(distance));
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
    } else if (modeRef.current === 'target' && next > 0.86) {
      setAimLocked(false);
      setTargetVulnerable(false);
      transition('aiming');
      sound(760, 0.16, 'sine', 0.035);
    }
  }

  function reportVehicleSpeed(value: number) {
    const next = THREE.MathUtils.clamp(value, 0, 1);
    updateEngine(next);
    if (Math.abs(next - reportedSpeed.current) > 0.014) {
      reportedSpeed.current = next;
      setVehicleSpeed(next);
    }
  }

  function begin() {
    killTimelines();
    reportedApproach.current = 0;
    reportedSpeed.current = 0;
    reportedDistance.current = initialDistance;
    targetDistanceRef.current = initialDistance;
    lastAttemptAt.current = 0;
    setAimLocked(false);
    setTargetVulnerable(false);
    setMisses(0);
    setMissPulse(0);
    setMissMessage('');
    setCountdown(10);
    setTargetProgress(0);
    setTargetDistance(initialDistance);
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
    if (modeRef.current !== 'aiming') return;
    const now = typeof performance !== 'undefined' ? performance.now() : Date.now();
    if (now - lastAttemptAt.current < 350) return;
    lastAttemptAt.current = now;

    const distance = targetDistanceRef.current;
    if (distance < 5.5 || distance > 15) {
      registerMiss('OUT OF RANGE — RIDE CLOSER');
      return;
    }
    if (!targetVulnerableRef.current) {
      registerMiss('SHIELD CLOSED — WAIT FOR GOLD');
      return;
    }
    if (!confirmed && !aimLockedRef.current) {
      registerMiss('MISS — CENTER THE CORE');
      return;
    }

    killTimelines();
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
    transition('riding');
    const driver = { value: 0.2 };
    const timeline = gsap.timeline();
    mainTimeline.current = timeline;
    timeline
      .to(driver, {
        value: 1,
        duration: 0.8,
        ease: 'power2.inOut',
        onUpdate: () => setSpeed(driver.value),
      })
      .call(() => {
        setTargetProgress(0);
      });
    sound(105, 0.35, 'sawtooth', 0.05);
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
    return () => {
      window.removeEventListener('keydown', onKey);
    };
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
      if (contextRef.current && contextRef.current.state !== 'closed') {
        void contextRef.current.close();
      }
    };
  }, []);

  return {
    begin,
    shoot,
    continueRide,
    reportApproach,
    reportVehicleSpeed,
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
  };
}

function Road() {
  const road = useMemo(() => createRoadGeometry(5.2, 0.08), []);
  const shoulder = useMemo(() => createRoadGeometry(7.15, 0.035), []);
  const lines = useMemo(() => Array.from({ length: 28 }, (_, index) => {
    const point = roadCurve.getPointAt((index + 8) / 43);
    const tangent = roadCurve.getTangentAt((index + 8) / 43).normalize();
    return { point, rotation: Math.atan2(tangent.x, tangent.z) };
  }), []);
  const railCurve = useMemo(() => {
    const points = Array.from({ length: 52 }, (_, index) => {
      const progress = 0.2 + index / 86;
      const point = roadCurve.getPointAt(progress);
      const tangent = roadCurve.getTangentAt(progress).normalize();
      const side = new THREE.Vector3(-tangent.z, 0, tangent.x).normalize();
      return point.addScaledVector(side, 3.9).setY(0.65);
    });
    return new THREE.CatmullRomCurve3(points);
  }, []);

  return <group>
    <mesh geometry={shoulder} receiveShadow><meshStandardMaterial color="#38424a" roughness={0.93} /></mesh>
    <mesh geometry={road} receiveShadow><meshStandardMaterial color="#171b20" roughness={0.82} metalness={0.03} /></mesh>
    {lines.map(({ point, rotation }, index) => <mesh key={index} position={[point.x, 0.105, point.z]} rotation={[0, rotation, 0]} receiveShadow>
      <boxGeometry args={[0.16, 0.016, 2.2]} /><meshStandardMaterial color="#e6c888" emissive="#64461e" emissiveIntensity={0.14} roughness={0.6} />
    </mesh>)}
    <mesh castShadow receiveShadow><tubeGeometry args={[railCurve, 90, 0.045, 8, false]} /><meshStandardMaterial color="#697078" metalness={0.78} roughness={0.31} /></mesh>
    {Array.from({ length: 16 }, (_, index) => {
      const progress = 0.2 + index / 30;
      const point = roadCurve.getPointAt(progress);
      const tangent = roadCurve.getTangentAt(progress).normalize();
      const side = new THREE.Vector3(-tangent.z, 0, tangent.x).normalize();
      const position = point.addScaledVector(side, 3.9);
      return <mesh key={`post-${index}`} position={[position.x, 0.32, position.z]} castShadow><cylinderGeometry args={[0.045, 0.055, 0.7, 8]} /><meshStandardMaterial color="#5b6268" metalness={0.75} roughness={0.35} /></mesh>;
    })}
  </group>;
}

function Terrain() {
  const nearTerrain = useMemo(() => makeTerrain(176, 96, 11), []);
  const distantTerrain = useMemo(() => makeTerrain(210, 48, 24, 38), []);
  const rocks = useMemo(() => Array.from({ length: 42 }, (_, index) => {
    const progress = 0.06 + (index / 46) * 0.88;
    const point = roadCurve.getPointAt(progress);
    const tangent = roadCurve.getTangentAt(progress).normalize();
    const side = new THREE.Vector3(-tangent.z, 0, tangent.x).normalize();
    const direction = index % 2 === 0 ? 1 : -1;
    const offset = 5.2 + ((index * 13) % 11);
    return {
      position: point.addScaledVector(side, direction * offset),
      scale: 0.35 + ((index * 19) % 75) / 100,
      rotation: [index * 0.9, index * 1.7, index * 0.38] as [number, number, number],
    };
  }), []);
  return <group>
    <mesh geometry={nearTerrain} receiveShadow castShadow><meshStandardMaterial color="#233e3a" roughness={0.94} flatShading /></mesh>
    <mesh geometry={distantTerrain} position={[0, -11, 46]} scale={[1.7, 1, 1.3]} receiveShadow><meshStandardMaterial color="#315369" roughness={1} flatShading /></mesh>
    {rocks.map((rock, index) => <mesh key={index} position={[rock.position.x, -0.06, rock.position.z]} rotation={rock.rotation} scale={rock.scale} castShadow receiveShadow><dodecahedronGeometry args={[1, 1]} /><meshStandardMaterial color={index % 3 ? '#405253' : '#59605c'} roughness={0.95} flatShading /></mesh>)}
  </group>;
}

function TreeField({ count = 64 }: { count?: number }) {
  const trunkRef = useRef<THREE.InstancedMesh>(null);
  const foliageRef = useRef<THREE.InstancedMesh>(null);
  const treeData = useMemo(() => Array.from({ length: count }, (_, index) => {
    const progress = 0.04 + (index / count) * 0.93;
    const point = roadCurve.getPointAt(progress);
    const tangent = roadCurve.getTangentAt(progress).normalize();
    const side = new THREE.Vector3(-tangent.z, 0, tangent.x).normalize();
    const outward = index % 2 === 0 ? 1 : -1;
    const spread = 6.2 + ((index * 23) % 70) / 10;
    return { position: point.addScaledVector(side, outward * spread), height: 1.6 + ((index * 17) % 19) / 10, rotation: index * 1.9 };
  }), [count]);

  useLayoutEffect(() => {
    const object = new THREE.Object3D();
    treeData.forEach((tree, index) => {
      object.position.set(tree.position.x, tree.height * 0.42 - 0.2, tree.position.z);
      object.rotation.set(0, tree.rotation, 0);
      object.scale.set(0.75, tree.height, 0.75);
      object.updateMatrix();
      trunkRef.current?.setMatrixAt(index, object.matrix);
      object.position.set(tree.position.x, tree.height + 0.25, tree.position.z);
      object.scale.set(1.1, tree.height * 1.3, 1.1);
      object.updateMatrix();
      foliageRef.current?.setMatrixAt(index, object.matrix);
    });
    if (trunkRef.current) trunkRef.current.instanceMatrix.needsUpdate = true;
    if (foliageRef.current) foliageRef.current.instanceMatrix.needsUpdate = true;
  }, [treeData]);

  return <group>
    <instancedMesh ref={trunkRef} args={[undefined, undefined, count]} castShadow receiveShadow><cylinderGeometry args={[0.12, 0.18, 1, 7]} /><meshStandardMaterial color="#27302c" roughness={0.92} /></instancedMesh>
    <instancedMesh ref={foliageRef} args={[undefined, undefined, count]} castShadow receiveShadow><coneGeometry args={[0.78, 1.9, 8]} /><meshStandardMaterial color="#102b2b" roughness={0.92} flatShading /></instancedMesh>
  </group>;
}

function Atmosphere() {
  const clouds = useMemo(() => [
    [-16, 8.2, 42, 4.2], [-10, 7.8, 49, 3.6], [9, 10.4, 58, 4.8], [16, 9.6, 61, 3.4], [1, 12, 76, 5.5],
  ] as const, []);
  return <group>
    <mesh position={[-18, 10.2, 53]}><sphereGeometry args={[3.25, 32, 24]} /><meshBasicMaterial color="#ffc578" toneMapped={false} /></mesh>
    <mesh position={[-18, 10.2, 53]} scale={1.72}><sphereGeometry args={[3.25, 32, 24]} /><meshBasicMaterial color="#ff9c63" transparent opacity={0.055} depthWrite={false} /></mesh>
    {clouds.map(([x, y, z, scale], index) => <group key={index} position={[x, y, z]} scale={scale}>
      <mesh scale={[1.1, 0.23, 0.34]}><sphereGeometry args={[1, 20, 12]} /><meshStandardMaterial color="#d9e2df" transparent opacity={0.13} roughness={1} /></mesh>
      <mesh position={[0.7, 0.14, 0.1]} scale={[0.72, 0.19, 0.26]}><sphereGeometry args={[1, 20, 12]} /><meshStandardMaterial color="#e9e4d8" transparent opacity={0.1} roughness={1} /></mesh>
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
  const desiredCamera = useMemo(() => new THREE.Vector3(), []);
  const desiredLook = useMemo(() => new THREE.Vector3(), []);
  const lookAt = useMemo(() => new THREE.Vector3(), []);
  const cameraBase = useMemo(() => camera.position.clone(), [camera]);
  const pathQuaternion = useMemo(() => new THREE.Quaternion(), []);
  const localForward = useMemo(() => new THREE.Vector3(1, 0, 0), []);
  const signFocus = useMemo(() => {
    const signPoint = roadCurve.getPointAt(SKILLS_SIGN_PROGRESS);
    const signTangent = roadCurve.getTangentAt(SKILLS_SIGN_PROGRESS).normalize();
    const signSide = new THREE.Vector3(-signTangent.z, 0, signTangent.x).normalize();
    return signPoint.addScaledVector(signSide, -4.15).setY(1.65);
  }, []);

  const { model, floorOffset } = useMemo(() => {
    const clone = scene.clone(true);
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
      controller.reportApproach(0, (SKILLS_SIGN_PROGRESS - RIDE_START_PROGRESS) * ROAD_LENGTH);
      controller.reportVehicleSpeed(0);
    }

    const driving = controller.mode === 'riding' || controller.mode === 'target' || controller.mode === 'aiming' || controller.mode === 'shot' || controller.mode === 'reading';
    if (controller.mode === 'shot' || controller.mode === 'reading') runtime.targetHit = true;

    const keyboardSteer = (runtime.left ? 1 : 0) - (runtime.right ? 1 : 0);
    const pointerSteer = controller.mode === 'riding' ? -runtime.pointerX * 0.72 : 0;
    const desiredSteer = THREE.MathUtils.clamp(keyboardSteer + pointerSteer, -1, 1);
    runtime.steer = THREE.MathUtils.damp(runtime.steer, desiredSteer, 6.5, delta);

    runtime.gestureThrottle = THREE.MathUtils.damp(runtime.gestureThrottle, 0, 2.8, delta);
    const heldThrottle = runtime.forward || runtime.mouseThrottle ? 1 : 0;
    const braking = runtime.brake || runtime.gestureThrottle < -0.08;
    const throttle = Math.max(heldThrottle, Math.max(0, runtime.gestureThrottle));
    let desiredVelocity = driving ? CRUISE_SPEED + (1 - CRUISE_SPEED) * throttle : 0;
    if (controller.mode === 'target') desiredVelocity = Math.min(desiredVelocity, 0.68);
    if (controller.mode === 'aiming' && !runtime.targetHit) desiredVelocity = Math.min(desiredVelocity, 0.16);
    const endBraking = runtime.progress > 0.94;
    if (braking || endBraking) desiredVelocity = 0;

    const previousVelocity = runtime.velocity;
    const velocityDelta = desiredVelocity - runtime.velocity;
    const accelerationRate = THREE.MathUtils.lerp(0.78, 0.42, runtime.velocity);
    const decelerationRate = braking || endBraking
      ? 1.65
      : controller.mode === 'aiming'
        ? 1.15
        : controller.mode === 'target'
          ? 0.52
          : 0.3;
    const velocityRate = velocityDelta >= 0 ? accelerationRate : decelerationRate;
    runtime.velocity += THREE.MathUtils.clamp(velocityDelta, -velocityRate * delta, velocityRate * delta);
    const accelerationSample = (runtime.velocity - previousVelocity) / Math.max(delta, 0.001);
    runtime.acceleration = THREE.MathUtils.damp(
      runtime.acceleration,
      THREE.MathUtils.clamp(accelerationSample, -1.8, 1.1),
      5.5,
      delta,
    );

    const timeScale = driving ? controller.speed : 0;
    if (driving) {
      const lateralSpeed = runtime.velocity * THREE.MathUtils.lerp(1.2, 2, runtime.velocity);
      runtime.lane = THREE.MathUtils.clamp(
        runtime.lane + runtime.steer * lateralSpeed * delta * timeScale,
        -MAX_LANE_OFFSET,
        MAX_LANE_OFFSET,
      );
    }

    const routeDistance = runtime.velocity * ROUTE_TOP_SPEED * delta * timeScale;
    let nextProgress = runtime.progress + routeDistance / ROAD_LENGTH;
    if (controller.mode === 'aiming' && !runtime.targetHit) {
      nextProgress = Math.min(nextProgress, SKILLS_SIGN_PROGRESS - AIM_STOP_DISTANCE / ROAD_LENGTH);
    }
    runtime.progress = THREE.MathUtils.clamp(nextProgress, RIDE_START_PROGRESS, 0.97);

    const targetDistance = Math.max(0, (SKILLS_SIGN_PROGRESS - runtime.progress) * ROAD_LENGTH);
    const approach = THREE.MathUtils.clamp((34 - targetDistance) / 24, 0, 1);
    if (!runtime.targetHit) controller.reportApproach(approach, targetDistance);

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
    const leanTarget = THREE.MathUtils.clamp(curveLean + steeringLean, -0.46, 0.46);

    heading.copy(tangent).addScaledVector(side, runtime.steer * 0.08).normalize();
    if (bikeRoot.current) {
      bikeRoot.current.position.set(point.x, floorOffset, point.z);
      pathQuaternion.setFromUnitVectors(localForward, heading);
      bikeRoot.current.quaternion.slerp(pathQuaternion, 1 - Math.exp(-delta * (10.5 + runtime.velocity * 3)));
    }
    if (visual.current) {
      visual.current.rotation.x = THREE.MathUtils.damp(visual.current.rotation.x, leanTarget, 6.8, delta);
      const pitchTarget = THREE.MathUtils.clamp(runtime.acceleration * 0.032, -0.055, 0.032);
      visual.current.rotation.z = THREE.MathUtils.damp(visual.current.rotation.z, pitchTarget, braking ? 10 : 5.5, delta);
      visual.current.position.y = THREE.MathUtils.damp(visual.current.position.y, 0, 10, delta);
    }
    if (rearWheel) rearWheel.rotation.z = -runtime.wheelAngle;
    if (frontWheel) frontWheel.rotation.z = -runtime.wheelAngle;

    const focusTarget = controller.mode === 'target' || controller.mode === 'aiming' || controller.mode === 'shot';
    const speed01 = runtime.velocity;
    const cameraBack = focusTarget ? 7.2 : THREE.MathUtils.lerp(7.6, 9.5, speed01);
    const cameraSide = focusTarget ? 1.6 : THREE.MathUtils.lerp(1.5, 0.75, speed01);
    const cameraHeight = focusTarget ? 2.35 : THREE.MathUtils.lerp(2.2, 2.65, speed01);
    desiredCamera
      .copy(point)
      .addScaledVector(tangent, -(cameraBack - (braking ? 0.4 : 0)))
      .addScaledVector(side, cameraSide);
    desiredCamera.y = point.y + cameraHeight - (braking ? 0.1 : 0);

    if (focusTarget) {
      desiredLook.copy(signFocus);
    } else {
      const lookAhead = THREE.MathUtils.lerp(5.5, 10.5, speed01);
      desiredLook
        .copy(point)
        .addScaledVector(tangent, lookAhead)
        .addScaledVector(side, runtime.steer * 0.35);
      desiredLook.y = point.y + 1.25 - runtime.pointerY * 0.2;
    }

    cameraBase.lerp(desiredCamera, 1 - Math.exp(-delta * 4.8));
    lookAt.lerp(desiredLook, 1 - Math.exp(-delta * 6.5));
    camera.position.copy(cameraBase);
    const modeShake = focusTarget ? 0.15 : controller.mode === 'reading' ? 0.08 : 1;
    const shake = speed01 * speed01 * modeShake;
    const time = clock.elapsedTime;
    camera.position.addScaledVector(side, Math.sin(time * 18.7) * 0.035 * shake);
    camera.position.y += (Math.sin(time * 23.3) + Math.sin(time * 9.1) * 0.45) * 0.018 * shake;
    camera.lookAt(lookAt);

    const perspective = camera as THREE.PerspectiveCamera;
    const desiredFov = controller.mode === 'reading'
      ? 43
      : focusTarget
        ? 52
        : 49 + speed01 * 15 - (braking ? 2.5 : 0);
    perspective.fov += (desiredFov - perspective.fov) * (1 - Math.exp(-delta * (braking ? 5.5 : 3.4)));
    perspective.updateProjectionMatrix();
  });

  return <group ref={bikeRoot}>
    <group ref={visual} scale={BIKE_SCALE} castShadow>
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
  context.font = `700 ${fontSize}px Arial`;
  context.textAlign = 'center';
  context.textBaseline = 'middle';
  context.letterSpacing = '12px';
  context.fillText(label, canvas.width / 2, canvas.height / 2 + 8);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.needsUpdate = true;
  return texture;
}
function SkillTarget({
  mode,
  misses,
  missPulse,
  onShoot,
  onAimChange,
  onVulnerabilityChange,
}: {
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
  const titleTexture = useMemo(() => createSignTexture('SKILLS', '#f7ebd5', 124), []);
  const subtitleTexture = useMemo(() => createSignTexture('TRACK THE GOLD CORE', '#d4a065', 34), []);
  const pose = useMemo(() => {
    const point = roadCurve.getPointAt(SKILLS_SIGN_PROGRESS);
    const tangent = roadCurve.getTangentAt(SKILLS_SIGN_PROGRESS).normalize();
    const side = new THREE.Vector3(-tangent.z, 0, tangent.x).normalize();
    const position = point.addScaledVector(side, -4.15);
    return {
      position: [position.x, 1.55, position.z] as [number, number, number],
      rotationY: Math.atan2(-tangent.x, -tangent.z),
    };
  }, []);
  const visible = mode === 'target' || mode === 'aiming' || mode === 'shot' || mode === 'reading';

  useEffect(() => {
    if (missPulse <= 0) return;
    missKick.current = 1;
    setShowMiss(true);
    const timer = window.setTimeout(() => setShowMiss(false), 230);
    return () => window.clearTimeout(timer);
  }, [missPulse]);

  useFrame(({ clock }, delta) => {
    if (!group.current || !visible || !board.current) return;
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
    const pulse = vulnerable ? 1.12 + Math.sin(clock.elapsedTime * 15) * 0.05 : 0.92 + Math.sin(clock.elapsedTime * 5) * 0.03;
    core.current.scale.setScalar(pulse);
  });

  const hit = (event: ThreeEvent<MouseEvent>) => {
    event.stopPropagation();
    onShoot(true);
  };
  const miss = (event: ThreeEvent<MouseEvent>) => {
    event.stopPropagation();
    if (mode === 'aiming') {
      onAimChange(false);
      onShoot(false);
    }
  };
  const lock = (event: ThreeEvent<PointerEvent>) => {
    event.stopPropagation();
    if (mode === 'aiming') onAimChange(true);
  };
  const unlock = (event: ThreeEvent<PointerEvent>) => {
    event.stopPropagation();
    onAimChange(false);
  };

  const assist = misses >= 2;
  return <group ref={group} visible={visible} position={pose.position} rotation={[0, pose.rotationY, 0]}>
    <group ref={board}>
      <mesh onClick={miss} position={[0, 0, 0.1]}>
        <planeGeometry args={[3.82, 2.28]} />
        <meshBasicMaterial transparent opacity={0} depthWrite={false} />
      </mesh>
      <mesh castShadow receiveShadow>
        <boxGeometry args={[3.55, 2.05, 0.16]} />
        <meshStandardMaterial color="#132127" metalness={0.52} roughness={0.34} />
      </mesh>
      <mesh position={[0, 0.61, 0.11]}>
        <planeGeometry args={[2.52, 0.5]} />
        <meshBasicMaterial map={titleTexture} transparent depthWrite={false} />
      </mesh>
      <mesh position={[0, -0.65, 0.11]}>
        <planeGeometry args={[2.78, 0.23]} />
        <meshBasicMaterial map={subtitleTexture} transparent depthWrite={false} />
      </mesh>

      <group ref={core} position={[0, 0, 0.16]}>
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
      </group>

      <mesh position={[-1.13, -1.72, 0]} castShadow>
        <cylinderGeometry args={[0.07, 0.09, 1.65, 10]} />
        <meshStandardMaterial color="#3a4145" metalness={0.75} roughness={0.37} />
      </mesh>
      <mesh position={[1.13, -1.72, 0]} castShadow>
        <cylinderGeometry args={[0.07, 0.09, 1.65, 10]} />
        <meshStandardMaterial color="#3a4145" metalness={0.75} roughness={0.37} />
      </mesh>
    </group>
    {(mode === 'shot' || mode === 'reading') && <Sparkles count={90} scale={[3.8, 2.4, 1.4]} size={3.5} speed={1.2} color="#ffb65e" />}
    {showMiss && mode === 'aiming' && <Sparkles key={missPulse} count={24} scale={[2.8, 1.8, 0.8]} size={2.2} speed={1.8} color="#ef4e38" />}
    <pointLight color={vulnerable ? '#ffd47b' : '#ff5944'} intensity={vulnerable ? 12 : mode === 'aiming' ? 5 : 2.5} distance={12} />
  </group>;
}

function Scene({ controller, drive, lowQuality }: { controller: RideController; drive: DriveRef; lowQuality: boolean }) {
  return <>
    <color attach="background" args={['#657d8b']} />
    <fog attach="fog" args={['#6c8190', 18, 112]} />
    <ambientLight intensity={0.82} color="#8cb7cc" />
    <hemisphereLight args={['#88b6d1', '#263a31', 1.25]} />
    <directionalLight position={[-28, 30, -20]} color="#ffc37c" intensity={3.1} castShadow shadow-mapSize={lowQuality ? 512 : 1024} shadow-bias={-0.00025} />
    <pointLight position={[3, 5, -3]} color="#ff8158" intensity={2.2} distance={18} />
    <Sky distance={450000} sunPosition={[-20, 14, -42]} inclination={0.46} azimuth={0.18} turbidity={5.2} rayleigh={1.2} mieCoefficient={0.008} mieDirectionalG={0.84} />
    <Atmosphere />
    <Terrain />
    <Road />
    <TreeField count={lowQuality ? 32 : 68} />
    <Sparkles count={lowQuality ? 42 : 115} scale={[50, 10, 74]} size={2.5} speed={0.3 + controller.vehicleSpeed * 1.6} opacity={0.58} color="#f8d7a5" noise={2.4} />
    <RideRig controller={controller} drive={drive} />
    <SkillTarget
      mode={controller.mode}
      misses={controller.misses}
      missPulse={controller.missPulse}
      onShoot={controller.shoot}
      onAimChange={controller.setAimLocked}
      onVulnerabilityChange={controller.setTargetVulnerable}
    />
    <EffectComposer multisampling={0} enabled={!lowQuality}>
      <Bloom intensity={0.44} luminanceThreshold={0.84} luminanceSmoothing={0.38} mipmapBlur />
      <Vignette eskil={false} offset={0.24} darkness={0.68} />
      <SMAA />
    </EffectComposer>
  </>;
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
    begin,
    shoot,
    continueRide,
    mute,
    setMute,
  } = controller;
  const [menuOpen, setMenuOpen] = useState(false);
  const playState = mode === 'reading'
    ? 'SLOW / 0.2×'
    : vehicleSpeed > 0.72
      ? 'RIDE / REDLINE'
      : mode === 'riding' || mode === 'target' || mode === 'aiming'
        ? 'RIDE / LIVE'
        : 'SYSTEM / READY';
  const driving = mode === 'riding' || mode === 'target' || mode === 'aiming';
  const targetStatus = mode === 'shot'
    ? 'HIT CONFIRMED'
    : mode === 'aiming'
      ? missMessage || (targetVulnerable ? 'CORE OPEN' : 'SHIELD CYCLING')
      : 'TARGET DETECTED';

  const hold = (control: 'forward' | 'brake' | 'left' | 'right', active: boolean) => {
    drive.current[control] = active;
  };

  return <div className="ride-ui">
    <header className="ride-header">
      <button className="ride-mark" type="button" onClick={() => window.location.reload()} aria-label="Restart experience"><span>AR</span><i>APOORVA RAWAT</i></button>
      <div className="header-actions"><button className="sound-button" type="button" onClick={() => setMute(!mute)} aria-label={mute ? 'Enable sound' : 'Mute sound'}>{mute ? 'SOUND OFF' : 'SOUND ON'}</button><button className="menu-button-3d" type="button" onClick={() => setMenuOpen((value) => !value)} aria-expanded={menuOpen}>MENU <b>＋</b></button></div>
    </header>

    <AnimatePresence>{menuOpen && <motion.nav className="route-menu" initial={{ opacity: 0, y: -14 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -14 }} aria-label="Portfolio navigation">
      <div><span>DIRECT ACCESS</span><button type="button" onClick={() => setMenuOpen(false)}>×</button></div>
      <button type="button" onClick={() => { setMenuOpen(false); if (mode === 'intro') begin(); }}>SKILLS <i>01 / ACTIVE</i></button>
      {['ABOUT', 'EXPERIENCE', 'PROJECTS', 'RESUME', 'CONTACT'].map((item) => <span key={item}>{item}<i>UP NEXT</i></span>)}
    </motion.nav>}</AnimatePresence>

    <div className="route-rail" aria-label="Route progress"><span>ROUTE</span><i /> <b>01</b><em>SKILLS</em></div>
    <div className="speed-cluster"><span>{playState}</span><strong>{Math.round(vehicleSpeed * 168).toString().padStart(3, '0')}</strong><small>KM/H</small></div>
    <div className="scene-caption"><span>ALPINE REDLINE</span><b>FULL 3D RIDE · MOVING TARGET</b></div>

    {driving && <div className="drive-pad" aria-label="Motorcycle controls">
      <span>DRIVE</span>
      <button className="drive-up" type="button" aria-label="Accelerate" onPointerDown={(event) => { event.preventDefault(); hold('forward', true); }} onPointerUp={() => hold('forward', false)} onPointerCancel={() => hold('forward', false)} onPointerLeave={() => hold('forward', false)}>↑<i>W</i></button>
      <button className="drive-left" type="button" aria-label="Steer left" onPointerDown={(event) => { event.preventDefault(); hold('left', true); }} onPointerUp={() => hold('left', false)} onPointerCancel={() => hold('left', false)} onPointerLeave={() => hold('left', false)}>←<i>A</i></button>
      <button className="drive-down" type="button" aria-label="Brake" onPointerDown={(event) => { event.preventDefault(); hold('brake', true); }} onPointerUp={() => hold('brake', false)} onPointerCancel={() => hold('brake', false)} onPointerLeave={() => hold('brake', false)}>↓<i>S</i></button>
      <button className="drive-right" type="button" aria-label="Steer right" onPointerDown={(event) => { event.preventDefault(); hold('right', true); }} onPointerUp={() => hold('right', false)} onPointerCancel={() => hold('right', false)} onPointerLeave={() => hold('right', false)}>→<i>D</i></button>
    </div>}

    <AnimatePresence>
      {mode === 'intro' && <motion.section className="entry-screen" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
        <p>APOORVA RAWAT / INTERACTIVE PORTFOLIO</p><h1>RIDE INTO<br /><em>WHAT'S NEXT.</em></h1><div><span>A high-speed cinematic developer experience</span><button type="button" onClick={begin}>ENTER EXPERIENCE <b>↗</b></button></div><small>HOLD W / ↑ FOR FULL THROTTLE · A D TO STEER · S TO BRAKE</small>
      </motion.section>}
      {mode === 'countdown' && <motion.section className="countdown-overlay" key={countdown} initial={{ opacity: 0, scale: 0.78, filter: 'blur(14px)' }} animate={{ opacity: 1, scale: 1, filter: 'blur(0px)' }} exit={{ opacity: 0, scale: 1.14, filter: 'blur(8px)' }} transition={{ duration: 0.16 }}><span>IGNITION / {countdown === 0 ? 'ENGINE ROAR' : 'SYSTEM CHECK'}</span><strong>{String(countdown).padStart(2, '0')}</strong><i>{countdown <= 3 ? 'RIDER CONTROL ONLINE' : 'MOUNTAIN DRIVE'}</i></motion.section>}
      {(mode === 'target' || mode === 'aiming' || mode === 'shot') && <motion.section
        className={'target-readout' + (targetVulnerable ? ' is-open' : '') + (targetVulnerable && aimLocked ? ' is-locked' : '')}
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0 }}
      >
        <span aria-live="polite">{targetStatus}</span>
        <h2>SKILLS</h2>
        <div>
          <i>{mode === 'shot' ? '✦' : targetVulnerable ? '◉' : '◎'}</i>
          <b>{mode === 'shot' ? 'SYSTEM UNLOCKING' : mode === 'aiming' ? (targetVulnerable ? 'GOLD WINDOW' : 'TRACK CORE') + ' · ' + misses + ' MISS' + (misses === 1 ? '' : 'ES') : targetDistance + 'M'}</b>
        </div>
        {mode === 'target' && <small className="target-prompt">TARGET AHEAD · HOLD YOUR LINE</small>}
        {mode === 'aiming' && <button type="button" aria-label="Fire when the moving core turns gold" onClick={() => shoot(true)}>{targetVulnerable ? 'FIRE NOW / SPACE' : 'WAIT FOR GOLD / SPACE'}</button>}
        {mode === 'aiming' && misses >= 2 && <small className="aim-assist">AIM CALIBRATED</small>}
      </motion.section>}
      {mode === 'reading' && <motion.section className="skills-overlay" initial={{ opacity: 0, y: 26 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 18 }} transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1] }}>
        <div className="skills-heading"><p>01 / SKILLS UNLOCKED</p><h2>THE TOOLKIT<br /><em>BEHIND THE RIDE.</em></h2><span>World speed reduced to 20%</span></div>
        <div className="skills-columns"><article><b>FRONTEND</b><p>React<br />Next.js<br />TypeScript</p></article><article><b>3D / MOTION</b><p>Three.js<br />GSAP<br />WebGL</p></article><article><b>BACKEND</b><p>Node.js<br />APIs<br />Databases</p></article></div>
        <div className="skills-footer"><span>KEEP EXPLORING WHEN READY</span><button type="button" onClick={continueRide}>CONTINUE RIDE <b>↗</b></button></div>
      </motion.section>}
    </AnimatePresence>

    {(mode === 'target' || mode === 'aiming') && <div className={'crosshair-3d' + (targetVulnerable && aimLocked ? ' is-hot' : '')} aria-hidden="true"><i /></div>}
    {driving && <p className="ride-instruction">{mode === 'riding'
      ? 'FULL THROTTLE W / ↑ / HOLD MOUSE · A D TO LEAN · S / ↓ TO BRAKE'
      : mode === 'target'
        ? 'TARGET AHEAD · BRAKE LATE · MOVE INTO RANGE'
        : 'TRACK THE MOVING CORE · GOLD = FIRE · RED = WAIT'}</p>}
  </div>;
}

export default function CinematicRide() {
  const controller = useRideController();
  const drive = useRef<DriveRuntime>(createDriveRuntime());
  const [lowQuality, setLowQuality] = useState(false);
  const isMobile = typeof window !== 'undefined' && window.matchMedia('(max-width: 720px), (pointer: coarse)').matches;
  const swipeY = useRef<number | null>(null);
  const swipePointer = useRef<number | null>(null);
  const canDrive = controller.mode === 'riding' || controller.mode === 'target' || controller.mode === 'aiming';

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
          if (controller.mode === 'riding') event.currentTarget.setPointerCapture(event.pointerId);
        }
        return;
      }
      if (event.button === 0 && !interactive) drive.current.mouseThrottle = true;
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
