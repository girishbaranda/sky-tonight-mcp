import { test } from "node:test";
import assert from "node:assert/strict";
import {
  loadMessier,
  loadConstellations,
  findMessier,
  findConstellation,
  filterMessierByType,
  filterMessier,
  type DeepSkyTypeFilter,
} from "./catalog.js";

test("loadMessier returns 110 entries", () => {
  const m = loadMessier();
  assert.equal(m.length, 110);
});

test("loadMessier ids match /^M\\d+$/", () => {
  for (const obj of loadMessier()) {
    assert.match(obj.id, /^M\d+$/, `bad id: ${obj.id}`);
  }
});

test("loadMessier magnitudes are finite numbers", () => {
  for (const obj of loadMessier()) {
    assert.ok(Number.isFinite(obj.magnitude), `bad mag for ${obj.id}: ${obj.magnitude}`);
  }
});

test("loadConstellations returns 88 entries", () => {
  assert.equal(loadConstellations().length, 88);
});

test("loadConstellations abbreviations are 3 letters", () => {
  for (const c of loadConstellations()) {
    assert.match(c.abbreviation, /^[A-Z][a-zA-Z]{2}$/, `bad abbr: ${c.abbreviation}`);
  }
});

test("findMessier is case-insensitive", () => {
  const upper = findMessier("M31");
  const lower = findMessier("m31");
  assert.ok(upper);
  assert.equal(upper.name, "Andromeda Galaxy");
  assert.equal(lower?.id, "M31");
});

test("findMessier returns null for unknown", () => {
  assert.equal(findMessier("M999"), null);
});

test("findConstellation is case-insensitive", () => {
  const upper = findConstellation("Ori");
  const lower = findConstellation("ori");
  assert.ok(upper);
  assert.equal(upper.name, "Orion");
  assert.equal(lower?.abbreviation, "Ori");
});

test("findConstellation returns null for unknown", () => {
  assert.equal(findConstellation("ZZZ"), null);
});

test("filterMessierByType galaxy includes spiral and elliptical", () => {
  const objs = loadMessier();
  const galaxies = filterMessierByType(objs, "galaxy");
  for (const g of galaxies) {
    assert.ok(
      ["galaxy", "spiral_galaxy", "elliptical_galaxy"].includes(g.type),
      `unexpected type in galaxy filter: ${g.type}`,
    );
  }
  // M31 is a spiral galaxy — must appear
  assert.ok(galaxies.some((g) => g.id === "M31"));
});

test("filterMessierByType nebula includes planetary and supernova_remnant", () => {
  const objs = loadMessier();
  const nebulae = filterMessierByType(objs, "nebula");
  for (const n of nebulae) {
    assert.ok(
      ["nebula", "planetary_nebula", "supernova_remnant"].includes(n.type),
      `unexpected type in nebula filter: ${n.type}`,
    );
  }
  // M1 is a supernova remnant — must appear under "nebula" filter
  assert.ok(nebulae.some((n) => n.id === "M1"));
  // M57 is a planetary nebula
  assert.ok(nebulae.some((n) => n.id === "M57"));
});

test("filterMessierByType cluster includes open and globular", () => {
  const objs = loadMessier();
  const clusters = filterMessierByType(objs, "cluster");
  for (const c of clusters) {
    assert.ok(
      ["open_cluster", "globular_cluster"].includes(c.type),
      `unexpected type in cluster filter: ${c.type}`,
    );
  }
  // M45 (Pleiades) is open, M3 is globular — both must appear
  assert.ok(clusters.some((c) => c.id === "M45"));
  assert.ok(clusters.some((c) => c.id === "M3"));
});

test("filterMessier applies arbitrary predicate", () => {
  const objs = loadMessier();
  const bright = filterMessier(objs, (o) => o.magnitude <= 5);
  // M45 (Pleiades, mag 1.6) should make the cut; M1 (mag 8.4) should not.
  assert.ok(bright.some((o) => o.id === "M45"));
  assert.ok(!bright.some((o) => o.id === "M1"));
});
