const COLOR_STOPS: Array<{ t: number; rgba: [number, number, number, number] }> = [
  // More visible (no fully transparent low-end), still smooth.
  { t: 0.0, rgba: [70, 130, 180, 90] },
  { t: 0.15, rgba: [70, 130, 180, 140] },
  { t: 0.3, rgba: [100, 180, 160, 170] },
  { t: 0.45, rgba: [140, 200, 120, 190] },
  { t: 0.6, rgba: [200, 210, 100, 210] },
  { t: 0.75, rgba: [220, 200, 80, 225] },
  { t: 0.9, rgba: [230, 150, 60, 240] },
  { t: 1.0, rgba: [200, 80, 60, 255] },
];

export function lerp(a: number, b: number, t: number) {
  return a + (b - a) * t;
}

export function clamp01(x: number) {
  return Math.max(0, Math.min(1, x));
}

export function colorForT(t: number): [number, number, number, number] {
  const x = clamp01(t);
  for (let i = 0; i < COLOR_STOPS.length - 1; i++) {
    const a = COLOR_STOPS[i];
    const b = COLOR_STOPS[i + 1];
    if (x >= a.t && x <= b.t) {
      const u = (x - a.t) / (b.t - a.t || 1);
      return [
        Math.round(lerp(a.rgba[0], b.rgba[0], u)),
        Math.round(lerp(a.rgba[1], b.rgba[1], u)),
        Math.round(lerp(a.rgba[2], b.rgba[2], u)),
        Math.round(lerp(a.rgba[3], b.rgba[3], u)),
      ];
    }
  }
  return COLOR_STOPS[COLOR_STOPS.length - 1].rgba;
}
