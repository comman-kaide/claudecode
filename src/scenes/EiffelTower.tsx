import React, {useRef, useMemo} from 'react';
import {
  AbsoluteFill,
  useCurrentFrame,
  useVideoConfig,
  interpolate,
  Easing,
} from 'remotion';
import {ThreeCanvas} from '@remotion/three';
import {useThree} from '@react-three/fiber';
import * as THREE from 'three';
import {COLORS} from '../lib/colors';

/* ------------------------------------------------------------------ */
/*  Beam — a rectangular beam oriented from `start` to `end`          */
/* ------------------------------------------------------------------ */
const Beam: React.FC<{
  start: [number, number, number];
  end: [number, number, number];
  thickness: number;
  color: string;
  opacity?: number;
}> = ({start, end, thickness, color, opacity = 1}) => {
  const mesh = useRef<THREE.Mesh>(null);

  const {position, quaternion, length} = useMemo(() => {
    const s = new THREE.Vector3(...start);
    const e = new THREE.Vector3(...end);
    const mid = s.clone().add(e).multiplyScalar(0.5);
    const dir = e.clone().sub(s);
    const len = dir.length();
    dir.normalize();
    const q = new THREE.Quaternion();
    q.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir);
    return {
      position: mid.toArray() as [number, number, number],
      quaternion: q,
      length: len,
    };
  }, [start, end]);

  return (
    <mesh ref={mesh} position={position} quaternion={quaternion}>
      <boxGeometry args={[thickness, length, thickness]} />
      <meshStandardMaterial
        color={color}
        metalness={0.75}
        roughness={0.25}
        transparent={opacity < 1}
        opacity={opacity}
      />
    </mesh>
  );
};

/* ------------------------------------------------------------------ */
/*  Platform — horizontal ring at a given height                       */
/* ------------------------------------------------------------------ */
const Platform: React.FC<{
  y: number;
  halfWidth: number;
  thickness: number;
  color: string;
}> = ({y, halfWidth, thickness, color}) => {
  const size = halfWidth * 2;
  return (
    <mesh position={[0, y, 0]} rotation={[Math.PI / 2, 0, 0]}>
      <ringGeometry args={[size * 0.75, size, 4]} />
      <meshStandardMaterial
        color={color}
        metalness={0.7}
        roughness={0.3}
        side={THREE.DoubleSide}
      />
    </mesh>
  );
};

/* ------------------------------------------------------------------ */
/*  EiffelTowerModel — procedural 3D Eiffel Tower                      */
/* ------------------------------------------------------------------ */
const EiffelTowerModel: React.FC<{buildProgress: number}> = ({
  buildProgress,
}) => {
  const gold = COLORS.eiffelGold;
  const dark = COLORS.eiffelDark;

  // Tower profile: [y-height, halfWidth]
  const levels = [
    {y: 0, hw: 2.0},
    {y: 1.7, hw: 1.1},
    {y: 3.5, hw: 0.65},
    {y: 7.0, hw: 0.3},
    {y: 10.0, hw: 0.06},
  ];

  // Four corners of the square base
  const corners: [number, number][] = [
    [1, 1],
    [1, -1],
    [-1, -1],
    [-1, 1],
  ];

  const visibleHeight = buildProgress * 10.5;

  return (
    <group>
      {/* Main legs — four legs for each section */}
      {levels.slice(0, -1).map((level, idx) => {
        const next = levels[idx + 1];
        if (next.y > visibleHeight) return null;
        const sectionOpacity = interpolate(
          visibleHeight,
          [level.y, next.y],
          [0.3, 1],
          {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'},
        );

        return (
          <group key={`section-${idx}`}>
            {corners.map(([cx, cz], ci) => (
              <Beam
                key={`leg-${idx}-${ci}`}
                start={[cx * level.hw, level.y, cz * level.hw]}
                end={[cx * next.hw, Math.min(next.y, visibleHeight), cz * next.hw]}
                thickness={idx < 2 ? 0.12 : 0.08}
                color={idx % 2 === 0 ? gold : dark}
                opacity={sectionOpacity}
              />
            ))}

            {/* Horizontal braces at each level */}
            {corners.map(([cx, cz], ci) => {
              const ni = (ci + 1) % 4;
              const [nx, nz] = corners[ni];
              if (next.y > visibleHeight) return null;
              return (
                <Beam
                  key={`hbrace-${idx}-${ci}`}
                  start={[cx * next.hw, next.y, cz * next.hw]}
                  end={[nx * next.hw, next.y, nz * next.hw]}
                  thickness={0.06}
                  color={gold}
                  opacity={sectionOpacity}
                />
              );
            })}

            {/* Diagonal cross-bracing on each face */}
            {idx < 3 &&
              corners.map(([cx, cz], ci) => {
                const ni = (ci + 1) % 4;
                const [nx, nz] = corners[ni];
                if (next.y > visibleHeight) return null;
                return (
                  <React.Fragment key={`xbrace-${idx}-${ci}`}>
                    <Beam
                      start={[cx * level.hw, level.y, cz * level.hw]}
                      end={[nx * next.hw, next.y, nz * next.hw]}
                      thickness={0.04}
                      color={dark}
                      opacity={sectionOpacity * 0.7}
                    />
                    <Beam
                      start={[nx * level.hw, level.y, nz * level.hw]}
                      end={[cx * next.hw, next.y, cz * next.hw]}
                      thickness={0.04}
                      color={dark}
                      opacity={sectionOpacity * 0.7}
                    />
                  </React.Fragment>
                );
              })}
          </group>
        );
      })}

      {/* Platforms */}
      {levels.slice(1, 4).map((level, i) =>
        level.y <= visibleHeight ? (
          <Platform
            key={`platform-${i}`}
            y={level.y}
            halfWidth={level.hw}
            thickness={0.08}
            color={gold}
          />
        ) : null,
      )}

      {/* Antenna / spire at the top */}
      {visibleHeight > 9.5 && (
        <Beam
          start={[0, 10, 0]}
          end={[0, 11.5, 0]}
          thickness={0.03}
          color={gold}
        />
      )}

      {/* Base arches (decorative curved effect — approximated with angled beams) */}
      {corners.map(([cx, cz], ci) => {
        const ni = (ci + 1) % 4;
        const [nx, nz] = corners[ni];
        const midX = ((cx + nx) / 2) * levels[0].hw * 0.7;
        const midZ = ((cz + nz) / 2) * levels[0].hw * 0.7;
        if (visibleHeight < 1.0) return null;
        return (
          <React.Fragment key={`arch-${ci}`}>
            <Beam
              start={[cx * levels[0].hw, 0, cz * levels[0].hw]}
              end={[midX, 1.2, midZ]}
              thickness={0.08}
              color={gold}
            />
            <Beam
              start={[midX, 1.2, midZ]}
              end={[nx * levels[0].hw, 0, nz * levels[0].hw]}
              thickness={0.08}
              color={gold}
            />
          </React.Fragment>
        );
      })}
    </group>
  );
};

/* ------------------------------------------------------------------ */
/*  CameraRig — animates the Three.js camera                          */
/* ------------------------------------------------------------------ */
const CameraRig: React.FC<{
  frame: number;
  durationInFrames: number;
}> = ({frame, durationInFrames}) => {
  const {camera} = useThree();

  // Camera orbit: start low looking up, pull back and orbit
  const orbitAngle = interpolate(
    frame,
    [0, durationInFrames],
    [0, Math.PI * 1.5],
    {extrapolateRight: 'clamp'},
  );

  const cameraDistance = interpolate(
    frame,
    [0, durationInFrames * 0.3, durationInFrames],
    [6, 14, 18],
    {extrapolateRight: 'clamp', easing: Easing.out(Easing.cubic)},
  );

  const cameraHeight = interpolate(
    frame,
    [0, durationInFrames * 0.3, durationInFrames],
    [2, 5, 7],
    {extrapolateRight: 'clamp', easing: Easing.out(Easing.cubic)},
  );

  const lookAtY = interpolate(
    frame,
    [0, durationInFrames * 0.4],
    [3, 5],
    {extrapolateRight: 'clamp'},
  );

  camera.position.set(
    Math.cos(orbitAngle) * cameraDistance,
    cameraHeight,
    Math.sin(orbitAngle) * cameraDistance,
  );
  camera.lookAt(0, lookAtY, 0);
  camera.updateProjectionMatrix();

  return null;
};

/* ------------------------------------------------------------------ */
/*  Starfield background particles                                     */
/* ------------------------------------------------------------------ */
const Stars: React.FC<{count: number}> = ({count}) => {
  const positions = useMemo(() => {
    const arr = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      arr[i * 3] = (Math.random() - 0.5) * 80;
      arr[i * 3 + 1] = Math.random() * 40 + 5;
      arr[i * 3 + 2] = (Math.random() - 0.5) * 80;
    }
    return arr;
  }, [count]);

  return (
    <points>
      <bufferGeometry>
        <bufferAttribute
          attach="attributes-position"
          args={[positions, 3]}
        />
      </bufferGeometry>
      <pointsMaterial color="#ffffff" size={0.08} sizeAttenuation />
    </points>
  );
};

/* ------------------------------------------------------------------ */
/*  Ground plane                                                       */
/* ------------------------------------------------------------------ */
const Ground: React.FC = () => (
  <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.01, 0]}>
    <planeGeometry args={[60, 60]} />
    <meshStandardMaterial color="#0d1117" metalness={0.2} roughness={0.9} />
  </mesh>
);

/* ------------------------------------------------------------------ */
/*  Main EiffelTower scene                                             */
/* ------------------------------------------------------------------ */
export const EiffelTowerScene: React.FC = () => {
  const frame = useCurrentFrame();
  const {durationInFrames} = useVideoConfig();

  // Build-up progress: tower constructs from bottom to top
  const buildProgress = interpolate(
    frame,
    [0, durationInFrames * 0.45],
    [0, 1],
    {
      extrapolateLeft: 'clamp',
      extrapolateRight: 'clamp',
      easing: Easing.out(Easing.quad),
    },
  );

  // Title fade in
  const titleOpacity = interpolate(frame, [10, 40], [0, 1], {
    extrapolateRight: 'clamp',
  });
  const titleY = interpolate(frame, [10, 40], [20, 0], {
    extrapolateRight: 'clamp',
    easing: Easing.out(Easing.cubic),
  });

  return (
    <AbsoluteFill
      style={{
        background: `linear-gradient(180deg, ${COLORS.skyTop} 0%, ${COLORS.skyBottom} 100%)`,
      }}
    >
      <ThreeCanvas
        width={1920}
        height={1080}
        camera={{fov: 50, near: 0.1, far: 200, position: [6, 2, 0]}}
        style={{width: '100%', height: '100%'}}
      >
        {/* Lighting */}
        <ambientLight intensity={0.3} color="#b8c4ff" />
        <directionalLight
          position={[10, 15, 5]}
          intensity={1.2}
          color="#ffeebb"
          castShadow
        />
        <directionalLight
          position={[-5, 8, -8]}
          intensity={0.4}
          color="#aaccff"
        />
        <pointLight
          position={[0, 2, 3]}
          intensity={0.8}
          color="#ffaa44"
          distance={15}
        />
        {/* Warm up-light from below */}
        <pointLight
          position={[0, 0.5, 0]}
          intensity={0.5}
          color="#ff8833"
          distance={8}
        />

        {/* Camera animation */}
        <CameraRig frame={frame} durationInFrames={durationInFrames} />

        {/* Scene content */}
        <Stars count={300} />
        <Ground />
        <EiffelTowerModel buildProgress={buildProgress} />

        {/* Fog for depth */}
        <fog attach="fog" args={['#0c1445', 25, 80]} />
      </ThreeCanvas>

      {/* Title overlay */}
      <div
        style={{
          position: 'absolute',
          bottom: 80,
          left: 0,
          right: 0,
          textAlign: 'center',
          opacity: titleOpacity,
          transform: `translateY(${titleY}px)`,
        }}
      >
        <div
          style={{
            color: COLORS.eiffelGold,
            fontSize: 48,
            fontFamily: "'Georgia', 'Times New Roman', serif",
            fontWeight: 700,
            letterSpacing: '6px',
            textShadow: '0 2px 20px rgba(212, 168, 67, 0.5)',
          }}
        >
          PARIS
        </div>
        <div
          style={{
            color: COLORS.labelText,
            fontSize: 16,
            fontFamily: "'Inter', sans-serif",
            fontWeight: 300,
            letterSpacing: '8px',
            marginTop: 8,
            textTransform: 'uppercase',
          }}
        >
          La Tour Eiffel
        </div>
      </div>
    </AbsoluteFill>
  );
};
