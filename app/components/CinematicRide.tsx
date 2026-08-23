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
  shoot: () => void;
  continueRide: () => void;
  mute: boolean;
  setMute: (value: boolean) => void;
  mode: RideState;
  countdown: number;
  speed: number;
  targetProgress: number;
};

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

const tmpVector = new THREE.Vector3();
const tmpNormal = new THREE.Vector3();

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
  const [mode, setMode] = useState<RideState>('intro');
  const [countdown, setCountdown] = useState(10);
  const [speed, setSpeed] = useState(0);
  const [targetProgress, setTargetProgress] = useState(0);
  const [mute, setMute] = useState(false);
  const muteRef = useRef(false);
  const contextRef = useRef<AudioContext | null>(null);
  const mainTimeline = useRef<gsap.core.Timeline | null>(null);
  const approachTimeline = useRef<gsap.core.Timeline | null>(null);

  function sound(frequency: number, duration: number, type: OscillatorType = 'sine', volume = 0.028) {
    if (muteRef.current || typeof window === 'undefined') return;
    const AudioContextClass = window.AudioContext || (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioContextClass) return;
    const context = contextRef.current ?? new AudioContextClass();
    contextRef.current = context;
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

  function killTimelines() {
    mainTimeline.current?.kill();
    approachTimeline.current?.kill();
  }

  function beginApproach() {
    const driver = { value: 0 };
    const timeline = gsap.timeline();
    approachTimeline.current = timeline;
    timeline
      .to({}, { duration: 4.4 })
      .call(() => {
        setTargetProgress(0);
        setMode('target');
        sound(520, 0.12, 'square', 0.026);
      })
      .to(driver, {
        value: 1,
        duration: 5.2,
        ease: 'none',
        onUpdate: () => setTargetProgress(driver.value),
      })
      .call(() => {
        setMode('aiming');
        sound(760, 0.16, 'sine', 0.035);
      });
  }

  function begin() {
    killTimelines();
    setCountdown(10);
    setTargetProgress(0);
    setSpeed(0);
    setMode('countdown');
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
      setMode('riding');
      setSpeed(1);
      beginApproach();
    }, [], 2.78);
  }

  function shoot() {
    if (mode !== 'target' && mode !== 'aiming') return;
    approachTimeline.current?.kill();
    setMode('shot');
    sound(78, 0.18, 'sawtooth', 0.08);
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
        setMode('reading');
      });
  }

  function continueRide() {
    if (mode !== 'reading') return;
    const driver = { value: speed };
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
        setMode('riding');
        setTargetProgress(0);
      });
    sound(105, 0.35, 'sawtooth', 0.05);
  }


  useEffect(() => {
    muteRef.current = mute;
  }, [mute]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.code === 'Space' || event.code === 'Enter') {
        event.preventDefault();
        if (mode === 'intro') begin();
        else if (mode === 'target' || mode === 'aiming') shoot();
        else if (mode === 'reading') continueRide();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
    };
  }, [mode]);

  useEffect(() => {
    return () => {
      mainTimeline.current?.kill();
      approachTimeline.current?.kill();
      if (contextRef.current && contextRef.current.state !== 'closed') {
        void contextRef.current.close();
      }
    };
  }, []);

  return { begin, shoot, continueRide, mute, setMute, mode, countdown, speed, targetProgress };
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
function Bike({ speed }: { speed: number }) {
  const { scene } = useGLTF('/models/apoorva-cafe-rider.glb');
  const model = useMemo(() => scene.clone(true), [scene]);
  const group = useRef<THREE.Group>(null);
  const rearWheel = useMemo(() => model.getObjectByName('RearWheelSpin'), [model]);
  const frontWheel = useMemo(() => model.getObjectByName('FrontWheelSpin'), [model]);

  useFrame(({ clock }, delta) => {
    const tick = clock.getElapsedTime() * Math.max(speed, 0.15);
    if (group.current) {
      group.current.position.y = 0.52 + Math.sin(tick * 16) * 0.025 * Math.max(speed, 0.2);
      group.current.rotation.z = Math.sin(tick * 2.6) * 0.025;
    }
    if (rearWheel) rearWheel.rotation.y -= delta * speed * 18;
    if (frontWheel) frontWheel.rotation.y -= delta * speed * 18;
  });

  return <group ref={group} position={[0, 0.52, -3.1]} rotation={[0, -Math.PI / 2, 0]} scale={1.28} castShadow><primitive object={model} /></group>;
}

function CameraRig({ mode, speed }: { mode: RideState; speed: number }) {
  const { camera } = useThree();
  const lookAt = useRef(new THREE.Vector3(0, 1.2, 3));
  const desiredPosition = useRef(new THREE.Vector3(4.9, 3.2, -12.2));

  useFrame((_, delta) => {
    const focus = mode === 'target' || mode === 'aiming' || mode === 'shot';
    const slow = mode === 'reading';
    desiredPosition.current.set(focus ? 4.0 : 4.9, focus ? 3.0 : 3.2, focus ? -9.4 : -12.2);
    lookAt.current.set(focus ? 0.2 : 0, slow ? 1.45 : 1.2, focus ? 6.2 : 3.0);
    camera.position.lerp(desiredPosition.current, 1 - Math.exp(-delta * 2.6));
    camera.lookAt(lookAt.current);
    const perspective = camera as THREE.PerspectiveCamera;
    const fov = slow ? 41 : 46 + speed * 3.5;
    perspective.fov += (fov - perspective.fov) * (1 - Math.exp(-delta * 1.8));
    perspective.updateProjectionMatrix();
  });
  return null;
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
function SkillTarget({ mode, progress, onShoot }: { mode: RideState; progress: number; onShoot: () => void }) {
  const { camera } = useThree();
  const group = useRef<THREE.Group>(null);
  const board = useRef<THREE.Group>(null);
  const titleTexture = useMemo(() => createSignTexture('SKILLS', '#f7ebd5', 124), []);
  const subtitleTexture = useMemo(() => createSignTexture('UNLOCK THE TOOLKIT', '#d4a065', 34), []);
  const visible = mode === 'target' || mode === 'aiming' || mode === 'shot' || mode === 'reading';

  useFrame(({ clock }, delta) => {
    if (!group.current) return;
    group.current.visible = visible;
    if (!visible) return;
    const pathProgress = Math.max(0.36, 0.9 - progress * 0.5);
    const point = roadCurve.getPointAt(pathProgress);
    const tangent = roadCurve.getTangentAt(pathProgress).normalize();
    const side = tmpNormal.set(-tangent.z, 0, tangent.x).normalize();
    const signSide = -1;
    const position = tmpVector.copy(point).addScaledVector(side, signSide * 4.15);
    group.current.position.set(position.x, 1.55, position.z);
    group.current.rotation.y = Math.atan2(camera.position.x - position.x, camera.position.z - position.z);
    if (board.current) {
      const impact = mode === 'shot' || mode === 'reading' ? 1 : 0;
      board.current.rotation.z += ((impact ? -0.38 : 0) - board.current.rotation.z) * (1 - Math.exp(-delta * 8));
      board.current.position.y = Math.sin(clock.elapsedTime * 2.4) * 0.035;
    }
  });

  const click = (event: ThreeEvent<MouseEvent>) => {
    event.stopPropagation();
    onShoot();
  };

  return <group ref={group} visible={false}>
    <group ref={board}>
      <mesh onClick={click} castShadow receiveShadow><boxGeometry args={[3.55, 2.05, 0.16]} /><meshStandardMaterial color="#132127" metalness={0.52} roughness={0.34} /></mesh>
      <mesh position={[0, 0, 0.1]} onClick={click}><torusGeometry args={[0.37, 0.055, 10, 28]} /><meshStandardMaterial color="#e86246" emissive="#d94731" emissiveIntensity={1.2} /></mesh>
      <mesh position={[0, 0, 0.13]} onClick={click}><circleGeometry args={[0.19, 24]} /><meshBasicMaterial color="#ffd69a" /></mesh>
      <mesh position={[0, 0.61, 0.11]} onClick={click}><planeGeometry args={[2.52, 0.5]} /><meshBasicMaterial map={titleTexture} transparent depthWrite={false} /></mesh>
      <mesh position={[0, -0.65, 0.11]} onClick={click}><planeGeometry args={[2.78, 0.23]} /><meshBasicMaterial map={subtitleTexture} transparent depthWrite={false} /></mesh>
      <mesh position={[-1.13, -1.72, 0]} castShadow><cylinderGeometry args={[0.07, 0.09, 1.65, 10]} /><meshStandardMaterial color="#3a4145" metalness={0.75} roughness={0.37} /></mesh>
      <mesh position={[1.13, -1.72, 0]} castShadow><cylinderGeometry args={[0.07, 0.09, 1.65, 10]} /><meshStandardMaterial color="#3a4145" metalness={0.75} roughness={0.37} /></mesh>
    </group>
    {(mode === 'shot' || mode === 'reading') && <Sparkles count={90} scale={[3.8, 2.4, 1.4]} size={3.5} speed={1.2} color="#ffb65e" />}
    <pointLight color="#ff6b44" intensity={mode === 'aiming' ? 9 : 3} distance={11} />
  </group>;
}

function Scene({ mode, speed, targetProgress, onShoot, lowQuality }: { mode: RideState; speed: number; targetProgress: number; onShoot: () => void; lowQuality: boolean }) {
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
    <Sparkles count={lowQuality ? 42 : 115} scale={[50, 10, 74]} size={2.2} speed={0.24 * Math.max(speed, 0.16)} opacity={0.55} color="#f8d7a5" noise={2.4} />
    <Bike speed={speed} />
    <SkillTarget mode={mode} progress={targetProgress} onShoot={onShoot} />
    <CameraRig mode={mode} speed={speed} />
    <EffectComposer multisampling={0} enabled={!lowQuality}>
      <Bloom intensity={0.44} luminanceThreshold={0.84} luminanceSmoothing={0.38} mipmapBlur />
      <Vignette eskil={false} offset={0.24} darkness={0.68} />
      <SMAA />
    </EffectComposer>
  </>;
}

function Hud({ controller }: { controller: RideController }) {
  const { mode, countdown, targetProgress, speed, begin, shoot, continueRide, mute, setMute } = controller;
  const [menuOpen, setMenuOpen] = useState(false);
  const targetDistance = Math.max(40, Math.round(120 - targetProgress * 78));
  const playState = mode === 'reading' ? 'SLOW / 0.2×' : mode === 'riding' || mode === 'target' || mode === 'aiming' ? 'RIDE / LIVE' : 'SYSTEM / READY';

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
    <div className="speed-cluster"><span>{playState}</span><strong>{Math.round(26 + speed * 102).toString().padStart(3, '0')}</strong><small>KM/H</small></div>
    <div className="scene-caption"><span>ALPINE SECTOR</span><b>07° 46' N · GOLDEN HOUR</b></div>

    <AnimatePresence>
      {mode === 'intro' && <motion.section className="entry-screen" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
        <p>APOORVA RAWAT / INTERACTIVE PORTFOLIO</p><h1>RIDE INTO<br /><em>WHAT'S NEXT.</em></h1><div><span>A cinematic developer experience</span><button type="button" onClick={begin}>ENTER EXPERIENCE <b>↗</b></button></div><small>Sound recommended · Space to continue</small>
      </motion.section>}
      {mode === 'countdown' && <motion.section className="countdown-overlay" key={countdown} initial={{ opacity: 0, scale: 0.78, filter: 'blur(14px)' }} animate={{ opacity: 1, scale: 1, filter: 'blur(0px)' }} exit={{ opacity: 0, scale: 1.14, filter: 'blur(8px)' }} transition={{ duration: 0.16 }}><span>IGNITION / {countdown === 0 ? 'ENGINE ROAR' : 'SYSTEM CHECK'}</span><strong>{String(countdown).padStart(2, '0')}</strong><i>{countdown <= 3 ? 'CAMERA ARMED' : 'MOUNTAIN DRIVE'}</i></motion.section>}
      {(mode === 'target' || mode === 'aiming' || mode === 'shot') && <motion.section className={`target-readout ${mode === 'aiming' ? 'is-locked' : ''}`} initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}><span>{mode === 'aiming' ? 'TARGET LOCKED' : mode === 'shot' ? 'HIT CONFIRMED' : 'TARGET DETECTED'}</span><h2>SKILLS</h2><div><i>{mode === 'shot' ? '✦' : '◎'}</i><b>{mode === 'shot' ? 'SYSTEM UNLOCKING' : `${targetDistance}M`}</b></div>{mode !== 'shot' && <button type="button" onClick={shoot}>{mode === 'aiming' ? 'CLICK TARGET / PRESS SPACE' : 'APPROACHING SIGN'}</button>}</motion.section>}
      {mode === 'reading' && <motion.section className="skills-overlay" initial={{ opacity: 0, y: 26 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 18 }} transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1] }}>
        <div className="skills-heading"><p>01 / SKILLS UNLOCKED</p><h2>THE TOOLKIT<br /><em>BEHIND THE RIDE.</em></h2><span>World speed reduced to 20%</span></div>
        <div className="skills-columns"><article><b>FRONTEND</b><p>React<br />Next.js<br />TypeScript</p></article><article><b>3D / MOTION</b><p>Three.js<br />GSAP<br />WebGL</p></article><article><b>BACKEND</b><p>Node.js<br />APIs<br />Databases</p></article></div>
        <div className="skills-footer"><span>KEEP EXPLORING WHEN READY</span><button type="button" onClick={continueRide}>CONTINUE RIDE <b>↗</b></button></div>
      </motion.section>}
    </AnimatePresence>

    {(mode === 'target' || mode === 'aiming') && <div className="crosshair-3d" aria-hidden="true"><i /></div>}
    {(mode === 'riding' || mode === 'target' || mode === 'aiming') && <p className="ride-instruction">{mode === 'riding' ? 'THE ROAD IS OPEN' : 'CLICK THE ROADSIDE TARGET OR PRESS SPACE'}</p>}
  </div>;
}

export default function CinematicRide() {
  const controller = useRideController();
  const [lowQuality, setLowQuality] = useState(false);
  const isMobile = typeof window !== 'undefined' && window.matchMedia('(max-width: 720px), (pointer: coarse)').matches;

  return <main className="cinematic-ride">
    <Canvas shadows dpr={isMobile || lowQuality ? [1, 1.2] : [1, 1.8]} camera={{ position: [4.9, 3.2, -12.2], fov: 47 }} gl={{ antialias: true, toneMapping: THREE.ACESFilmicToneMapping, toneMappingExposure: 1.12 }}>
      <PerformanceMonitor onDecline={() => setLowQuality(true)} />
      <AdaptiveDpr pixelated />
      <Suspense fallback={null}><Scene mode={controller.mode} speed={controller.speed} targetProgress={controller.targetProgress} onShoot={controller.shoot} lowQuality={isMobile || lowQuality} /></Suspense>
    </Canvas>
    <div className="cinematic-wash" aria-hidden="true" />
    <Hud controller={controller} />
  </main>;
}

useGLTF.preload('/models/apoorva-cafe-rider.glb');
