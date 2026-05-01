/**
 * Smoke test — verifies the astronomy + satellite libs return sane values
 * for Gandhinagar tonight. Run with: npx tsx scripts/smoke-test.ts
 * (Not part of the MCP server itself.)
 */
import { findNightWindow, computePosition, VISIBLE_BODIES, azimuthToCompass } from "../src/lib/astronomy.js";
import { findISSPasses } from "../src/lib/satellites.js";
import { loadMessier, loadConstellations, findMessier, findConstellation } from "../src/lib/catalog.js";
import { spawn } from "node:child_process";

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

console.log("\n=== Catalog integrity ===");
const messier = loadMessier();
console.log(`Messier entries: ${messier.length} (expected 110)`);
if (messier.length !== 110) process.exit(1);
const constellations = loadConstellations();
console.log(`Constellation entries: ${constellations.length} (expected 88)`);
if (constellations.length !== 88) process.exit(1);

console.log("\n=== Spot checks ===");
const m31 = findMessier("m31");
console.log(`M31: ${m31?.name} (mag ${m31?.magnitude}) in ${m31?.constellation}`);
if (!m31 || m31.name !== "Andromeda Galaxy" || m31.constellation !== "Andromeda") {
  console.error("M31 spot check failed");
  process.exit(1);
}
const ori = findConstellation("ori");
console.log(`Ori: ${ori?.name}, brightest star ${ori?.brightest_star.name}`);
if (!ori || ori.name !== "Orion" || ori.brightest_star.name !== "Rigel") {
  console.error("Orion spot check failed");
  process.exit(1);
}

console.log("\n=== JSON-RPC drive: resources ===");
await driveServer();

async function driveServer(): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn("npx", ["tsx", "src/server.ts"], { cwd: new URL("..", import.meta.url) });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d) => {
      stdout += d.toString();
      // Once we've received 5 JSON-RPC replies (initialize + 4 methods),
      // close stdin to let the server shut down cleanly.
      const replyCount = stdout.trim().split("\n").filter(Boolean).length;
      if (replyCount >= 5) child.stdin.end();
    });
    child.stderr.on("data", (d) => (stderr += d.toString()));
    child.on("error", reject);
    child.on("close", (code) => {
      try {
        if (code !== 0 && code !== null) {
          throw new Error(`server exited with code ${code}\nstderr: ${stderr}`);
        }
        const lines = stdout.trim().split("\n").filter(Boolean);
        const replies = lines.map((l) => JSON.parse(l));

        const list = replies.find((r) => r.id === 2);
        const tmpl = replies.find((r) => r.id === 3);
        const idx = replies.find((r) => r.id === 4);
        const m31r = replies.find((r) => r.id === 5);

        const listCount = list?.result?.resources?.length ?? 0;
        const tmplCount = tmpl?.result?.resourceTemplates?.length ?? 0;
        console.log(`resources/list: ${listCount} (expected 2: messier-catalog, constellation-catalog)`);
        console.log(`resources/templates/list: ${tmplCount} (expected 2: messier-object, constellation-detail)`);
        if (listCount !== 2 || tmplCount !== 2) {
          throw new Error(`unexpected resource counts (list=${listCount}, templates=${tmplCount})`);
        }

        const idxText = idx?.result?.contents?.[0]?.text;
        if (!idxText) throw new Error("missing reply for sky://catalog/messier read");
        const idxArr = JSON.parse(idxText);
        console.log(`sky://catalog/messier read: ${idxArr.length} entries (expected 110)`);
        if (idxArr.length !== 110) throw new Error(`messier index wrong size: ${idxArr.length}`);

        const m31Text = m31r?.result?.contents?.[0]?.text;
        if (!m31Text) throw new Error("missing reply for sky://messier/M31 read");
        const m31Obj = JSON.parse(m31Text);
        console.log(`sky://messier/M31 read: ${m31Obj.name}`);
        if (m31Obj.id !== "M31") throw new Error(`m31 read wrong id: ${m31Obj.id}`);

        resolve();
      } catch (err) {
        reject(err);
      }
    });

    const send = (frame: object) => child.stdin.write(JSON.stringify(frame) + "\n");
    send({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "smoke", version: "0" } } });
    send({ jsonrpc: "2.0", method: "notifications/initialized" });
    send({ jsonrpc: "2.0", id: 2, method: "resources/list" });
    send({ jsonrpc: "2.0", id: 3, method: "resources/templates/list" });
    send({ jsonrpc: "2.0", id: 4, method: "resources/read", params: { uri: "sky://catalog/messier" } });
    send({ jsonrpc: "2.0", id: 5, method: "resources/read", params: { uri: "sky://messier/M31" } });
    // Safety fallback: if for some reason we never receive 5 replies, force close after 10s.
    setTimeout(() => child.stdin.end(), 10_000);
  });
}

console.log("\nAll smoke tests completed.");
