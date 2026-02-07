/**
 * Map projection utilities for converting geographic coordinates to screen space.
 */

export interface ProjectionConfig {
  centerLng: number;
  centerLat: number;
  scale: number;
  width: number;
  height: number;
}

/** Project [lng, lat] to [x, y] screen coordinates using equirectangular projection. */
export function project(
  lng: number,
  lat: number,
  config: ProjectionConfig,
): [number, number] {
  const x = (lng - config.centerLng) * config.scale + config.width / 2;
  const y = (config.centerLat - lat) * config.scale + config.height / 2;
  return [x, y];
}

/** Convert polygon of [lng, lat] pairs to an SVG path `d` string. */
export function polygonToPath(
  coords: [number, number][],
  config: ProjectionConfig,
): string {
  return coords
    .map(([lng, lat], i) => {
      const [x, y] = project(lng, lat, config);
      return `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(' ') + ' Z';
}

/** Get a point along a quadratic bezier at parameter t (0-1). */
export function quadraticBezier(
  t: number,
  p0: [number, number],
  p1: [number, number],
  p2: [number, number],
): [number, number] {
  const mt = 1 - t;
  return [
    mt * mt * p0[0] + 2 * mt * t * p1[0] + t * t * p2[0],
    mt * mt * p0[1] + 2 * mt * t * p1[1] + t * t * p2[1],
  ];
}

/** Japan-focused projection config. */
export const JAPAN_PROJECTION: ProjectionConfig = {
  centerLng: 136.5,
  centerLat: 36.5,
  scale: 80,
  width: 1920,
  height: 1080,
};

/** World-level projection config. */
export const WORLD_PROJECTION: ProjectionConfig = {
  centerLng: 70,
  centerLat: 42,
  scale: 12,
  width: 1920,
  height: 1080,
};

/** Key city coordinates [lng, lat]. */
export const CITIES = {
  tokyo: [139.69, 35.69] as [number, number],
  tokushima: [134.56, 34.07] as [number, number],
  paris: [2.35, 48.86] as [number, number],
  osaka: [135.50, 34.69] as [number, number],
};
