/**
 * Catalog loaders and filters.
 *
 * Reads the static JSON catalogs in src/data and exposes typed access. Used by
 * both the resource registrants (src/resources/*.ts) and the deep-sky visibility
 * tool (src/tools/deep-sky-visible.ts).
 *
 * The data is bundled with the package — no network access at runtime.
 */
import messierData from "../data/messier.json" with { type: "json" };
import constellationData from "../data/constellations.json" with { type: "json" };

export type MessierType =
  | "galaxy"
  | "spiral_galaxy"
  | "elliptical_galaxy"
  | "nebula"
  | "planetary_nebula"
  | "supernova_remnant"
  | "open_cluster"
  | "globular_cluster"
  | "double_star"
  | "asterism";

export interface MessierObject {
  id: string;
  name: string;
  type: MessierType;
  constellation: string;
  ra_deg: number;
  dec_deg: number;
  magnitude: number;
  size_arcmin: number;
  best_months: string[];
  description: string;
}

export interface BrightestStar {
  name: string;
  magnitude: number;
}

export interface Constellation {
  name: string;
  latin_genitive: string;
  abbreviation: string;
  hemisphere: "northern" | "southern" | "equatorial";
  best_months: string[];
  brightest_star: BrightestStar;
  notable_objects: string[];
  story: string;
}

export type DeepSkyTypeFilter = "galaxy" | "nebula" | "cluster";

// Note: double_star and asterism types are intentionally not in any filter bucket — they
// appear in unfiltered queries but cannot be selected via DeepSkyTypeFilter.
const TYPE_FILTER_MAP: Record<DeepSkyTypeFilter, MessierType[]> = {
  galaxy: ["galaxy", "spiral_galaxy", "elliptical_galaxy"],
  nebula: ["nebula", "planetary_nebula", "supernova_remnant"],
  cluster: ["open_cluster", "globular_cluster"],
};

export function loadMessier(): MessierObject[] {
  return messierData as MessierObject[];
}

export function loadConstellations(): Constellation[] {
  return constellationData as Constellation[];
}

export function findMessier(id: string): MessierObject | null {
  const norm = id.trim().toUpperCase();
  return loadMessier().find((m) => m.id.toUpperCase() === norm) ?? null;
}

export function findConstellation(abbr: string): Constellation | null {
  const norm = abbr.trim().toLowerCase();
  return loadConstellations().find((c) => c.abbreviation.toLowerCase() === norm) ?? null;
}

export function filterMessierByType(
  objects: MessierObject[],
  filter: DeepSkyTypeFilter,
): MessierObject[] {
  const allowed = TYPE_FILTER_MAP[filter];
  return objects.filter((o) => allowed.includes(o.type));
}

export function filterMessier(
  objects: MessierObject[],
  predicate: (obj: MessierObject) => boolean,
): MessierObject[] {
  return objects.filter(predicate);
}
