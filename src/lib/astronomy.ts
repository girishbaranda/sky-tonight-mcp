/**
 * Wrappers around astronomy-engine.
 *
 * astronomy-engine is a deterministic, dependency-free ephemeris library —
 * given a body, a date, and an observer location, it computes positions
 * to ~arcsecond accuracy with no API calls. Perfect for an MCP server.
 */
import { createRequire } from "node:module";
import type * as AstronomyNS from "astronomy-engine";

// astronomy-engine ships a dual CJS/ESM build whose ESM entry exposes only named
// exports (no default). createRequire pins the CJS build in both tsx (tests) and
// compiled Node ESM (prod), sidestepping the dual-package hazard that crashes
// `import Astronomy from` (no default in ESM build) and `import * as` (esbuild
// leaves named members undefined on the CJS build).
const Astronomy = createRequire(import.meta.url)("astronomy-engine") as typeof AstronomyNS;

/** Bodies we care about for naked-eye / binocular observing. */
export const VISIBLE_BODIES: AstronomyNS.Body[] = [
  Astronomy.Body.Moon,
  Astronomy.Body.Mercury,
  Astronomy.Body.Venus,
  Astronomy.Body.Mars,
  Astronomy.Body.Jupiter,
  Astronomy.Body.Saturn,
  Astronomy.Body.Uranus,
  Astronomy.Body.Neptune,
];

export interface ObserverInput {
  latitude: number;
  longitude: number;
  elevation_m?: number;
}

export interface BodyPosition {
  body: string;
  altitude_deg: number;
  azimuth_deg: number;
  magnitude: number | null;
  illumination_percent: number | null;
}

/** Compute a body's alt/az and brightness at a given moment from an observer. */
export function computePosition(
  body: AstronomyNS.Body,
  date: Date,
  observer: ObserverInput,
): BodyPosition {
  const obs = new Astronomy.Observer(
    observer.latitude,
    observer.longitude,
    observer.elevation_m ?? 0,
  );

  // Equatorial coords (RA/Dec) of the body as seen from the observer.
  // ofdate=true means apparent coords accounting for precession/nutation.
  // aberration=true accounts for Earth's motion.
  const equator = Astronomy.Equator(body, date, obs, true, true);

  // Convert RA/Dec → Alt/Az with standard atmospheric refraction.
  const horizon = Astronomy.Horizon(date, obs, equator.ra, equator.dec, "normal");

  let magnitude: number | null = null;
  let illumination: number | null = null;
  try {
    const ill = Astronomy.Illumination(body, date);
    magnitude = ill.mag;
    if (ill.phase_fraction != null) illumination = ill.phase_fraction * 100;
  } catch {
    // Some body+date combos can't compute illumination; that's fine.
  }

  return {
    body: body as unknown as string, // Body enum values are the body name strings
    altitude_deg: horizon.altitude,
    azimuth_deg: horizon.azimuth,
    magnitude,
    illumination_percent: illumination,
  };
}

/** Sun altitude for determining darkness (used to bound the night window). */
export function sunAltitude(date: Date, observer: ObserverInput): number {
  const obs = new Astronomy.Observer(
    observer.latitude,
    observer.longitude,
    observer.elevation_m ?? 0,
  );
  const eq = Astronomy.Equator(Astronomy.Body.Sun, date, obs, true, true);
  return Astronomy.Horizon(date, obs, eq.ra, eq.dec, "normal").altitude;
}

/** Compass direction from azimuth in degrees (0=N, 90=E, 180=S, 270=W). */
export function azimuthToCompass(az: number): string {
  const dirs = [
    "N", "NNE", "NE", "ENE",
    "E", "ESE", "SE", "SSE",
    "S", "SSW", "SW", "WSW",
    "W", "WNW", "NW", "NNW",
  ];
  return dirs[Math.round(az / 22.5) % 16];
}

/** Find sunset and sunrise bracketing the night for a given anchor date. */
export function findNightWindow(
  anchor: Date,
  observer: ObserverInput,
): { sunset: Date; sunrise: Date } | null {
  const obs = new Astronomy.Observer(
    observer.latitude,
    observer.longitude,
    observer.elevation_m ?? 0,
  );
  // direction: -1 = setting, +1 = rising
  const sunset = Astronomy.SearchRiseSet(Astronomy.Body.Sun, obs, -1, anchor, 1);
  if (!sunset) return null;
  const sunrise = Astronomy.SearchRiseSet(Astronomy.Body.Sun, obs, +1, sunset.date, 1);
  if (!sunrise) return null;
  return { sunset: sunset.date, sunrise: sunrise.date };
}
