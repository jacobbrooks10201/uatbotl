// Pixel style (spec §16 "original style"): every unit is a 32×32 abstract,
// monocolour pixel sprite with at least one line of symmetry. Sprites are
// generated deterministically from the unit id, so they never change between
// sessions and need no image assets.
//
// The sprite is a 16×16 grid of 2×2-pixel blocks: random noise on one half
// (or quarter), smoothed into blobs by a cellular automaton, then mirrored.
// Royals and gates get both a vertical and a horizontal axis.

const N = 16;

function hash(str: string): number {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) h = Math.imul(h ^ str.charCodeAt(i), 16777619);
  return h >>> 0;
}

function rng(seed: number) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function grid(key: string, both: boolean, salt: number): boolean[][] {
  const rand = rng(hash(`${key}#${salt}`));
  let g: boolean[][] = Array.from({ length: N }, () => new Array<boolean>(N).fill(false));
  // Noise on the left half (top-left quarter if `both`), inside a 1-block margin.
  for (let r = 1; r < N - 1; r++)
    for (let c = 1; c < N / 2; c++) {
      // Denser towards the centre so sprites read as one figure.
      const d = Math.hypot(c + 0.5 - N / 2, r + 0.5 - N / 2) / (N / 2);
      g[r][c] = rand() < 0.75 - 0.55 * d;
    }
  const mirror = (h: boolean[][]) => {
    for (let r = 0; r < N; r++) for (let c = 0; c < N / 2; c++) h[r][N - 1 - c] = h[r][c];
    if (both) for (let r = 0; r < N / 2; r++) for (let c = 0; c < N; c++) h[N - 1 - r][c] = h[r][c];
  };
  mirror(g);
  // Smooth: a symmetric rule on a symmetric grid keeps the symmetry.
  for (let it = 0; it < 2; it++) {
    const next = g.map((row) => row.slice());
    for (let r = 1; r < N - 1; r++)
      for (let c = 1; c < N - 1; c++) {
        let n = 0;
        for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) if (g[r + dr][c + dc]) n++;
        next[r][c] = n >= 5;
      }
    g = next;
  }
  return g;
}

function density(g: boolean[][]): number {
  return g.flat().filter(Boolean).length / (N * N);
}

function toSvg(g: boolean[][]): string {
  let d = '';
  for (let r = 0; r < N; r++) for (let c = 0; c < N; c++) if (g[r][c]) d += `M${c * 2} ${r * 2}h2v2h-2z`;
  return `<svg class="px" viewBox="0 0 32 32" shape-rendering="crispEdges" aria-hidden="true"><path d="${d}"/></svg>`;
}

const cache = new Map<string, string>();

/** SVG sprite for a unit, drawn in `currentColor`. */
export function unitSprite(id: string, both: boolean): string {
  const key = `${id}|${both}`;
  const hit = cache.get(key);
  if (hit) return hit;
  // Re-roll until the figure is substantial but not a solid block.
  let g = grid(id, both, 0);
  for (let salt = 1; salt < 40 && (density(g) < 0.22 || density(g) > 0.5); salt++) g = grid(id, both, salt);
  const svg = toSvg(g);
  cache.set(key, svg);
  return svg;
}

/**
 * Stones: a circle rendered in pixels at full 32-pixel resolution, filling
 * almost the whole square. Reinforced stones have a thin ring cut into it.
 */
export function stoneSprite(reinforced: boolean): string {
  const key = `stone|${reinforced}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const S = 32;
  const disc = 15.6;
  let d = '';
  for (let r = 0; r < S; r++) {
    // Distance from the centre: symmetric about both axes by construction.
    for (let c = 0; c < S; c++) {
      const dist = Math.hypot(c + 0.5 - S / 2, r + 0.5 - S / 2);
      const on = dist <= disc && !(reinforced && dist > 9.5 && dist <= 11.5);
      if (on) d += `M${c} ${r}h1v1h-1z`;
    }
  }
  const svg = `<svg class="px" viewBox="0 0 32 32" shape-rendering="crispEdges" aria-hidden="true"><path d="${d}"/></svg>`;
  cache.set(key, svg);
  return svg;
}
