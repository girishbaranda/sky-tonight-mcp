/**
 * ISS pass prediction.
 *
 * We fetch the ISS's Two-Line Element (TLE) set from celestrak (no auth, public),
 * cache it for 6 hours, and propagate forward with satellite.js to find passes
 * above a minimum altitude.
 *
 * A "pass" here = the contiguous interval the ISS is above the local horizon.
 */
import * as satellite from "satellite.js";

const ISS_TLE_URL =
  "https://celestrak.org/NORAD/elements/gp.php?CATNR=25544&FORMAT=TLE";

interface CachedTLE {
  tle1: string;
  tle2: string;
  fetchedAt: number;
}

let cachedTLE: CachedTLE | null = null;
const TLE_TTL_MS = 6 * 60 * 60 * 1000; // refresh every 6h; ISS TLEs are valid ~days

async function getISSTLE(): Promise<{ tle1: string; tle2: string }> {
  if (cachedTLE && Date.now() - cachedTLE.fetchedAt < TLE_TTL_MS) {
    return { tle1: cachedTLE.tle1, tle2: cachedTLE.tle2 };
  }
  const res = await fetch(ISS_TLE_URL);
  if (!res.ok) throw new Error(`Failed to fetch ISS TLE: HTTP ${res.status}`);
  const text = await res.text();
  const lines = text.trim().split(/\r?\n/).map((l) => l.trim());
  // celestrak TLE format: line 0 = name, line 1 = TLE line 1, line 2 = TLE line 2
  if (lines.length < 3) throw new Error("Unexpected TLE format from celestrak");
  cachedTLE = { tle1: lines[1], tle2: lines[2], fetchedAt: Date.now() };
  return { tle1: cachedTLE.tle1, tle2: cachedTLE.tle2 };
}

export interface ISSPass {
  start: Date;
  peak: Date;
  end: Date;
  peak_altitude_deg: number;
  start_azimuth_deg: number;
  peak_azimuth_deg: number;
  end_azimuth_deg: number;
  duration_seconds: number;
}

export async function findISSPasses(
  latitude: number,
  longitude: number,
  startTime: Date,
  hours: number,
  minPeakAlt = 10,
): Promise<ISSPass[]> {
  const { tle1, tle2 } = await getISSTLE();
  const satrec = satellite.twoline2satrec(tle1, tle2);

  const observerGd = {
    latitude: satellite.degreesToRadians(latitude),
    longitude: satellite.degreesToRadians(longitude),
    height: 0,
  };

  const stepMs = 10_000; // 10s steps — fine enough for ISS (~7.7 km/s)
  const endTime = new Date(startTime.getTime() + hours * 3600 * 1000);

  const passes: ISSPass[] = [];
  let inPass = false;
  let curStart: Date | null = null;
  let curStartAz = 0;
  let curPeakAlt = -90;
  let curPeak: Date | null = null;
  let curPeakAz = 0;
  let lastAz = 0;

  for (let t = startTime.getTime(); t <= endTime.getTime(); t += stepMs) {
    const date = new Date(t);
    const pv = satellite.propagate(satrec, date);
    if (satrec.error !== satellite.SatRecError.None) continue;

    const gmst = satellite.gstime(date);
    const ecf = satellite.eciToEcf(pv.position, gmst);
    const look = satellite.ecfToLookAngles(observerGd, ecf);
    const altDeg = satellite.radiansToDegrees(look.elevation);
    const azDeg = (satellite.radiansToDegrees(look.azimuth) + 360) % 360;

    const above = altDeg > 0;

    if (above && !inPass) {
      inPass = true;
      curStart = date;
      curStartAz = azDeg;
      curPeakAlt = altDeg;
      curPeak = date;
      curPeakAz = azDeg;
    } else if (above) {
      if (altDeg > curPeakAlt) {
        curPeakAlt = altDeg;
        curPeak = date;
        curPeakAz = azDeg;
      }
    } else if (!above && inPass) {
      // pass just ended at the previous step
      if (curStart && curPeak && curPeakAlt >= minPeakAlt) {
        passes.push({
          start: curStart,
          peak: curPeak,
          end: date,
          peak_altitude_deg: curPeakAlt,
          start_azimuth_deg: curStartAz,
          peak_azimuth_deg: curPeakAz,
          end_azimuth_deg: lastAz,
          duration_seconds: (date.getTime() - curStart.getTime()) / 1000,
        });
      }
      inPass = false;
      curStart = null;
      curPeak = null;
      curPeakAlt = -90;
    }

    lastAz = azDeg;
  }

  return passes;
}
