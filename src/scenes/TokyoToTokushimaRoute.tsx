import React from 'react';
import {
  AbsoluteFill,
  useCurrentFrame,
  useVideoConfig,
  interpolate,
  Easing,
} from 'remotion';
import {JAPAN_ISLANDS} from '../lib/mapData';
import {
  polygonToPath,
  project,
  quadraticBezier,
  JAPAN_PROJECTION,
  CITIES,
} from '../lib/projection';
import {COLORS} from '../lib/colors';

export const TokyoToTokushimaRoute: React.FC = () => {
  const frame = useCurrentFrame();
  const {durationInFrames} = useVideoConfig();

  const jp = JAPAN_PROJECTION;

  // Screen positions
  const tokyoScreen = project(CITIES.tokyo[0], CITIES.tokyo[1], jp);
  const tokushimaScreen = project(
    CITIES.tokushima[0],
    CITIES.tokushima[1],
    jp,
  );
  const osakaScreen = project(CITIES.osaka[0], CITIES.osaka[1], jp);

  // Bezier control point — arc south of Osaka
  const controlPoint: [number, number] = [
    (tokyoScreen[0] + tokushimaScreen[0]) / 2,
    Math.max(tokyoScreen[1], tokushimaScreen[1]) + 60,
  ];

  // Route draw progress
  const routeProgress = interpolate(
    frame,
    [20, durationInFrames - 30],
    [0, 1],
    {
      extrapolateLeft: 'clamp',
      extrapolateRight: 'clamp',
      easing: Easing.inOut(Easing.cubic),
    },
  );

  // Current head position on the route
  const headPos = quadraticBezier(
    routeProgress,
    tokyoScreen,
    controlPoint,
    tokushimaScreen,
  );

  // Camera follows the route head — smooth pan
  const cameraZoom = 1.8;
  const camTargetX = 960 - headPos[0] * cameraZoom;
  const camTargetY = 540 - headPos[1] * cameraZoom;

  // Build the SVG path for the route bezier
  const routePath = `M ${tokyoScreen[0]} ${tokyoScreen[1]} Q ${controlPoint[0]} ${controlPoint[1]} ${tokushimaScreen[0]} ${tokushimaScreen[1]}`;

  // Approximate total path length for dash animation
  const pathLength = 800;
  const dashOffset = pathLength * (1 - routeProgress);

  // City label fade-in
  const tokyoLabelOpacity = interpolate(frame, [0, 20], [0, 1], {
    extrapolateRight: 'clamp',
  });
  const tokushimaLabelOpacity = interpolate(
    frame,
    [durationInFrames - 50, durationInFrames - 20],
    [0, 1],
    {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'},
  );

  // Arrival pulse
  const arrived = routeProgress > 0.95;
  const arrivalPulse = arrived ? Math.sin(frame * 0.2) * 0.4 + 1 : 0;

  return (
    <AbsoluteFill style={{backgroundColor: COLORS.background}}>
      {/* Grid background */}
      <svg
        width="1920"
        height="1080"
        style={{position: 'absolute', opacity: 0.04}}
      >
        <defs>
          <pattern
            id="grid2"
            width="40"
            height="40"
            patternUnits="userSpaceOnUse"
          >
            <path
              d="M 40 0 L 0 0 0 40"
              fill="none"
              stroke="#ffffff"
              strokeWidth="0.5"
            />
          </pattern>
        </defs>
        <rect width="1920" height="1080" fill="url(#grid2)" />
      </svg>

      {/* Map container with camera transform */}
      <div
        style={{
          position: 'absolute',
          width: '1920px',
          height: '1080px',
          transform: `translate(${camTargetX}px, ${camTargetY}px) scale(${cameraZoom})`,
          transformOrigin: '0 0',
        }}
      >
        <svg width="1920" height="1080">
          <defs>
            <filter id="glowRoute">
              <feGaussianBlur stdDeviation="4" result="blur" />
              <feMerge>
                <feMergeNode in="blur" />
                <feMergeNode in="SourceGraphic" />
              </feMerge>
            </filter>
            <filter id="softGlow">
              <feGaussianBlur stdDeviation="8" result="blur" />
              <feMerge>
                <feMergeNode in="blur" />
                <feMergeNode in="SourceGraphic" />
              </feMerge>
            </filter>
          </defs>

          {/* Japan islands */}
          {JAPAN_ISLANDS.map((island, i) => (
            <g key={i}>
              <path
                d={polygonToPath(island, jp)}
                fill={COLORS.mapFill}
                stroke={COLORS.mapStroke}
                strokeWidth="1.2"
              />
            </g>
          ))}

          {/* Route glow layer (wider, faint) */}
          <path
            d={routePath}
            fill="none"
            stroke={COLORS.routeGlow}
            strokeWidth="6"
            strokeDasharray={pathLength}
            strokeDashoffset={dashOffset}
            strokeLinecap="round"
            filter="url(#softGlow)"
          />

          {/* Route main line */}
          <path
            d={routePath}
            fill="none"
            stroke={COLORS.routeLine}
            strokeWidth="2.5"
            strokeDasharray={pathLength}
            strokeDashoffset={dashOffset}
            strokeLinecap="round"
            filter="url(#glowRoute)"
          />

          {/* Route head dot */}
          {routeProgress > 0 && routeProgress < 1 && (
            <circle
              cx={headPos[0]}
              cy={headPos[1]}
              r={5}
              fill={COLORS.routeLine}
              filter="url(#softGlow)"
            />
          )}

          {/* Tokyo marker */}
          <circle
            cx={tokyoScreen[0]}
            cy={tokyoScreen[1]}
            r={4}
            fill={COLORS.cityDot}
          />
          <g opacity={tokyoLabelOpacity}>
            <text
              x={tokyoScreen[0] + 10}
              y={tokyoScreen[1] - 8}
              fill={COLORS.labelText}
              fontSize="13"
              fontFamily="'Inter', sans-serif"
              fontWeight="600"
            >
              Tokyo
            </text>
          </g>

          {/* Osaka marker (subtle reference) */}
          <circle
            cx={osakaScreen[0]}
            cy={osakaScreen[1]}
            r={2.5}
            fill={COLORS.worldDot}
            opacity={0.5}
          />

          {/* Tokushima marker */}
          <g>
            {arrived && (
              <circle
                cx={tokushimaScreen[0]}
                cy={tokushimaScreen[1]}
                r={8 * arrivalPulse}
                fill="none"
                stroke={COLORS.cityDot}
                strokeWidth="1.5"
                opacity={0.5}
              />
            )}
            <circle
              cx={tokushimaScreen[0]}
              cy={tokushimaScreen[1]}
              r={4}
              fill={COLORS.cityDot}
            />
            <g opacity={tokushimaLabelOpacity}>
              <text
                x={tokushimaScreen[0] + 10}
                y={tokushimaScreen[1] - 8}
                fill={COLORS.labelText}
                fontSize="13"
                fontFamily="'Inter', sans-serif"
                fontWeight="600"
              >
                Tokushima
              </text>
            </g>
          </g>
        </svg>
      </div>

      {/* Vignette */}
      <div
        style={{
          position: 'absolute',
          inset: 0,
          background:
            'radial-gradient(ellipse at center, transparent 30%, rgba(10,14,26,0.8) 100%)',
          pointerEvents: 'none',
        }}
      />
    </AbsoluteFill>
  );
};
