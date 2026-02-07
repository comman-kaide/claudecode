import React from 'react';
import {
  AbsoluteFill,
  useCurrentFrame,
  useVideoConfig,
  interpolate,
  Easing,
} from 'remotion';
import {
  EURASIA_OUTLINE,
  AFRICA_OUTLINE,
  WORLD_CITIES,
} from '../lib/mapData';
import {
  polygonToPath,
  project,
  quadraticBezier,
  WORLD_PROJECTION,
  CITIES,
} from '../lib/projection';
import {COLORS} from '../lib/colors';

export const WorldRoute: React.FC = () => {
  const frame = useCurrentFrame();
  const {durationInFrames} = useVideoConfig();

  const wp = WORLD_PROJECTION;

  // Screen positions
  const tokyoScreen = project(CITIES.tokyo[0], CITIES.tokyo[1], wp);
  const parisScreen = project(CITIES.paris[0], CITIES.paris[1], wp);

  // Control point for the arc — curves north over Russia
  const controlPoint: [number, number] = [
    (tokyoScreen[0] + parisScreen[0]) / 2,
    Math.min(tokyoScreen[1], parisScreen[1]) - 120,
  ];

  // Phase 1: zoom transition (0-30% of frames)
  const zoomPhase = durationInFrames * 0.25;
  // Phase 2: route draw (25-90% of frames)
  const routeStart = durationInFrames * 0.2;
  const routeEnd = durationInFrames * 0.9;

  const mapScale = interpolate(frame, [0, zoomPhase], [2.5, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
    easing: Easing.out(Easing.cubic),
  });

  const mapOpacity = interpolate(frame, [0, 20], [0, 1], {
    extrapolateRight: 'clamp',
  });

  // Route progress
  const routeProgress = interpolate(frame, [routeStart, routeEnd], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
    easing: Easing.inOut(Easing.cubic),
  });

  const headPos = quadraticBezier(
    routeProgress,
    tokyoScreen,
    controlPoint,
    parisScreen,
  );

  // Camera follow with gentle panning
  const panX = interpolate(
    routeProgress,
    [0, 1],
    [960 - tokyoScreen[0], 960 - parisScreen[0]],
    {extrapolateRight: 'clamp'},
  );
  const panY = interpolate(
    routeProgress,
    [0, 1],
    [540 - tokyoScreen[1], 540 - parisScreen[1]],
    {extrapolateRight: 'clamp'},
  );

  const routePath = `M ${tokyoScreen[0]} ${tokyoScreen[1]} Q ${controlPoint[0]} ${controlPoint[1]} ${parisScreen[0]} ${parisScreen[1]}`;
  const pathLength = 1200;
  const dashOffset = pathLength * (1 - routeProgress);

  // Paris label
  const parisLabelOpacity = interpolate(
    frame,
    [routeEnd - 20, routeEnd + 10],
    [0, 1],
    {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'},
  );

  const arrivedParis = routeProgress > 0.95;
  const parisPulse = arrivedParis ? Math.sin(frame * 0.2) * 0.3 + 1 : 0;

  return (
    <AbsoluteFill style={{backgroundColor: COLORS.background}}>
      <div
        style={{
          position: 'absolute',
          width: '1920px',
          height: '1080px',
          transform: `translate(${panX * mapScale}px, ${panY * mapScale}px) scale(${mapScale})`,
          transformOrigin: '960px 540px',
          opacity: mapOpacity,
        }}
      >
        <svg width="1920" height="1080">
          <defs>
            <filter id="worldGlow">
              <feGaussianBlur stdDeviation="3" result="blur" />
              <feMerge>
                <feMergeNode in="blur" />
                <feMergeNode in="SourceGraphic" />
              </feMerge>
            </filter>
            <filter id="routeGlowW">
              <feGaussianBlur stdDeviation="6" result="blur" />
              <feMerge>
                <feMergeNode in="blur" />
                <feMergeNode in="SourceGraphic" />
              </feMerge>
            </filter>
          </defs>

          {/* Continent outlines */}
          <path
            d={polygonToPath(EURASIA_OUTLINE, wp)}
            fill={COLORS.mapFill}
            stroke={COLORS.mapStrokeLight}
            strokeWidth="1"
          />
          <path
            d={polygonToPath(AFRICA_OUTLINE, wp)}
            fill={COLORS.mapFill}
            stroke={COLORS.mapStrokeLight}
            strokeWidth="1"
          />

          {/* World city dots */}
          {WORLD_CITIES.map((city) => {
            const [cx, cy] = project(city.coords[0], city.coords[1], wp);
            const isMajor =
              city.name === 'Tokyo' || city.name === 'Paris';
            return (
              <g key={city.name}>
                <circle
                  cx={cx}
                  cy={cy}
                  r={isMajor ? 4 : 2}
                  fill={isMajor ? COLORS.cityDot : COLORS.worldDot}
                  opacity={isMajor ? 1 : 0.5}
                />
                {isMajor && (
                  <text
                    x={cx + 8}
                    y={cy - 8}
                    fill={COLORS.labelText}
                    fontSize="12"
                    fontFamily="'Inter', sans-serif"
                    fontWeight="600"
                    opacity={
                      city.name === 'Paris' ? parisLabelOpacity : 1
                    }
                  >
                    {city.name}
                  </text>
                )}
              </g>
            );
          })}

          {/* Route glow */}
          <path
            d={routePath}
            fill="none"
            stroke={COLORS.routeGlow}
            strokeWidth="5"
            strokeDasharray={pathLength}
            strokeDashoffset={dashOffset}
            strokeLinecap="round"
            filter="url(#routeGlowW)"
          />

          {/* Route line */}
          <path
            d={routePath}
            fill="none"
            stroke={COLORS.routeLine}
            strokeWidth="2"
            strokeDasharray={pathLength}
            strokeDashoffset={dashOffset}
            strokeLinecap="round"
            filter="url(#worldGlow)"
          />

          {/* Route head */}
          {routeProgress > 0.01 && routeProgress < 0.99 && (
            <circle
              cx={headPos[0]}
              cy={headPos[1]}
              r={4}
              fill={COLORS.routeLine}
              filter="url(#routeGlowW)"
            />
          )}

          {/* Paris arrival pulse */}
          {arrivedParis && (
            <circle
              cx={parisScreen[0]}
              cy={parisScreen[1]}
              r={10 * parisPulse}
              fill="none"
              stroke={COLORS.cityDot}
              strokeWidth="1.5"
              opacity={0.6}
            />
          )}
        </svg>
      </div>

      {/* Journey label */}
      <div
        style={{
          position: 'absolute',
          bottom: 60,
          left: 0,
          right: 0,
          textAlign: 'center',
          opacity: interpolate(frame, [10, 40], [0, 1], {
            extrapolateRight: 'clamp',
          }),
        }}
      >
        <span
          style={{
            color: COLORS.labelText,
            fontSize: 18,
            fontFamily: "'Inter', sans-serif",
            fontWeight: 300,
            letterSpacing: '4px',
            textTransform: 'uppercase',
          }}
        >
          Next stop — Paris
        </span>
      </div>

      {/* Vignette */}
      <div
        style={{
          position: 'absolute',
          inset: 0,
          background:
            'radial-gradient(ellipse at center, transparent 35%, rgba(10,14,26,0.8) 100%)',
          pointerEvents: 'none',
        }}
      />
    </AbsoluteFill>
  );
};
