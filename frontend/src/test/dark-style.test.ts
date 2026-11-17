import type { StyleSpecification } from "maplibre-gl";
import { describe, expect, it } from "vitest";
import {
  makeDarkStyle,
  parseColor,
  transformColorString,
  transformPaintValue,
} from "@/lib/map/darkStyle";

const SAMPLE_LIBERTY_STYLE: StyleSpecification = {
  version: 8,
  name: "Liberty Sample",
  sprite: "https://tiles.openfreemap.org/sprites/ofm_f384/ofm",
  glyphs: "https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf",
  sources: {
    openmaptiles: {
      type: "vector",
      url: "https://tiles.openfreemap.org/planet",
    },
  },
  layers: [
    {
      id: "background",
      type: "background",
      paint: { "background-color": "#f8f4f0" },
    },
    {
      id: "park",
      type: "fill",
      source: "openmaptiles",
      "source-layer": "park",
      paint: {
        "fill-color": "#d8e8c8",
        "fill-opacity": 0.7,
        "fill-outline-color": "rgba(95, 208, 100, 1)",
      },
    },
    {
      id: "landuse_residential",
      type: "fill",
      source: "openmaptiles",
      "source-layer": "landuse",
      paint: {
        "fill-color": [
          "interpolate",
          ["linear"],
          ["zoom"],
          9,
          "hsla(0,3%,85%,0.84)",
          12,
          "hsla(35,57%,88%,0.49)",
        ],
      },
    },
    {
      id: "water",
      type: "fill",
      source: "openmaptiles",
      "source-layer": "water",
      paint: { "fill-color": "rgb(158,189,255)" },
    },
    {
      id: "road_motorway_casing",
      type: "line",
      source: "openmaptiles",
      "source-layer": "transportation",
      paint: {
        "line-color": "#e9ac77",
        "line-dasharray": [0.5, 0.25],
        "line-width": [
          "interpolate",
          ["exponential", 1.2],
          ["zoom"],
          5,
          0.4,
          20,
          22,
        ],
      },
    },
    {
      id: "road_motorway",
      type: "line",
      source: "openmaptiles",
      "source-layer": "transportation",
      paint: {
        "line-color": [
          "interpolate",
          ["linear"],
          ["zoom"],
          5,
          "hsl(26,87%,62%)",
          6,
          "#fc8",
        ],
        "line-width": [
          "interpolate",
          ["exponential", 1.2],
          ["zoom"],
          5,
          0,
          7,
          1,
          20,
          18,
        ],
      },
    },
    {
      id: "building",
      type: "fill",
      source: "openmaptiles",
      "source-layer": "building",
      paint: {
        "fill-color": "hsl(35,8%,85%)",
        "fill-outline-color": [
          "interpolate",
          ["linear"],
          ["zoom"],
          13,
          "hsla(35,6%,79%,0.32)",
          14,
          "hsl(35,6%,79%)",
        ],
      },
    },
    {
      id: "boundary_2",
      type: "line",
      source: "openmaptiles",
      "source-layer": "boundary",
      paint: {
        "line-color": "hsl(248,1%,41%)",
        "line-dasharray": [1, 2],
      },
    },
    {
      id: "highway-name-major",
      type: "symbol",
      source: "openmaptiles",
      "source-layer": "transportation_name",
      layout: { "text-field": "{name:latin}" },
      paint: {
        "text-color": "#666",
        "text-halo-blur": 0.5,
        "text-halo-width": 1,
      },
    },
    {
      id: "label_state",
      type: "symbol",
      source: "openmaptiles",
      "source-layer": "place",
      layout: { "text-field": "{name:latin}" },
      paint: {
        "text-color": "#333",
        "text-halo-blur": 1,
        "text-halo-color": "#fff",
        "text-halo-width": 1,
      },
    },
    {
      id: "label_city",
      type: "symbol",
      source: "openmaptiles",
      "source-layer": "place",
      layout: { "text-field": "{name:latin}" },
      paint: {
        "text-color": "#000",
        "text-halo-blur": 1,
        "text-halo-color": "#fff",
        "text-halo-width": 1,
      },
    },
  ],
};

describe("parseColor & transformColorString", () => {
  it("parses hex, rgb(a), hsl(a), and named colors accurately", () => {
    expect(parseColor("#fff")?.l).toBeCloseTo(100, 1);
    expect(parseColor("#000000")?.l).toBeCloseTo(0, 1);
    expect(parseColor("rgb(158, 189, 255)")?.h).toBeGreaterThan(210);
    expect(parseColor("rgba(95, 208, 100, 0.5)")?.a).toBeCloseTo(0.5, 2);
    expect(parseColor("hsl(26, 87%, 62%)")?.s).toBeCloseTo(87, 1);
    expect(parseColor("hsla(98, 61%, 72%, 0.7)")?.a).toBeCloseTo(0.7, 2);
    expect(parseColor("white")?.l).toBe(100);
    expect(parseColor("not-a-color")).toBeNull();
  });

  it("maps light land/water/park colors into dark-mode HSL ranges while keeping park green and water blue", () => {
    const bgDark = parseColor(
      transformColorString("#f8f4f0", {
        id: "background",
        type: "background",
        sourceLayer: "",
        propName: "background-color",
      }),
    )!;
    expect(bgDark.l).toBeGreaterThanOrEqual(8);
    expect(bgDark.l).toBeLessThanOrEqual(16);

    const waterDark = parseColor(
      transformColorString("rgb(158,189,255)", {
        id: "water",
        type: "fill",
        sourceLayer: "water",
        propName: "fill-color",
      }),
    )!;
    expect(waterDark.h).toBeGreaterThanOrEqual(200);
    expect(waterDark.h).toBeLessThanOrEqual(220);
    expect(waterDark.l).toBeLessThan(15);

    const parkDark = parseColor(
      transformColorString("#d8e8c8", {
        id: "park",
        type: "fill",
        sourceLayer: "park",
        propName: "fill-color",
      }),
    )!;
    expect(parkDark.h).toBeGreaterThanOrEqual(95);
    expect(parkDark.h).toBeLessThanOrEqual(155);
    expect(parkDark.l).toBeGreaterThanOrEqual(12);
    expect(parkDark.l).toBeLessThanOrEqual(20);
  });
});

describe("transformPaintValue expressions & legacy stops", () => {
  const ctx = {
    id: "road_motorway",
    type: "line",
    sourceLayer: "transportation",
    propName: "line-color",
  };

  it("transforms colors nested inside interpolate, step, match, case, to-color, and stops without touching non-colors", () => {
    const stepExpr = [
      "step",
      ["zoom"],
      "#ffffff",
      8,
      "#ffcc88",
      12,
      "rgb(255, 244, 198)",
    ];
    const stepOut = transformPaintValue(stepExpr, ctx) as unknown[];
    expect(stepOut[0]).toBe("step");
    expect(stepOut[1]).toEqual(["zoom"]);
    expect(stepOut[3]).toBe(8);
    expect(stepOut[5]).toBe(12);
    expect(stepOut[2]).not.toBe("#ffffff");
    expect(stepOut[4]).not.toBe("#ffcc88");

    // In a match expression, label strings (even if they match a color name like "white") must NOT be altered!
    const matchExpr = [
      "match",
      ["get", "class"],
      "white",
      "#ffffff",
      "motorway",
      "#fc8",
      "#ccc",
    ];
    const matchOut = transformPaintValue(matchExpr, ctx) as unknown[];
    expect(matchOut[2]).toBe("white");
    expect(matchOut[4]).toBe("motorway");
    expect(matchOut[3]).not.toBe("#ffffff");
    expect(matchOut[5]).not.toBe("#fc8");
    expect(matchOut[6]).not.toBe("#ccc");

    const caseExpr = [
      "case",
      ["boolean", ["feature-state", "hover"], false],
      "#fff",
      "#fc8",
    ];
    const caseOut = transformPaintValue(caseExpr, ctx) as unknown[];
    expect(caseOut[1]).toEqual(["boolean", ["feature-state", "hover"], false]);
    expect(caseOut[2]).not.toBe("#fff");
    expect(caseOut[3]).not.toBe("#fc8");

    const toColorExpr = ["to-color", "#ffffff", "#000000"];
    const toColorOut = transformPaintValue(toColorExpr, ctx) as unknown[];
    expect(toColorOut[0]).toBe("to-color");
    expect(toColorOut[1]).not.toBe("#ffffff");

    const legacyStops = {
      base: 1.4,
      stops: [
        [6, "#ffffff"],
        [14, "hsl(35, 80%, 80%)"],
      ],
    };
    const stopsOut = transformPaintValue(legacyStops, ctx) as {
      base: number;
      stops: [number, string][];
    };
    expect(stopsOut.base).toBe(1.4);
    expect(stopsOut.stops[0][0]).toBe(6);
    expect(stopsOut.stops[1][0]).toBe(14);
    expect(stopsOut.stops[0][1]).not.toBe("#ffffff");
  });
});

describe("makeDarkStyle structural & snapshot parity", () => {
  it("preserves exact layer count, layer IDs, order, and non-color properties", () => {
    const dark = makeDarkStyle(SAMPLE_LIBERTY_STYLE);

    expect(dark.layers.length).toBe(SAMPLE_LIBERTY_STYLE.layers.length);
    expect(dark.layers.map((l) => l.id)).toEqual(
      SAMPLE_LIBERTY_STYLE.layers.map((l) => l.id),
    );
    expect(dark.sprite).toBe(SAMPLE_LIBERTY_STYLE.sprite);
    expect(dark.glyphs).toBe(SAMPLE_LIBERTY_STYLE.glyphs);

    // Non-color properties (line-width, line-dasharray, fill-opacity) are untouched
    const darkMotorwayCasing = dark.layers.find(
      (l) => l.id === "road_motorway_casing",
    )!;
    const lightMotorwayCasing = SAMPLE_LIBERTY_STYLE.layers.find(
      (l) => l.id === "road_motorway_casing",
    )!;
    expect(
      (darkMotorwayCasing.paint as Record<string, unknown>)["line-dasharray"],
    ).toEqual(
      (lightMotorwayCasing.paint as Record<string, unknown>)["line-dasharray"],
    );
    expect(
      (darkMotorwayCasing.paint as Record<string, unknown>)["line-width"],
    ).toEqual(
      (lightMotorwayCasing.paint as Record<string, unknown>)["line-width"],
    );
  });

  it("matches snapshot of layer IDs and key transformed dark colors", () => {
    const dark = makeDarkStyle(SAMPLE_LIBERTY_STYLE);
    const summary = {
      layerIds: dark.layers.map((l) => l.id),
      keyColors: {
        background: (
          dark.layers.find((l) => l.id === "background")?.paint as Record<
            string,
            unknown
          >
        )?.["background-color"],
        parkFill: (
          dark.layers.find((l) => l.id === "park")?.paint as Record<
            string,
            unknown
          >
        )?.["fill-color"],
        waterFill: (
          dark.layers.find((l) => l.id === "water")?.paint as Record<
            string,
            unknown
          >
        )?.["fill-color"],
        motorwayCasing: (
          dark.layers.find((l) => l.id === "road_motorway_casing")
            ?.paint as Record<string, unknown>
        )?.["line-color"],
        motorwayLine: (
          dark.layers.find((l) => l.id === "road_motorway")?.paint as Record<
            string,
            unknown
          >
        )?.["line-color"],
        cityText: (
          dark.layers.find((l) => l.id === "label_city")?.paint as Record<
            string,
            unknown
          >
        )?.["text-color"],
        cityHalo: (
          dark.layers.find((l) => l.id === "label_city")?.paint as Record<
            string,
            unknown
          >
        )?.["text-halo-color"],
        stateText: (
          dark.layers.find((l) => l.id === "label_state")?.paint as Record<
            string,
            unknown
          >
        )?.["text-color"],
      },
    };

    expect(summary).toMatchInlineSnapshot(`
      {
        "keyColors": {
          "background": "#141a24",
          "cityHalo": "#0c1118",
          "cityText": "#e7ebef",
          "motorwayCasing": "#1a2028",
          "motorwayLine": [
            "interpolate",
            [
              "linear",
            ],
            [
              "zoom",
            ],
            5,
            "#93642f",
            6,
            "#93642f",
          ],
          "parkFill": "#20301d",
          "stateText": "#bbc3ce",
          "waterFill": "#0d1c2b",
        },
        "layerIds": [
          "background",
          "park",
          "landuse_residential",
          "water",
          "road_motorway_casing",
          "road_motorway",
          "building",
          "boundary_2",
          "highway-name-major",
          "label_state",
          "label_city",
        ],
      }
    `);
  });
});
