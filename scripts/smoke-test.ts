/**
 * Smoke test — verifies the astronomy + satellite libs return sane values
 * for Gandhinagar tonight. Run with: npx tsx scripts/smoke-test.ts
 * (Not part of the MCP server itself.)
 */
import { findNightWindow, computePosition, VISIBLE_BODIES, azimuthToCompass } from "../src/lib/astronomy.js";
import { findISSPasses } from "../src/lib/satellites.js";

const GANDHINAGAR = { latitude: 23.2156, longitude: 72.6369 };
const now = new Date();

console.log("=== Night window for tonight in Gandhinagar ===");
const window = findNightWindow(now, GANDHINAGAR);
if (!window) {
  console.error("No night window found");
  process.exit(1);
}
console.log("Sunset:  ", window.sunset.toISOString());
console.log("Sunrise: ", window.sunrise.toISOString());
const hours = (window.sunrise.getTime() - window.sunset.getTime()) / 3.6e6;
console.log("Duration:", hours.toFixed(2), "hours");

console.log("\n=== Body positions at midnight UTC ===");
const midnight = new Date(window.sunset.getTime() + (window.sunrise.getTime() - window.sunset.getTime()) / 2);
console.log("Sample time:", midnight.toISOString());
for (const body of VISIBLE_BODIES) {
  const pos = computePosition(body, midnight, GANDHINAGAR);
  console.log(
    `  ${pos.body.padEnd(10)} alt=${pos.altitude_deg.toFixed(1).padStart(6)}°  az=${pos.azimuth_deg.toFixed(1).padStart(6)}° (${azimuthToCompass(pos.azimuth_deg)})  mag=${pos.magnitude?.toFixed(2) ?? "—"}`,
  );
}

console.log("\n=== ISS passes in next 48h from Gandhinagar ===");
try {
  const passes = await findISSPasses(GANDHINAGAR.latitude, GANDHINAGAR.longitude, new Date(), 48, 10);
  if (passes.length === 0) {
    console.log("No qualifying passes (this is normal — ISS only passes some days)");
  } else {
    for (const p of passes) {
      console.log(
        `  ${p.start.toISOString()}  peak ${Math.round(p.peak_altitude_deg)}° in ${azimuthToCompass(p.peak_azimuth_deg)}  ${Math.round(p.duration_seconds)}s`,
      );
    }
  }
} catch (err) {
  console.error("ISS test failed:", (err as Error).message);
}

console.log("\nAll smoke tests completed.");
