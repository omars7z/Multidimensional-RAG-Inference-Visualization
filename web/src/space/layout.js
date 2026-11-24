// World layout for the immersive view. Units are metres; the road runs from the browser (+z) into the system (-z).
// Every journey item from Journey3D has an anchor here, so the 16 stages replay as flights between real places.

export const COLORS = {
  browser: "#7b93ff", server: "#a7b1c4", graph: "#2fe6b5", local: "#ffb347", cloud: "#b68cff", bad: "#ff6b6b", text: "#e9edf5",
};

export const GALAXY = { center: [-105, 34, -14], radius: 42 };
export const TOWER = { base: [-48, 0, 4], ringGap: 1.25, radius: 5.5 };
export const COLOSSUS = { base: [86, 0, -66], slabs: 12, gap: 3.4 };
export const ARBITER = [72, 26, 42];

export const ANCHORS = {
  ask: [0, 2.5, 126], fetch: [0, 3, 108], reader: [-12, 6, 116], view: [-24, 10, 124],
  post: [0, 6, 82], thread: [0, 3, 68], queue: [15, 4, 82], stream: [9, 5, 96],
  guard: [0, 6, 42], route: [0, 4, 24], retrieve: [0, 6, 6], generate: [0, 6, -14], check: [0, 6, -34],
  lang: [-18, 3, 42], qwen: [TOWER.base[0], 20, TOWER.base[2]], bm25: [-30, 6, -6], qdrant: GALAXY.center,
  budget: [-20, 3, -14], rules: [-18, 4, -34],
  arbiter: ARBITER, prefill: [COLOSSUS.base[0], 14, COLOSSUS.base[2]], decode: [COLOSSUS.base[0], 38, COLOSSUS.base[2]],
};

/** Places you can stand at; `layer` picks the colour, `info` is what the HUD says when you are near. */
export const STATIONS = [
  { id: "browser", name: "Browser terminal", layer: "browser", at: [-6, 0, 124], radius: 26,
    info: "Your question starts here. The React page streams NDJSON from the server and paints the draft token by token." },
  { id: "server", name: "Server gateway", layer: "server", at: [0, 0, 80], radius: 20,
    info: "Starlette on 127.0.0.1:8001. One producer thread runs the whole graph and pushes events into a queue that is streamed back." },
  { id: "graph", name: "LangGraph hall", layer: "graph", at: [0, 0, 4], radius: 40,
    info: "Five stations on one road: guard, route, retrieve, generate, check. Each is a Python function that reads the shared state and returns what it changes." },
  { id: "tower", name: "Embedding tower", layer: "local", at: [TOWER.base[0], 0, TOWER.base[2]], radius: 18,
    info: "Qwen3-Embedding on this machine. Each ring is one of the 28 transformer layers; its glow is how close the end token already is to the final vector, measured for your question." },
  { id: "galaxy", name: "Knowledge galaxy", layer: "local", at: [GALAXY.center[0], 0, GALAXY.center[2]], radius: 50, fly: GALAXY.center,
    info: "Every chunk in the index, placed in 3D from its real 1,024-number vector. Close points mean similar meaning. The white star is your question; beams reach the chunks hybrid search picked." },
  { id: "arbiter", name: "Arbiter", layer: "cloud", at: [ARBITER[0], 0, ARBITER[2]], radius: 22, fly: ARBITER,
    info: "The Arbiter, a remote scoring model. One forward pass scores four options; the satellites' sizes are the real probabilities it returned for your question." },
  { id: "colossus", name: "GPT 6", layer: "cloud", at: [COLOSSUS.base[0], 0, COLOSSUS.base[2]], radius: 28, fly: [COLOSSUS.base[0], 22, COLOSSUS.base[2] + 30],
    info: "The remote answer model. Prefill reads the whole prompt in one pass and fills the KV cache (the spiral); then the decode loop sends one token at a time back down the beam." },
];

export const START = { position: [0, 3, 160], yaw: 0 };

export function lerp3(a, b, t) {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}

/** Waypoints for a stage path: anchors with an arc lifted between each pair, so the packet flies instead of sliding. */
export function routePoints(path) {
  const pts = [];
  path.forEach((id, i) => {
    const p = ANCHORS[id];
    if (i > 0) {
      const q = ANCHORS[path[i - 1]];
      const d = Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]);
      const m = lerp3(q, p, 0.5);
      pts.push([m[0], m[1] + Math.min(26, d * 0.22), m[2]]);
    }
    pts.push(p);
  });
  return pts;
}

export const hashHue = (s) => { let h = 0; for (const c of String(s)) h = (h * 31 + c.charCodeAt(0)) % 360; return h; };
