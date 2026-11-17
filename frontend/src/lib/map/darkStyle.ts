import type { StyleSpecification } from "maplibre-gl";

export const LIBERTY_STYLE_URL = "https://tiles.openfreemap.org/styles/liberty";

export const COLOR_PAINT_PROPERTIES = new Set([
  "background-color",
  "fill-color",
  "fill-outline-color",
  "line-color",
  "text-color",
  "text-halo-color",
  "icon-color",
  "icon-halo-color",
  "circle-color",
  "circle-stroke-color",
  "fill-extrusion-color",
  "hillshade-shadow-color",
  "hillshade-highlight-color",
  "hillshade-accent-color",
  "heatmap-color",
]);

export interface HslaColor {
  h: number; // [0, 360)
  s: number; // [0, 100]
  l: number; // [0, 100]
  a: number; // [0, 1]
}

const NAMED_COLORS: Record<string, string> = {
  black: "#000000",
  white: "#ffffff",
  red: "#ff0000",
  green: "#008000",
  blue: "#0000ff",
  yellow: "#ffff00",
  orange: "#ffa500",
  purple: "#800080",
  gray: "#808080",
  grey: "#808080",
  silver: "#c0c0c0",
  navy: "#000080",
  teal: "#008080",
  aqua: "#00ffff",
  cyan: "#00ffff",
  magenta: "#ff00ff",
  fuchsia: "#ff00ff",
  maroon: "#800000",
  olive: "#808000",
  lime: "#00ff00",
  transparent: "rgba(0,0,0,0)",
};

function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}

function rgbToHsl(r255: number, g255: number, b255: number, a = 1): HslaColor {
  const r = clamp(r255 / 255, 0, 1);
  const g = clamp(g255 / 255, 0, 1);
  const b = clamp(b255 / 255, 0, 1);

  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const d = max - min;
  const l = (max + min) / 2;

  let h = 0;
  let s = 0;
  if (d !== 0) {
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    switch (max) {
      case r:
        h = (g - b) / d + (g < b ? 6 : 0);
        break;
      case g:
        h = (b - r) / d + 2;
        break;
      case b:
        h = (r - g) / d + 4;
        break;
    }
    h *= 60;
  }

  return {
    h: ((h % 360) + 360) % 360,
    s: clamp(s * 100, 0, 100),
    l: clamp(l * 100, 0, 100),
    a: clamp(a, 0, 1),
  };
}

function hslToRgb(
  h: number,
  sPct: number,
  lPct: number,
): [number, number, number] {
  const s = clamp(sPct / 100, 0, 1);
  const l = clamp(lPct / 100, 0, 1);
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const hp = (((h % 360) + 360) % 360) / 60;
  const x = c * (1 - Math.abs((hp % 2) - 1));
  let r1 = 0;
  let g1 = 0;
  let b1 = 0;
  if (hp >= 0 && hp < 1) [r1, g1, b1] = [c, x, 0];
  else if (hp < 2) [r1, g1, b1] = [x, c, 0];
  else if (hp < 3) [r1, g1, b1] = [0, c, x];
  else if (hp < 4) [r1, g1, b1] = [0, x, c];
  else if (hp < 5) [r1, g1, b1] = [x, 0, c];
  else [r1, g1, b1] = [c, 0, x];
  const m = l - c / 2;
  return [
    Math.round(clamp((r1 + m) * 255, 0, 255)),
    Math.round(clamp((g1 + m) * 255, 0, 255)),
    Math.round(clamp((b1 + m) * 255, 0, 255)),
  ];
}

export function formatHsla(c: HslaColor): string {
  const [r, g, b] = hslToRgb(c.h, c.s, c.l);
  const a = clamp(c.a, 0, 1);
  if (a >= 0.999) {
    const hex = (n: number) => n.toString(16).padStart(2, "0");
    return `#${hex(r)}${hex(g)}${hex(b)}`;
  }
  return `rgba(${r}, ${g}, ${b}, ${Number(a.toFixed(3))})`;
}

/**
 * Parses hex (#rgb, #rgba, #rrggbb, #rrggbbaa), rgb/rgba(), hsl/hsla(), and named CSS colors.
 * Returns null if the string is not a valid color.
 */
export function parseColor(input: string): HslaColor | null {
  if (typeof input !== "string") return null;
  const raw = input.trim().toLowerCase();
  if (!raw) return null;

  const named = NAMED_COLORS[raw];
  const str = named ?? raw;

  if (str.startsWith("#")) {
    const hex = str.slice(1);
    if (hex.length === 3 || hex.length === 4) {
      const r = parseInt(hex[0] + hex[0], 16);
      const g = parseInt(hex[1] + hex[1], 16);
      const b = parseInt(hex[2] + hex[2], 16);
      const a = hex.length === 4 ? parseInt(hex[3] + hex[3], 16) / 255 : 1;
      if ([r, g, b, a].some(Number.isNaN)) return null;
      return rgbToHsl(r, g, b, a);
    }
    if (hex.length === 6 || hex.length === 8) {
      const r = parseInt(hex.slice(0, 2), 16);
      const g = parseInt(hex.slice(2, 4), 16);
      const b = parseInt(hex.slice(4, 6), 16);
      const a = hex.length === 8 ? parseInt(hex.slice(6, 8), 16) / 255 : 1;
      if ([r, g, b, a].some(Number.isNaN)) return null;
      return rgbToHsl(r, g, b, a);
    }
    return null;
  }

  const rgbMatch = str.match(
    /^rgba?\(\s*([+-]?\d+(?:\.\d+)?)\s*,\s*([+-]?\d+(?:\.\d+)?)\s*,\s*([+-]?\d+(?:\.\d+)?)(?:\s*,\s*([+-]?\d*(?:\.\d+)?))?\s*\)$/,
  );
  if (rgbMatch) {
    const r = Number(rgbMatch[1]);
    const g = Number(rgbMatch[2]);
    const b = Number(rgbMatch[3]);
    const a = rgbMatch[4] !== undefined ? Number(rgbMatch[4]) : 1;
    if ([r, g, b, a].some(Number.isNaN)) return null;
    return rgbToHsl(r, g, b, a);
  }

  const hslMatch = str.match(
    /^hsla?\(\s*([+-]?\d+(?:\.\d+)?)\s*,\s*([+-]?\d+(?:\.\d+)?)%\s*,\s*([+-]?\d+(?:\.\d+)?)%(?:\s*,\s*([+-]?\d*(?:\.\d+)?))?\s*\)$/,
  );
  if (hslMatch) {
    const h = Number(hslMatch[1]);
    const s = Number(hslMatch[2]);
    const l = Number(hslMatch[3]);
    const a = hslMatch[4] !== undefined ? Number(hslMatch[4]) : 1;
    if ([h, s, l, a].some(Number.isNaN)) return null;
    return {
      h: ((h % 360) + 360) % 360,
      s: clamp(s, 0, 100),
      l: clamp(l, 0, 100),
      a: clamp(a, 0, 1),
    };
  }

  return null;
}

export interface LayerContext {
  id: string;
  type: string;
  sourceLayer: string;
  propName: string;
}

/**
 * Semantic HSL transformation for OpenFreeMap Liberty layers.
 */
export function transformColorString(
  colorStr: string,
  ctx: LayerContext,
): string {
  const parsed = parseColor(colorStr);
  if (!parsed) return colorStr;
  if (parsed.a === 0) return colorStr;

  const id = ctx.id.toLowerCase();
  const sl = ctx.sourceLayer.toLowerCase();
  const prop = ctx.propName.toLowerCase();

  // 1. Symbol halos (text-halo-color / icon-halo-color) -> deep dark land-matched halo (#0b1018)
  if (prop === "text-halo-color" || prop === "icon-halo-color") {
    return formatHsla({
      h: 216,
      s: 34,
      l: 7,
      a: Math.max(parsed.a, 0.88),
    });
  }

  // 2. Symbol text & icons -> high-contrast light labels with hierarchy
  if (prop === "text-color" || prop === "icon-color" || ctx.type === "symbol") {
    if (id.includes("water") || sl.includes("water")) {
      return formatHsla({ h: 206, s: 52, l: 72, a: parsed.a });
    }
    if (id.includes("city") || id.includes("capital")) {
      return formatHsla({ h: 210, s: 20, l: 92, a: parsed.a });
    }
    if (
      id.includes("town") ||
      id.includes("village") ||
      id.includes("label_other")
    ) {
      return formatHsla({ h: 212, s: 16, l: 84, a: parsed.a });
    }
    if (id.includes("state") || id.includes("country")) {
      return formatHsla({ h: 215, s: 16, l: 77, a: parsed.a });
    }
    if (id.includes("highway") || sl.includes("transportation_name")) {
      return formatHsla({ h: 214, s: 15, l: 80, a: parsed.a });
    }
    // POIs, airports, fallback labels
    return formatHsla({
      h: parsed.s > 20 ? parsed.h : 212,
      s: clamp(parsed.s * 0.6, 14, 42),
      l: 78,
      a: parsed.a,
    });
  }

  // 3. Background
  if (ctx.type === "background" || prop === "background-color") {
    return formatHsla({ h: 216, s: 28, l: 11, a: parsed.a });
  }

  // 4. Water fills & waterway lines -> deep desaturated navy (#0d1b2a to #12263a)
  if (id.includes("water") || sl === "water" || sl === "waterway") {
    const isLine = ctx.type === "line";
    return formatHsla({
      h: 210,
      s: 52,
      l: isLine ? 15 : 11,
      a: parsed.a,
    });
  }

  // 5. Hillshade colors
  if (prop.startsWith("hillshade-")) {
    if (prop.includes("shadow")) {
      return formatHsla({ h: 216, s: 35, l: 5, a: parsed.a });
    }
    if (prop.includes("highlight")) {
      return formatHsla({ h: 210, s: 22, l: 24, a: parsed.a });
    }
    return formatHsla({ h: 214, s: 25, l: 14, a: parsed.a });
  }

  // 6. Parks, woods, grass, vegetated landuse -> keep green hue, reduce saturation 35%, dark L 13-19%
  if (
    id.includes("park") ||
    id.includes("wood") ||
    id.includes("grass") ||
    id.includes("cemetery") ||
    id.includes("wetland") ||
    id.includes("pitch") ||
    id.includes("track") ||
    sl === "park" ||
    (parsed.h >= 70 && parsed.h <= 165 && parsed.s >= 15)
  ) {
    const isOutline = prop === "fill-outline-color" || ctx.type === "line";
    return formatHsla({
      h: clamp(parsed.h, 110, 150),
      s: clamp(parsed.s * 0.62, 16, 34),
      l: isOutline ? 21 : 15,
      a: parsed.a,
    });
  }

  // 7. Roads, tunnels, bridges, rail, aeroways
  if (
    sl === "transportation" ||
    sl === "aeroway" ||
    id.startsWith("road_") ||
    id.startsWith("tunnel_") ||
    id.startsWith("bridge_") ||
    id.startsWith("aeroway_")
  ) {
    const isCasing = id.includes("casing");
    if (isCasing) {
      return formatHsla({
        h: 216,
        s: 22,
        l: id.includes("motorway") || id.includes("trunk") ? 13 : 10,
        a: parsed.a,
      });
    }
    if (id.includes("motorway")) {
      const isLink = id.includes("link") || id.includes("tunnel");
      return formatHsla({
        h: 32,
        s: isLink ? 42 : 52,
        l: isLink ? 31 : 38,
        a: parsed.a,
      });
    }
    if (id.includes("trunk") || id.includes("primary")) {
      return formatHsla({
        h: 36,
        s: 34,
        l: id.includes("tunnel") ? 26 : 31,
        a: parsed.a,
      });
    }
    if (
      id.includes("secondary") ||
      id.includes("tertiary") ||
      id.includes("link")
    ) {
      return formatHsla({
        h: 215,
        s: 20,
        l: 26,
        a: parsed.a,
      });
    }
    if (id.includes("rail")) {
      return formatHsla({ h: 215, s: 14, l: 24, a: parsed.a });
    }
    // minor, street, service, path, aeroway
    return formatHsla({
      h: 215,
      s: 16,
      l: id.includes("service") || id.includes("path") ? 18 : 22,
      a: parsed.a,
    });
  }

  // 8. Administrative boundaries
  if (sl === "boundary" || id.startsWith("boundary")) {
    const isMajor = id.includes("2") || id.includes("disputed");
    return formatHsla({
      h: 216,
      s: 16,
      l: isMajor ? 38 : 28,
      a: parsed.a,
    });
  }

  // 9. Buildings (2D & 3D extrusion)
  if (sl === "building" || id.startsWith("building")) {
    const isOutline = prop === "fill-outline-color";
    return formatHsla({
      h: 216,
      s: 20,
      l: isOutline ? 21 : 16,
      a: parsed.a,
    });
  }

  // 10. General landuse / landcover / fallback fills & lines
  // Map light backgrounds (L 70-100%) to dark range (L 12-20%), reduce saturation by 35%
  const targetL = clamp(22 - (parsed.l / 100) * 10, 11, 22);
  const targetH = parsed.s < 15 ? 216 : parsed.h;
  const targetS = parsed.s < 15 ? 20 : clamp(parsed.s * 0.65, 12, 36);
  return formatHsla({
    h: targetH,
    s: targetS,
    l: targetL,
    a: parsed.a,
  });
}

/**
 * Recursively transforms color literals inside MapLibre style expressions,
 * legacy `{ stops: [[zoom, color], ...] }` objects, and plain strings.
 */
export function transformPaintValue(
  value: unknown,
  ctx: LayerContext,
): unknown {
  if (typeof value === "string") {
    return transformColorString(value, ctx);
  }

  if (Array.isArray(value)) {
    if (value.length === 0) return value;
    const op = value[0];
    if (typeof op !== "string") {
      return value.map((v) => transformPaintValue(v, ctx));
    }

    // ["interpolate" | "interpolate-hcl" | "interpolate-lab", interpType, input, stop1, out1, stop2, out2, ...]
    if (
      op === "interpolate" ||
      op === "interpolate-hcl" ||
      op === "interpolate-lab"
    ) {
      const out = value.slice(0, 3);
      for (let i = 3; i < value.length; i += 2) {
        out.push(value[i]); // numeric stop
        if (i + 1 < value.length) {
          out.push(transformPaintValue(value[i + 1], ctx));
        }
      }
      return out;
    }

    // ["step", input, defaultOutput, stop1, out1, stop2, out2, ...]
    if (op === "step") {
      const out = [value[0], value[1], transformPaintValue(value[2], ctx)];
      for (let i = 3; i < value.length; i += 2) {
        out.push(value[i]); // numeric stop
        if (i + 1 < value.length) {
          out.push(transformPaintValue(value[i + 1], ctx));
        }
      }
      return out;
    }

    // ["match", input, label1, out1, label2, out2, ..., fallback]
    if (op === "match") {
      const out = [value[0], value[1]];
      for (let i = 2; i < value.length - 1; i += 2) {
        out.push(value[i]); // match label (do NOT transform)
        if (i + 1 < value.length - 1) {
          out.push(transformPaintValue(value[i + 1], ctx));
        }
      }
      if (value.length >= 3) {
        out.push(transformPaintValue(value[value.length - 1], ctx));
      }
      return out;
    }

    // ["case", cond1, out1, cond2, out2, ..., fallback]
    if (op === "case") {
      const out = [value[0]];
      for (let i = 1; i < value.length - 1; i += 2) {
        out.push(value[i]); // condition
        if (i + 1 < value.length - 1) {
          out.push(transformPaintValue(value[i + 1], ctx));
        }
      }
      if (value.length >= 2) {
        out.push(transformPaintValue(value[value.length - 1], ctx));
      }
      return out;
    }

    // ["to-color", candidate1, candidate2, ...]
    if (op === "to-color" || op === "coalesce") {
      return [op, ...value.slice(1).map((v) => transformPaintValue(v, ctx))];
    }

    // ["let", varName, varVal, ..., body]
    if (op === "let" && value.length >= 4) {
      return [
        ...value.slice(0, value.length - 1),
        transformPaintValue(value[value.length - 1], ctx),
      ];
    }

    // Data/lookup expressions like ["get", ...], ["zoom"], etc. are untouched
    return value;
  }

  // Legacy stops object: { base?: number, stops: [[zoom, val], ...] }
  if (value && typeof value === "object" && "stops" in value) {
    const obj = value as { stops: unknown; [k: string]: unknown };
    if (Array.isArray(obj.stops)) {
      return {
        ...obj,
        stops: obj.stops.map((pair) =>
          Array.isArray(pair) && pair.length >= 2
            ? [pair[0], transformPaintValue(pair[1], ctx), ...pair.slice(2)]
            : pair,
        ),
      };
    }
  }

  return value;
}

/**
 * Deep-clones the OpenFreeMap Liberty style JSON and transforms all color paint properties
 * into a detail-identical dark-mode style without dropping or reordering any layers.
 */
export function makeDarkStyle(
  lightStyleJson: StyleSpecification,
): StyleSpecification {
  const clone: StyleSpecification = JSON.parse(JSON.stringify(lightStyleJson));
  if (!Array.isArray(clone.layers)) {
    throw new Error("Invalid MapLibre style: layers array missing");
  }

  for (const layer of clone.layers) {
    const sourceLayer =
      "source-layer" in layer && typeof layer["source-layer"] === "string"
        ? layer["source-layer"]
        : "";

    // Dim the low-zoom Natural Earth bright raster relief slightly so dark background dominates
    if (
      layer.type === "raster" &&
      layer.id === "natural_earth" &&
      layer.paint
    ) {
      const paint = layer.paint as Record<string, unknown>;
      paint["raster-brightness-max"] = 0.28;
      paint["raster-saturation"] = -0.5;
      continue;
    }

    if (!layer.paint || typeof layer.paint !== "object") continue;
    const paint = layer.paint as Record<string, unknown>;

    for (const key of Object.keys(paint)) {
      if (!COLOR_PAINT_PROPERTIES.has(key)) continue;
      paint[key] = transformPaintValue(paint[key], {
        id: layer.id,
        type: layer.type,
        sourceLayer,
        propName: key,
      });
    }

    // In Liberty, highway-name-minor & highway-name-major set text-halo-width: 1
    // without an explicit text-halo-color. Ensure a dark halo when text-halo-width is set.
    if (
      layer.type === "symbol" &&
      "text-color" in paint &&
      "text-halo-width" in paint &&
      !("text-halo-color" in paint)
    ) {
      paint["text-halo-color"] = "#0c1118";
    }
  }

  return clone;
}

let cachedLibertyLight: StyleSpecification | null = null;
let cachedLibertyDark: StyleSpecification | null = null;
let inflightPromise: Promise<{
  light: StyleSpecification;
  dark: StyleSpecification;
}> | null = null;

/**
 * Fetches the OpenFreeMap Liberty style JSON once, caches both the untouched light style
 * and the generated dark style in memory, and returns cloned copies for MapLibre.
 */
export async function getLibertyStyles(): Promise<{
  light: StyleSpecification;
  dark: StyleSpecification;
  usedCssFilterFallback: boolean;
}> {
  if (cachedLibertyLight && cachedLibertyDark) {
    return {
      light: JSON.parse(JSON.stringify(cachedLibertyLight)),
      dark: JSON.parse(JSON.stringify(cachedLibertyDark)),
      usedCssFilterFallback: false,
    };
  }

  if (!inflightPromise) {
    inflightPromise = fetch(LIBERTY_STYLE_URL)
      .then(async (res) => {
        if (!res.ok) {
          throw new Error(`Failed to fetch Liberty style (${res.status})`);
        }
        const light = (await res.json()) as StyleSpecification;
        const dark = makeDarkStyle(light);
        cachedLibertyLight = light;
        cachedLibertyDark = dark;
        return { light, dark };
      })
      .finally(() => {
        inflightPromise = null;
      });
  }

  const { light, dark } = await inflightPromise;
  return {
    light: JSON.parse(JSON.stringify(light)),
    dark: JSON.parse(JSON.stringify(dark)),
    usedCssFilterFallback: false,
  };
}
