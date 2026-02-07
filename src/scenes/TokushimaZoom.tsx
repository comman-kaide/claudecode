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
  JAPAN_PROJECTION,
  CITIES,
} from '../lib/projection';
import {COLORS} from '../lib/colors';

export const TokushimaZoom: React.FC = () => {
  const frame = useCurrentFrame();
  const {durationInFrames} = useVideoConfig();

  // Zoom from 6x down to 1.2x, keeping Tokushima centered
  const zoom = interpolate(frame, [0, durationInFrames * 0.85], [6, 1.2], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
    easing: Easing.out(Easing.cubic),
  });

  // Tokushima screen position at the Japan projection
  const [tokX, tokY] = project(
    CITIES.tokushima[0],
    CITIES.tokushima[1],
    JAPAN_PROJECTION,
  );

  // Translate so Tokushima stays centered while we zoom
  const translateX = 960 - tokX * zoom;
  const translateY = 540 - tokY * zoom;

  // Fade in the map
  const mapOpacity = interpolate(frame, [0, 30], [0, 1], {
    extrapolateRight: 'clamp',
  });

  // Label fade
  const labelOpacity = interpolate(frame, [20, 50], [0, 1], {
    extrapolateRight: 'clamp',
  });

  // Pulse for city dot
  const pulse = Math.sin(frame * 0.15) * 0.3 + 1;

  return (
    <AbsoluteFill style={{backgroundColor: COLORS.background}}>
      {/* Subtle grid */}
      <svg width="1920" height="1080" style={{position: 'absolute', opacity: 0.05}}>
        <defs>
          <pattern id="grid" width="60" height="60" patternUnits="userSpaceOnUse">
            <path d="M 60 0 L 0 0 0 60" fill="none" stroke="#ffffff" strokeWidth="0.5" />
          </pattern>
        </defs>
        <rect width="1920" height="1080" fill="url(#grid)" />
      </svg>

      {/* Map container with zoom transform */}
      <div
        style={{
          position: 'absolute',
          width: '1920px',
          height: '1080px',
          transform: `translate(${translateX}px, ${translateY}px) scale(${zoom})`,
          transformOrigin: '0 0',
          opacity: mapOpacity,
        }}
      >
        <svg width="1920" height="1080">
          <defs>
            <filter id="mapGlow">
              <feGaussianBlur stdDeviation="3" result="blur" />
              <feMerge>
                <feMergeNode in="blur" />
                <feMergeNode in="SourceGraphic" />
              </feMerge>
            </filter>
            <filter id="cityGlow">
              <feGaussianBlur stdDeviation="6" result="blur" />
              <feMerge>
                <feMergeNode in="blur" />
                <feMergeNode in="SourceGraphic" />
              </feMerge>
            </filter>
          </defs>

          {/* Island shapes */}
          {JAPAN_ISLANDS.map((island, i) => (
            <g key={i}>
              {/* Fill */}
              <path
                d={polygonToPath(island, JAPAN_PROJECTION)}
                fill={COLORS.mapFill}
                stroke="none"
              />
              {/* Glowing outline */}
              <path
                d={polygonToPath(island, JAPAN_PROJECTION)}
                fill="none"
                stroke={COLORS.mapStroke}
                strokeWidth="1.5"
                filter="url(#mapGlow)"
              />
            </g>
          ))}

          {/* Tokushima city marker */}
          <g filter="url(#cityGlow)">
            <circle
              cx={tokX}
              cy={tokY}
              r={4 * pulse}
              fill={COLORS.cityDot}
              opacity={0.4}
            />
            <circle cx={tokX} cy={tokY} r={3} fill={COLORS.cityDot} />
          </g>

          {/* Tokushima label */}
          <g opacity={labelOpacity}>
            <text
              x={tokX + 12}
              y={tokY - 10}
              fill={COLORS.labelText}
              fontSize="14"
              fontFamily="'Inter', 'Helvetica Neue', sans-serif"
              fontWeight="600"
            >
              Tokushima
            </text>
            <text
              x={tokX + 12}
              y={tokY + 6}
              fill={COLORS.mapStroke}
              fontSize="10"
              fontFamily="'Inter', 'Helvetica Neue', sans-serif"
              fontWeight="400"
              opacity={0.7}
            >
              Shikoku, Japan
            </text>
          </g>
        </svg>
      </div>

      {/* Vignette overlay */}
      <div
        style={{
          position: 'absolute',
          inset: 0,
          background:
            'radial-gradient(ellipse at center, transparent 40%, rgba(10,14,26,0.7) 100%)',
          pointerEvents: 'none',
        }}
      />
    </AbsoluteFill>
  );
};
