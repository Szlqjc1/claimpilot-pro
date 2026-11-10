import { describe, expect, it } from "vitest";
import { detectPageCorners } from "@/lib/ai/corners";
import type { Rgba } from "@/lib/ai/perspective";
import { buildScene, clipRight, cropVerdict, rectQuad } from "@/lib/bench/scope";

// Scope scenes (Task 16 A, DECISIONS D-56): pure, deterministic, and the true quads say which sheet is which.

/** A small white "invoice": paper 245 with dark text bars, `w` × `h`. */
function sheet(w: number, h: number, ink = 30): Rgba {
  const data = new Uint8ClampedArray(w * h * 4).fill(245);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const o = (y * w + x) * 4;
      if (y % 14 < 4 && x > w * 0.1 && x < w * 0.8 && y > h * 0.1 && y < h * 0.9) data[o] = data[o + 1] = data[o + 2] = ink;
      data[o + 3] = 255;
    }
  return { data, width: w, height: h };
}

describe("scope scenes", () => {
  const target = sheet(340, 440);
  const other = sheet(340, 440, 60);
  const label = sheet(160, 130);

  it("are deterministic", () => {
    const a = buildScene("S2", { target, other, label }, "CLM-X", 0);
    const b = buildScene("S2", { target, other, label }, "CLM-X", 0);
    expect(Buffer.from(a.image.data).equals(Buffer.from(b.image.data))).toBe(true);
  });

  it("S1 is landscape with the target on the left; the nearer (larger) page alternates with the index", () => {
    const area = (q: { x: number; y: number }[]) => Math.abs(q.reduce((s, p, i) => s + p.x * q[(i + 1) % 4].y - q[(i + 1) % 4].x * p.y, 0)) / 2;
    const even = buildScene("S1", { target, other }, "CLM-X", 0);
    const odd = buildScene("S1", { target, other }, "CLM-X", 1);
    expect(even.image.width).toBeGreaterThan(even.image.height);
    expect(Math.max(...even.target.map((p) => p.x))).toBeLessThan(Math.min(...even.other!.map((p) => p.x)));
    expect(area(even.target)).toBeGreaterThan(area(even.other!));
    expect(area(odd.other!)).toBeGreaterThan(area(odd.target));
  });

  it("S1 known behaviour: the detector takes the larger page, so with the other page nearer it crops the wrong one", () => {
    const s = buildScene("S1", { target, other }, "CLM-X", 1);
    const d = detectPageCorners(s.image);
    expect(cropVerdict(d?.corners ?? null, s.target, s.other, { w: s.image.width, h: s.image.height }).verdict).toBe("other");
  });

  it("S3 cuts the page at the right edge; clipRight gives the visible part", () => {
    const s = buildScene("S3", { target }, "CLM-X", 0);
    const W = s.image.width;
    expect(Math.max(...s.target.map((p) => p.x))).toBeGreaterThan(W);
    const v = clipRight(s.target, W);
    expect(v[1].x).toBeCloseTo(W);
    expect(v[2].x).toBeCloseTo(W);
    expect(v[0]).toEqual(s.target[0]);
  });

  it("cropVerdict: within 3 % of the shorter side is a match; none when nothing was found", () => {
    const t = rectQuad(100, 100, 80, 100);
    const o = rectQuad(300, 100, 80, 100);
    const frame = { w: 400, h: 200 };
    expect(cropVerdict(t.map((p) => ({ x: p.x + 3, y: p.y })), t, o, frame).verdict).toBe("target");
    expect(cropVerdict(o, t, o, frame).verdict).toBe("other");
    expect(cropVerdict(rectQuad(200, 100, 300, 180), t, o, frame).verdict).toBe("other region");
    expect(cropVerdict(null, t, o, frame)).toEqual({ verdict: "none", meanErrPx: null });
  });
});
