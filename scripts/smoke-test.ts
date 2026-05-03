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

console.log("\n=== Observation log roundtrip (in-memory) ===");
{
  const { _resetForTest, _closeForTest, logObservation, recallObservations } =
    await import("../src/lib/observation-log.js");
  await _resetForTest(":memory:");
  const written = await logObservation({
    userId: "local",
    target: "Jupiter",
    latitude: 23.21,
    longitude: 72.63,
    seeing: 4,
    equipment: '8" Dob',
  });
  console.log(`logged: #${written.id} ${written.target} at ${written.observedAt}`);
  if (written.id !== 1) {
    console.error("expected id=1 on first insert");
    process.exit(1);
  }
  const read = await recallObservations({ userId: "local", target: "jup" });
  console.log(`recalled: ${read.length} row(s)`);
  if (read.length !== 1 || read[0].target !== "Jupiter" || read[0].seeing !== 4) {
    console.error(`unexpected recall result: ${JSON.stringify(read)}`);
    process.exit(1);
  }
  await _closeForTest();
}

console.log("\n=== JSON-RPC drive: resources + prompts ===");
await driveServer();

async function driveServer(): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn("npx", ["tsx", "src/server.ts"], { cwd: new URL("..", import.meta.url) });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d) => {
      stdout += d.toString();
      // Once we've received 9 JSON-RPC replies (initialize + 4 resource methods + 4 prompt methods),
      // close stdin to let the server shut down cleanly.
      const replyCount = stdout.trim().split("\n").filter(Boolean).length;
      if (replyCount >= 9) child.stdin.end();
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

        // --- v0.3 prompts coverage ---
        const promptsList = replies.find((r) => r.id === 6);
        const promptsListArr = promptsList?.result?.prompts ?? [];
        console.log(`prompts/list: ${promptsListArr.length} (expected 3)`);
        if (promptsListArr.length !== 3) {
          throw new Error(`prompts/list wrong size: ${promptsListArr.length}`);
        }
        const promptNames = promptsListArr.map((p: { name: string }) => p.name).sort();
        const expectedNames = ["identify_object", "plan_tonight_session", "tour_constellation"];
        if (JSON.stringify(promptNames) !== JSON.stringify(expectedNames)) {
          throw new Error(`prompts/list wrong names: ${JSON.stringify(promptNames)}`);
        }

        const planGet = replies.find((r) => r.id === 7);
        const planText = planGet?.result?.messages?.[0]?.content?.text;
        if (!planText) throw new Error("missing reply for prompts/get plan_tonight_session");
        if (!planText.includes("120-minute")) throw new Error("plan_tonight_session did not substitute duration_min");
        if (!planText.includes("intermediate observer")) throw new Error("plan_tonight_session did not substitute skill_level");
        console.log("prompts/get plan_tonight_session: ok (substitutions verified)");

        const idGet = replies.find((r) => r.id === 8);
        const idText = idGet?.result?.messages?.[0]?.content?.text;
        if (!idText) throw new Error("missing reply for prompts/get identify_object");
        if (!idText.includes("bright dot in the southwest at 9pm")) {
          throw new Error("identify_object did not embed description");
        }
        console.log("prompts/get identify_object: ok (description embedded)");

        const tourGet = replies.find((r) => r.id === 9);
        const tourText = tourGet?.result?.messages?.[0]?.content?.text;
        if (!tourText) throw new Error("missing reply for prompts/get tour_constellation");
        if (!tourText.includes("**Orion**")) {
          throw new Error("tour_constellation did not substitute name");
        }
        console.log("prompts/get tour_constellation: ok (name substituted)");

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
    send({ jsonrpc: "2.0", id: 6, method: "prompts/list" });
    send({
      jsonrpc: "2.0",
      id: 7,
      method: "prompts/get",
      params: {
        name: "plan_tonight_session",
        arguments: { duration_min: "120", skill_level: "intermediate" },
      },
    });
    send({
      jsonrpc: "2.0",
      id: 8,
      method: "prompts/get",
      params: {
        name: "identify_object",
        arguments: { description: "bright dot in the southwest at 9pm" },
      },
    });
    send({
      jsonrpc: "2.0",
      id: 9,
      method: "prompts/get",
      params: {
        name: "tour_constellation",
        arguments: { name: "Orion" },
      },
    });
    // Safety fallback: if for some reason we never receive 9 replies, force close after 10s.
    setTimeout(() => child.stdin.end(), 10_000);
  });
}

console.log("\n=== HTTP transport round-trip (POST /mcp moon_phase, with auth) ===");
{
  const { startHttpServer } = await import("../src/http.js");
  const { SignJWT } = await import("jose");
  const SECRET = "smoke-test-secret-do-not-use";
  const secretBytes = new TextEncoder().encode(SECRET);
  const httpServer = await startHttpServer({
    host: "127.0.0.1",
    port: 0,
    authConfig: { mode: "hs256", secret: secretBytes },
  });
  const addr = httpServer.address();
  if (!addr || typeof addr === "string") {
    throw new Error("expected an inet address from http server");
  }
  const url = `http://127.0.0.1:${addr.port}/mcp`;
  try {
    // 1. Unauthenticated → 401.
    const noAuth = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json, text/event-stream" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: {
          protocolVersion: "2024-11-05",
          capabilities: {},
          clientInfo: { name: "smoke", version: "0" },
        },
      }),
    });
    if (noAuth.status !== 401) {
      throw new Error(`expected 401 for unauthenticated POST, got ${noAuth.status}: ${await noAuth.text()}`);
    }
    if (!noAuth.headers.get("www-authenticate")?.includes("resource_metadata")) {
      throw new Error("expected WWW-Authenticate with resource_metadata on 401");
    }
    console.log(`HTTP /mcp without auth: 401 ✓`);

    // 2. With token → 200.
    const token = await new SignJWT({})
      .setProtectedHeader({ alg: "HS256" })
      .setSubject("smoke-user")
      .setIssuedAt()
      .setExpirationTime("5m")
      .sign(secretBytes);
    const authed = await fetch(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
        authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 2,
        method: "tools/call",
        params: { name: "moon_phase", arguments: {} },
      }),
    });
    const text = await authed.text();
    let parsed: any = null;
    try {
      parsed = JSON.parse(text);
    } catch {
      const dataLine = text.split("\n").find((l) => l.startsWith("data: "));
      if (dataLine) parsed = JSON.parse(dataLine.slice(6));
    }
    if (parsed === null) {
      throw new Error(`HTTP body was neither JSON nor SSE-framed:\nstatus=${authed.status}\nbody:\n${text}`);
    }
    if (authed.status !== 200) throw new Error(`HTTP ${authed.status}: ${text}`);
    if (!parsed?.result?.content?.[0]?.text) {
      throw new Error(`unexpected HTTP response: ${text}`);
    }
    console.log(`HTTP /mcp moon_phase (authed): ${parsed.result.content[0].text.split("\n")[0]}`);

    // 3. PRM endpoint reachable, no auth.
    const prm = await fetch(`http://127.0.0.1:${addr.port}/.well-known/oauth-protected-resource`);
    if (prm.status !== 200) throw new Error(`PRM endpoint returned ${prm.status}`);
    const prmDoc = await prm.json();
    if (!prmDoc.resource?.includes("/mcp")) {
      throw new Error(`PRM doc missing/invalid resource: ${JSON.stringify(prmDoc)}`);
    }
    console.log(`HTTP /.well-known/oauth-protected-resource: ${prmDoc.resource}`);

    // 4. Scope enforcement: read-only token must be rejected by log_observation.
    {
      const readOnlyToken = await new SignJWT({ scope: "sky-tonight:log:read" })
        .setProtectedHeader({ alg: "HS256" })
        .setSubject("smoke-readonly")
        .setIssuedAt()
        .setExpirationTime("5m")
        .sign(secretBytes);

      const res = await fetch(url, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${readOnlyToken}`,
          accept: "application/json, text/event-stream",
        },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: "tools/call",
          params: {
            name: "log_observation",
            arguments: {
              target: "smoke-readonly-write-attempt",
              latitude: 0,
              longitude: 0,
            },
          },
        }),
      });
      if (res.status !== 403) {
        throw new Error(`smoke: expected 403 for read-only token writing, got ${res.status}`);
      }
      const ww = res.headers.get("www-authenticate") ?? "";
      if (!ww.includes("sky-tonight:log:write")) {
        throw new Error(`smoke: expected WWW-Authenticate to mention sky-tonight:log:write, got: ${ww}`);
      }
      console.log("HTTP scope enforcement: read-only token blocked from log_observation ✓");
    }
  } finally {
    await new Promise<void>((resolve) => httpServer.close(() => resolve()));
  }
}

console.log("\nAll smoke tests completed.");
