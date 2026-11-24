// The system as a place: browser terminal, server gateway, the LangGraph hall, local engines (embedding tower,
// BM25, context budget, grounding rules, the knowledge galaxy) and the remote models, joined by live beams.
//
// Performance rules for this file: no lights that mount or unmount (a light-count change recompiles every lit
// material), labels are sprites (no per-frame DOM work), unlit or Lambert materials, and instance buffers are
// written once and only animated through group transforms or `count`.
import { Edges, Float, Grid, QuadraticBezierLine, Sparkles, Stars } from "@react-three/drei";
import { useFrame } from "@react-three/fiber";
import { useMemo, useRef } from "react";
import { CanvasTexture, CatmullRomCurve3, Color, Object3D, SRGBColorSpace, Vector3 } from "three";
import { STAGES } from "../components/Journey3D.jsx";
import { Galaxy } from "./Galaxy.jsx";
import { Near } from "./Near.jsx";
import { TextSprite } from "./TextSprite.jsx";
import { ANCHORS, COLORS, COLOSSUS, ARBITER, TOWER, routePoints } from "./layout.js";

const glow = (hex, k = 1) => new Color(hex).multiplyScalar(k);

function Label({ position, title, sub, color, big, range }) {
  return (
    <Near position={position} range={range ?? (big ? 340 : 130)}>
      <TextSprite title={big ? title.toUpperCase() : title} sub={sub} color={color} height={big ? 3.2 : 1.7} />
    </Near>
  );
}

/** Word-wrap `text` into lines that fit `width` on a 2D canvas (Arabic too: the browser shapes it). */
function wrap(ctx, text, width, maxLines) {
  const lines = [];
  for (const para of text.split("\n")) {
    let line = "";
    for (const word of para.split(/\s+/)) {
      const next = line ? `${line} ${word}` : word;
      if (ctx.measureText(next).width > width && line) { lines.push(line); line = word; } else line = next;
    }
    lines.push(line);
  }
  return lines.length > maxLines ? [...lines.slice(0, maxLines - 1), lines[maxLines - 1] + " …"] : lines;
}

/** Animated dashed beam between two anchors; brighter while a stage uses it. */
function Beam({ from, to, color, lift = 8, on = false, width = 1.4 }) {
  const ref = useRef();
  useFrame((_, dt) => { if (ref.current) ref.current.material.dashOffset -= dt * (on ? 9 : 2); });
  const mid = [(from[0] + to[0]) / 2, Math.max(from[1], to[1]) + lift, (from[2] + to[2]) / 2];
  return <QuadraticBezierLine ref={ref} start={from} end={to} mid={mid} color={color} lineWidth={on ? width * 2.2 : width} dashed dashSize={1.2} gapSize={0.9} transparent opacity={on ? 1 : 0.45} />;
}

function Environment({ quality }) {
  return (
    <>
      <color attach="background" args={["#02040a"]} />
      <fogExp2 attach="fog" args={["#040713", 0.0042]} />
      <ambientLight intensity={0.5} />
      <hemisphereLight args={["#6f8cff", "#05070d", 0.7]} />
      <Stars radius={520} depth={160} count={quality === "sharp" ? 5000 : 2500} factor={7} saturation={0.4} fade speed={0.5} />
      <Grid position={[0, 0.02, 0]} infiniteGrid cellSize={2} cellThickness={0.55} cellColor="#16223f" sectionSize={20} sectionThickness={1.1}
        sectionColor="#2a4fd8" fadeDistance={300} fadeStrength={1.6} />
      <mesh rotation-x={-Math.PI / 2}><planeGeometry args={[1400, 1400]} /><meshBasicMaterial color="#03050b" /></mesh>
      <Sparkles count={quality === "sharp" ? 260 : 120} scale={[360, 80, 380]} position={[0, 36, 0]} size={3} speed={0.3} opacity={0.4} color="#8fb3ff" />
    </>
  );
}

function Road() {
  const dashes = useMemo(() => Array.from({ length: 40 }, (_, i) => 150 - i * 5), []);
  const mesh = useRef();
  return (
    <group>
      {[-5.5, 5.5].map((x) => (
        <mesh key={x} position={[x, 0.06, 55]}><boxGeometry args={[0.25, 0.08, 210]} /><meshBasicMaterial color={glow(COLORS.browser, 2.2)} toneMapped={false} /></mesh>
      ))}
      <instancedMesh ref={(m) => {
        mesh.current = m;
        if (!m) return;
        const o = new Object3D();
        dashes.forEach((z, i) => { o.position.set(0, 0.05, z); o.updateMatrix(); m.setMatrixAt(i, o.matrix); });
        m.instanceMatrix.needsUpdate = true;
      }} args={[undefined, undefined, dashes.length]}>
        <boxGeometry args={[0.18, 0.06, 2]} /><meshBasicMaterial color={glow("#3a4f8f", 1.2)} toneMapped={false} />
      </instancedMesh>
    </group>
  );
}

function Pylon({ position, size = [4.5, 10, 4.5], color, on, state, children }) {
  const k = state === "refused" ? COLORS.bad : color;
  const dim = state === "skipped";
  return (
    <group position={position}>
      <mesh position={[0, size[1] / 2, 0]}>
        <boxGeometry args={size} />
        <meshLambertMaterial color="#070b16" emissive={k} emissiveIntensity={on ? 1.6 : dim ? 0.05 : 0.35} transparent={dim} opacity={dim ? 0.5 : 1} />
        <Edges color={glow(k, on ? 3 : 1.4)} />
      </mesh>
      <mesh position={[0, 0.08, 0]} rotation-x={-Math.PI / 2}>
        <ringGeometry args={[size[0] * 0.9, size[0] * 1.05, 40]} />
        <meshBasicMaterial color={glow(k, on ? 3 : 1)} toneMapped={false} transparent opacity={dim ? 0.3 : 0.9} />
      </mesh>
      {children}
    </group>
  );
}

function BrowserTerminal({ run, insp, stageId, on }) {
  const started = useRef(0);
  const last = useRef({ key: -1, at: 0 });
  const answer = run?.answer ?? "";
  const q = run?.question ?? insp?.question ?? "";
  const rtl = run?.lang === "ar";
  const { canvas, texture } = useMemo(() => {
    const c = document.createElement("canvas");
    c.width = 1024; c.height = 568;
    const t = new CanvasTexture(c);
    t.colorSpace = SRGBColorSpace;
    t.anisotropy = 4;
    return { canvas: c, texture: t };
  }, []);
  // The screen is drawn on a 2D canvas used as a texture, so it sits in the world (occluded, bloomed).
  const draw = (shown, caret) => {
    const ctx = canvas.getContext("2d");
    const W = canvas.width, H = canvas.height;
    const g = ctx.createLinearGradient(0, 0, W, H);
    g.addColorStop(0, "#1d2a66"); g.addColorStop(1, "#050914");
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = "rgba(123,147,255,.10)";
    for (let y = 0; y < H; y += 4) ctx.fillRect(0, y, W, 1);
    ctx.fillStyle = "#7b93ff";
    [0, 1, 2].forEach((i) => { ctx.beginPath(); ctx.arc(40 + i * 22, 38, 7, 0, Math.PI * 2); ctx.fill(); });
    ctx.font = "18px Consolas, monospace"; ctx.fillStyle = "#9fb0e0"; ctx.textAlign = "left"; ctx.direction = "ltr";
    ctx.fillText("Knowledge Assistant · 127.0.0.1:8001", 116, 44);
    ctx.direction = rtl ? "rtl" : "ltr"; ctx.textAlign = rtl ? "right" : "left";
    const x = rtl ? W - 44 : 44;
    ctx.font = "600 35px Segoe UI, Noto Sans Arabic, sans-serif"; ctx.fillStyle = "#ffffff";
    ctx.shadowColor = "#7b93ff"; ctx.shadowBlur = 14;
    const ql = wrap(ctx, q || "Ask a question on the assistant page to see it here.", W - 88, 2);
    ql.forEach((l, i) => ctx.fillText(l, x, 112 + i * 44));
    ctx.shadowBlur = 0;
    ctx.font = "24px Segoe UI, Noto Sans Arabic, sans-serif"; ctx.fillStyle = "#c9d6ff";
    const al = wrap(ctx, shown + (caret ? " ▍" : ""), W - 88, 11);
    al.forEach((l, i) => ctx.fillText(l, x, 112 + ql.length * 44 + 32 + i * 35));
    texture.needsUpdate = true;
  };
  useFrame(({ clock }) => {
    const t = clock.elapsedTime;
    if (stageId !== "decode") started.current = t;
    const n = stageId === "decode" ? Math.floor((t - started.current) * 90) : stageId === "check" || stageId === "result" ? answer.length : 0;
    const caret = stageId === "decode" && Math.floor(t * 2) % 2 === 0;
    const key = Math.min(n, answer.length) * 2 + (caret ? 1 : 0);
    // Redraw at most 8 times a second: each redraw re-uploads the texture.
    if (key !== last.current.key && (t - last.current.at > 0.125 || last.current.key < 0)) { last.current = { key, at: t }; draw(answer.slice(0, n), caret); }
  });
  return (
    <group>
      <group position={ANCHORS.view} rotation-y={0.55}>
        <mesh><boxGeometry args={[27, 15, 0.5]} /><meshLambertMaterial color="#060a16" /><Edges color={glow(COLORS.browser, on ? 3 : 1.5)} /></mesh>
        <mesh position={[0, 0, 0.27]}>
          <planeGeometry args={[26, 14.4]} />
          <meshBasicMaterial map={texture} toneMapped={false} color={on ? [1.5, 1.5, 1.6] : [1.1, 1.1, 1.2]} />
        </mesh>
      </group>
      <Pylon position={[ANCHORS.ask[0], 0, ANCHORS.ask[2]]} size={[3, 2.2, 3]} color={COLORS.browser} on={on} />
      <Label position={[0, 6, 126]} title="Ask" sub="you press Enter" color={COLORS.browser} />
    </group>
  );
}

function ServerGate({ on }) {
  const lines = useRef();
  useFrame(({ clock }) => {
    if (!lines.current) return;
    lines.current.children.forEach((m, i) => { m.position.y = 1 + ((clock.elapsedTime * (on ? 3 : 0.8) + i * 1.6) % 13); });
  });
  return (
    <group position={[0, 0, 82]}>
      {[-9, 9].map((x) => (
        <mesh key={x} position={[x, 7, 0]}><boxGeometry args={[1.6, 14, 1.6]} /><meshLambertMaterial color="#0a0f1c" emissive={COLORS.server} emissiveIntensity={on ? 0.9 : 0.25} /><Edges color={glow(COLORS.server, 2)} /></mesh>
      ))}
      <mesh position={[0, 14.4, 0]}><boxGeometry args={[19.6, 1.4, 1.8]} /><meshLambertMaterial color="#0a0f1c" emissive={COLORS.server} emissiveIntensity={on ? 1.2 : 0.3} /><Edges color={glow(COLORS.server, 2.4)} /></mesh>
      <group ref={lines}>
        {Array.from({ length: 8 }, (_, i) => (
          <mesh key={i} position={[15, 1 + i * 1.6, 0]}>
            <boxGeometry args={[5, 0.35, 2.4]} /><meshBasicMaterial color={glow(COLORS.server, on ? 2.4 : 1)} toneMapped={false} transparent opacity={0.8} />
          </mesh>
        ))}
      </group>
      <Label position={[0, 17.5, 0]} title="Web server" sub="Starlette · producer thread · NDJSON stream" color={COLORS.server} big />
      <Label position={[15, 15.5, 0]} title="event queue" sub="step · token · result lines" color={COLORS.server} />
    </group>
  );
}

function GraphHall({ run, on }) {
  const status = Object.fromEntries((run?.explanation ?? []).map((s) => [s.step, s.status]));
  const refused = run && run.verdict !== "in_scope";
  const st = (n) => (status[n] ? status[n] : run ? (refused && n !== "guard" ? "skipped" : "") : "");
  const t = run?.timings ?? {};
  const ms = (n) => (t[n] == null ? "" : t[n] >= 1000 ? `${(t[n] / 1000).toFixed(1)} s` : `${Math.round(t[n])} ms`);
  const nodes = [["guard", "Arbiter scores"], ["retrieve", "hybrid search"], ["generate", "prompt → GPT"], ["check", "grounding rules"]];
  return (
    <group>
      {nodes.map(([n, sub]) => (
        <Pylon key={n} position={[ANCHORS[n][0], 0, ANCHORS[n][2]]} color={COLORS.graph} on={on.has(n)} state={st(n)}>
          <Label position={[0, 13, 0]} title={n} sub={[st(n), ms(n)].filter(Boolean).join(" · ") || sub} color={st(n) === "refused" ? COLORS.bad : COLORS.graph} />
        </Pylon>
      ))}
      <Float speed={2} rotationIntensity={0.6} floatIntensity={0.6}>
        <mesh position={[0, 5, ANCHORS.route[2]]}>
          <octahedronGeometry args={[2.6]} />
          <meshBasicMaterial color={glow(refused ? COLORS.bad : COLORS.graph, on.has("route") ? 2.6 : 1.2)} toneMapped={false} wireframe />
        </mesh>
      </Float>
      <Label position={[0, 10, ANCHORS.route[2]]} title="route_after_guard" sub={run ? (refused ? "→ END (refused)" : "→ retrieve") : "retrieve or END"} color={refused ? COLORS.bad : COLORS.graph} />
      <group position={[32, 0, ANCHORS.route[2]]}>
        <mesh position={[0, 0.6, 0]}><cylinderGeometry args={[5, 5, 1.2, 6]} /><meshLambertMaterial color="#140707" emissive={COLORS.bad} emissiveIntensity={refused ? 1.5 : 0.15} /><Edges color={glow(COLORS.bad, refused ? 3 : 1)} /></mesh>
        <Label position={[0, 5, 0]} title="refusal" sub="fixed bilingual message" color={COLORS.bad} />
      </group>
      <Beam from={[0, 6, 24]} to={[27, 1.4, 24]} color={COLORS.bad} lift={4} on={!!refused} />
      {[["guard", "route"], ["route", "retrieve"], ["retrieve", "generate"], ["generate", "check"]].map(([a, b]) => (
        <Beam key={a} from={[0, 9.5, ANCHORS[a][2]]} to={[0, 9.5, ANCHORS[b][2]]} color={COLORS.graph} lift={3} on={on.has(a) && on.has(b)} />
      ))}
      <Label position={[13, 22, 4]} title="LangGraph" sub="app/graph.py · StateGraph" color={COLORS.graph} big />
    </group>
  );
}

function EmbeddingTower({ insp, on }) {
  const rings = useRef();
  const beads = useRef();
  const sim = insp?.embedding.layer_similarity?.length ? insp.embedding.layer_similarity : null; // empty for API models
  const layers = sim ? sim.length : 29;
  const level = useMemo(() => {
    if (!sim) return Array.from({ length: 29 }, (_, i) => i / 28);
    const end = sim.map((row) => row[row.length - 1]);
    const lo = Math.min(...end), hi = Math.max(...end);
    return end.map((v) => (v - lo) / (hi - lo || 1));
  }, [sim]);
  const tokens = sim ? insp.embedding.tokens.slice(insp.embedding.prompt_tokens) : [];
  const base = useMemo(() => new Color(COLORS.local), []);
  useFrame(({ clock }, dt) => {
    const sweep = (clock.elapsedTime * (on ? 14 : 4)) % (layers + 6);
    rings.current?.children.forEach((r, i) => {
      r.rotation.z += dt * (i % 2 ? 0.25 : -0.25);
      r.material.color.copy(base).multiplyScalar(0.25 + level[i] * 2.4 + (Math.abs(sweep - i) < 1.2 ? 2.2 : 0));
    });
    if (beads.current) beads.current.rotation.y += dt * 0.35;
  });
  const [bx, , bz] = TOWER.base;
  const top = 2 + layers * TOWER.ringGap;
  return (
    <group position={[bx, 0, bz]}>
      <mesh position={[0, top / 2, 0]}><cylinderGeometry args={[1.1, 1.1, top, 16, 1, true]} /><meshBasicMaterial color={glow(COLORS.local, 1.6)} toneMapped={false} transparent opacity={0.35} /></mesh>
      <group ref={rings}>
        {Array.from({ length: layers }, (_, i) => (
          <mesh key={i} position={[0, 2 + i * TOWER.ringGap, 0]} rotation-x={Math.PI / 2}>
            <torusGeometry args={[TOWER.radius - i * 0.04, 0.16, 6, 48]} />
            <meshBasicMaterial color={COLORS.local} toneMapped={false} />
          </mesh>
        ))}
      </group>
      <group ref={beads} position={[0, 1.2, 0]}>
        {tokens.map((t, i) => {
          const a = (i / Math.max(1, tokens.length)) * Math.PI * 2, r = TOWER.radius + 4.5;
          const end = i === tokens.length - 1;
          return (
            <group key={i} position={[Math.cos(a) * r, 0, Math.sin(a) * r]}>
              <mesh><boxGeometry args={[0.9, 0.9, 0.9]} /><meshBasicMaterial color={glow(end ? COLORS.graph : COLORS.local, end ? 3 : 1.8)} toneMapped={false} /></mesh>
              <Near position={[0, 1.5, 0]} range={80}><TextSprite title={t.text.replace(/^ /, "·")} color={end ? COLORS.graph : COLORS.local} height={1} mono /></Near>
            </group>
          );
        })}
      </group>
      <Label position={[0, top + 4, 0]} title="Embedding tower" sub={insp ? `${insp.embedding.model.split("/").pop()} · ${insp.embedding.remote ? "API" : `${insp.embedding.layers} layers`} · ${insp.embedding.vector.length} dims` : "Qwen3-Embedding · 28 layers"} color={COLORS.local} big />
      <Label position={[TOWER.radius + 7, 5, 0]} title="tokens in" sub="the green one is pooled" color={COLORS.local} />
    </group>
  );
}

function LocalEngines({ run, insp, on }) {
  const c = run?.checks;
  const used = run?.sources.filter((s) => s.used) ?? [];
  const chars = used.reduce((a, s) => a + s.excerpt.length, 0);
  const terms = insp?.bm25.terms ?? [];
  return (
    <group>
      <Float speed={3} floatIntensity={0.4}>
        <mesh position={ANCHORS.lang} rotation-x={Math.PI / 2}><torusGeometry args={[2.2, 0.2, 8, 40]} /><meshBasicMaterial color={glow(COLORS.local, on.has("lang") ? 3 : 1.2)} toneMapped={false} /></mesh>
      </Float>
      <Label position={[ANCHORS.lang[0], 7, ANCHORS.lang[2]]} title="language · length" sub={run ? `${run.lang === "ar" ? "Arabic" : "English"} · ${run.question.length}/1000` : "≥ 50% Arabic letters → ar"} color={COLORS.local} />
      <Pylon position={[ANCHORS.bm25[0], 0, ANCHORS.bm25[2]]} size={[2.2, 14, 2.2]} color={COLORS.local} on={on.has("bm25")}>
        {terms.slice(0, 8).map((t, i) => (
          <Near key={t} position={[Math.cos(i * 1.3) * 4, 3 + i * 1.4, Math.sin(i * 1.3) * 4]} range={80}><TextSprite title={t} color={COLORS.local} height={1.1} pill /></Near>
        ))}
        <Label position={[0, 17, 0]} title="BM25" sub={insp ? `${insp.bm25.n_terms} terms · IDF-weighted` : "exact words"} color={COLORS.local} />
      </Pylon>
      <group position={[ANCHORS.budget[0], 0, ANCHORS.budget[2]]}>
        <mesh position={[0, 4, 0]}><boxGeometry args={[6, 8, 0.6]} /><meshBasicMaterial color="#0d0903" transparent opacity={0.6} /><Edges color={glow(COLORS.local, on.has("budget") ? 3 : 1.3)} /></mesh>
        <mesh position={[0, 0.3 + (8 * Math.min(1, chars / 8000)) / 2, 0.4]}><boxGeometry args={[5, Math.max(0.1, 8 * Math.min(1, chars / 8000)), 0.3]} /><meshBasicMaterial color={glow(COLORS.local, 2.2)} toneMapped={false} /></mesh>
        <Label position={[0, 10.5, 0]} title="context budget" sub={run ? `${chars.toLocaleString("en-US")} / 8,000 chars · ${used.length} chunks` : "8,000 characters"} color={COLORS.local} />
      </group>
      <group position={[ANCHORS.rules[0], 0, ANCHORS.rules[2]]}>
        {[["citations", c?.citations_ok], ["numbers", c?.numbers_ok], ["language", c?.lang_ok]].map(([k, ok], i) => (
          <Float key={k} speed={2 + i} floatIntensity={0.5}>
            <mesh position={[(i - 1) * 3.4, 4 + i * 0.4, 0]}>
              <torusGeometry args={[1.2, 0.22, 8, 32]} />
              <meshBasicMaterial color={glow(ok == null ? COLORS.local : ok ? COLORS.graph : COLORS.bad, on.has("rules") ? 3 : 1.4)} toneMapped={false} />
            </mesh>
          </Float>
        ))}
        <Label position={[0, 8.5, 0]} title="grounding rules" sub={c?.citations ? `cite ${c.citations_ok ? "✓" : "✗"} · numbers ${c.numbers_ok ? "✓" : "✗"} · lang ${c.lang_ok ? "✓" : "✗"}` : "plain code, no model"} color={COLORS.local} />
      </group>
    </group>
  );
}

function ArbiterOrb({ run, on }) {
  const sats = useRef();
  const probs = run && Object.keys(run.guard_probs).length ? run.guard_probs : { in_scope: 0.25, out_of_scope: 0.25, harmful: 0.25, prompt_injection: 0.25 };
  const risk = (probs.harmful || 0) + (probs.prompt_injection || 0);
  const top = Object.keys(probs).sort((a, b) => probs[b] - probs[a])[0];
  useFrame((_, dt) => { if (sats.current) sats.current.rotation.y += dt * (on ? 0.9 : 0.25); });
  return (
    <group position={ARBITER}>
      <mesh><icosahedronGeometry args={[4.4, 2]} /><meshLambertMaterial color="#0b0718" emissive={COLORS.cloud} emissiveIntensity={on ? 1.8 : 0.6} /></mesh>
      <mesh><icosahedronGeometry args={[6, 1]} /><meshBasicMaterial color={glow(COLORS.cloud, 1.6)} wireframe toneMapped={false} transparent opacity={0.5} /></mesh>
      <group ref={sats}>
        {Object.entries(probs).map(([k, p], i) => {
          const a = (i / 4) * Math.PI * 2;
          const col = k === top ? COLORS.graph : (k === "harmful" || k === "prompt_injection") && risk >= 0.4 ? COLORS.bad : COLORS.cloud;
          return (
            <group key={k} position={[Math.cos(a) * 11, Math.sin(a * 2) * 1.5, Math.sin(a) * 11]}>
              <mesh><sphereGeometry args={[0.5 + 3 * Math.sqrt(p), 20, 16]} /><meshBasicMaterial color={glow(col, 2.4)} toneMapped={false} /></mesh>
              <Near position={[0, 1.6 + 3 * Math.sqrt(p), 0]} range={150}><TextSprite title={p.toFixed(2)} sub={k.replaceAll("_", " ")} color={col} height={1.2} mono /></Near>
            </group>
          );
        })}
      </group>
      <Label position={[0, 12, 0]} title="Arbiter" sub={run ? `one forward pass · ${run.verdict}` : "scores 4 options, writes no text"} color={COLORS.cloud} big />
      <mesh position={[0, -ARBITER[1] / 2, 0]}><cylinderGeometry args={[0.15, 0.15, ARBITER[1], 6]} /><meshBasicMaterial color={glow(COLORS.cloud, 1.2)} toneMapped={false} transparent opacity={0.3} /></mesh>
    </group>
  );
}

function Colossus({ run, llm, on, stageId }) {
  const slabs = useRef();
  const cache = useRef();
  const u = run?.usage ?? {};
  const kv = Math.min(520, Math.max(60, Math.round((u.input_tokens ?? 1200) / 3)));
  const base = useMemo(() => new Color(COLORS.cloud), []);
  // The KV-cache spiral is written once; prefill "fills" it by raising the drawn instance count.
  const writeSpiral = (m) => {
    cache.current = m;
    if (!m) return;
    const o = new Object3D();
    for (let i = 0; i < kv; i++) {
      const a = i * 0.32, r = 14 + (i % 3) * 0.6;
      o.position.set(Math.cos(a) * r, 2 + (i / kv) * COLOSSUS.slabs * COLOSSUS.gap, Math.sin(a) * r);
      o.rotation.set(i, i * 0.5, 0);
      o.updateMatrix();
      m.setMatrixAt(i, o.matrix);
    }
    m.instanceMatrix.needsUpdate = true;
  };
  useFrame(({ clock }) => {
    const t = clock.elapsedTime;
    const sweep = stageId === "decode" ? (t * 18) % COLOSSUS.slabs : stageId === "reason" ? (t * 6) % COLOSSUS.slabs : -10;
    slabs.current?.children.forEach((m, i) => {
      const k = stageId === "prefill" ? 1.4 + Math.sin(t * 6 + i) * 0.4 : Math.abs(sweep - i) < 1 ? 2.6 : on ? 0.55 : 0.3;
      m.material.emissiveIntensity = k;
    });
    if (cache.current) {
      cache.current.count = stageId === "prefill" ? Math.max(1, Math.floor(kv * Math.min(1, (t * 0.5) % 1.2))) : kv;
      cache.current.rotation.y = t * 0.08;
    }
  });
  return (
    <group position={COLOSSUS.base}>
      <group ref={slabs}>
        {Array.from({ length: COLOSSUS.slabs }, (_, i) => (
          <mesh key={i} position={[0, 3 + i * COLOSSUS.gap, 0]}>
            <boxGeometry args={[18 - i * 0.35, 1.1, 18 - i * 0.35]} />
            <meshLambertMaterial color="#0a0614" emissive={base} emissiveIntensity={0.4} />
            <Edges color={glow(COLORS.cloud, 1.8)} />
          </mesh>
        ))}
      </group>
      <mesh position={[0, (COLOSSUS.slabs * COLOSSUS.gap) / 2 + 2, 0]}>
        <cylinderGeometry args={[1.6, 1.6, COLOSSUS.slabs * COLOSSUS.gap + 4, 16, 1, true]} />
        <meshBasicMaterial color={glow(COLORS.cloud, 2.6)} toneMapped={false} transparent opacity={0.45} />
      </mesh>
      <instancedMesh key={kv} ref={writeSpiral} args={[undefined, undefined, kv]}>
        <boxGeometry args={[0.45, 0.45, 0.45]} />
        <meshBasicMaterial color={glow(COLORS.cloud, 1.8)} toneMapped={false} />
      </instancedMesh>
      <Label position={[0, COLOSSUS.slabs * COLOSSUS.gap + 9, 0]} title={llm} big color={COLORS.cloud}
        sub={u.input_tokens ? `${u.input_tokens.toLocaleString("en-US")} tokens in · ${u.output_tokens.toLocaleString("en-US")} out${u.output_token_details?.reasoning != null ? ` · ${u.output_token_details.reasoning} reasoning` : ""}` : "prefill · reasoning · decode"} />
      <Label position={[17, 8, 0]} title="KV cache" sub={`${kv} cubes ≈ ${(u.input_tokens ?? 1200).toLocaleString("en-US")} cached tokens`} color={COLORS.cloud} />
      <Label position={[-14, COLOSSUS.slabs * COLOSSUS.gap - 4, 0]} title="layers" sub="depth not published · 12 drawn" color={COLORS.cloud} />
    </group>
  );
}

/** Tokens flying back from the model to your screen during the decode stage; idle otherwise. */
function TokenStream({ active }) {
  const mesh = useRef();
  const curve = useMemo(() => new CatmullRomCurve3(routePoints(["decode", "generate", "queue", "stream", "reader", "view"]).map((p) => new Vector3(...p))), []);
  const dummy = useMemo(() => new Object3D(), []);
  const N = 48;
  useFrame(({ clock }) => {
    const m = mesh.current;
    if (!m) return;
    m.visible = active;
    if (!active) return;
    for (let i = 0; i < N; i++) {
      curve.getPointAt((clock.elapsedTime * 0.12 + i / N) % 1, dummy.position);
      dummy.updateMatrix();
      m.setMatrixAt(i, dummy.matrix);
    }
    m.instanceMatrix.needsUpdate = true;
  });
  return (
    <instancedMesh ref={mesh} args={[undefined, undefined, N]} visible={false} frustumCulled={false}>
      <octahedronGeometry args={[0.45]} />
      <meshBasicMaterial color={glow(COLORS.graph, 3)} toneMapped={false} />
    </instancedMesh>
  );
}

export function World({ run, insp, galaxy, llm, stage, quality }) {
  const s = STAGES[stage];
  const on = useMemo(() => new Set(s.path), [s]);
  const has = (...ids) => ids.some((id) => on.has(id));
  return (
    <>
      <Environment quality={quality} />
      <Road />
      <BrowserTerminal run={run} insp={insp} stageId={s.id} on={has("ask", "fetch", "reader", "view")} />
      <ServerGate on={has("post", "thread", "queue", "stream")} />
      <GraphHall run={run} on={on} />
      <EmbeddingTower insp={insp} on={has("qwen")} />
      <LocalEngines run={run} insp={insp} on={on} />
      <Galaxy galaxy={galaxy} insp={insp} active={has("qdrant")} quality={quality} />
      <ArbiterOrb run={run} on={has("arbiter")} />
      <Colossus run={run} llm={llm} on={has("prefill", "decode")} stageId={s.id} />
      <TokenStream active={s.id === "decode"} />
      <Beam from={ANCHORS.guard} to={ARBITER} color={COLORS.cloud} lift={22} on={has("arbiter")} width={1.8} />
      <Beam from={ANCHORS.generate} to={ANCHORS.prefill} color={COLORS.cloud} lift={26} on={has("prefill")} width={1.8} />
      <Beam from={ANCHORS.retrieve} to={[TOWER.base[0], 2, TOWER.base[2]]} color={COLORS.local} lift={6} on={has("qwen")} />
      <Beam from={[TOWER.base[0], 2 + 29 * TOWER.ringGap, TOWER.base[2]]} to={ANCHORS.qdrant} color={COLORS.local} lift={10} on={has("qdrant", "bm25")} width={1.8} />
      <Beam from={ANCHORS.qdrant} to={ANCHORS.budget} color={COLORS.local} lift={8} on={has("budget")} />
      <Beam from={ANCHORS.check} to={ANCHORS.rules} color={COLORS.local} lift={4} on={has("rules")} />
      <Beam from={ANCHORS.post} to={ANCHORS.guard} color={COLORS.server} lift={6} on={has("thread")} />
    </>
  );
}
