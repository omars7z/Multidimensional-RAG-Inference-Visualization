// "Enter the system": a full-screen 3D world you move through in third person. The districts are the real parts
// of the pipeline, the galaxy is every chunk in the index, and a packet flies each of the 16 stages.
import { Canvas } from "@react-three/fiber";
import { Bloom, EffectComposer, ToneMapping, Vignette } from "@react-three/postprocessing";
import { ToneMappingMode } from "postprocessing";
import { Component, Suspense, useEffect, useRef, useState } from "react";
import { Vector3 } from "three";
import { inspect } from "../api.js";
import { STAGES, details } from "../components/Journey3D.jsx";
import { Icon } from "../icons.jsx";
import { Packet, Player } from "./Actors.jsx";
import { COLORS, GALAXY, START, STATIONS } from "./layout.js";
import { World } from "./World.jsx";
import "./space.css";

const EXAMPLE_QUESTION = "What is retrieval-augmented generation?";
const LAYER_NAMES = { browser: "Browser", server: "Web server", graph: "LangGraph", local: "This machine", cloud: "Model APIs" };
const ANCHOR_LAYER = { ask: "browser", fetch: "browser", reader: "browser", view: "browser", post: "server", thread: "server", queue: "server", stream: "server",
  guard: "graph", route: "graph", retrieve: "graph", generate: "graph", check: "graph", lang: "local", qwen: "local", bm25: "local", qdrant: "local",
  budget: "local", rules: "local", arbiter: "cloud", prefill: "cloud", decode: "cloud" };
const fmt = (n) => Number(n || 0).toLocaleString("en-US");

class Boundary extends Component {
  state = { error: null };
  static getDerivedStateFromError(error) { return { error }; }
  render() {
    if (!this.state.error) return this.props.children;
    return <div className="sp-fail"><Icon name="alert" />The 3D view could not start ({this.state.error.message}). It needs WebGL 2 and hardware acceleration.</div>;
  }
}

function stationData(id, run, insp, galaxy) {
  const u = run?.usage ?? {};
  switch (id) {
    case "browser": return [["question", run?.question ?? insp?.question ?? "–"], ["end to end", run?.client?.total ? `${fmt(Math.round(run.client.total))} ms` : "–"], ["first visible token", run?.client?.ttft ? `${fmt(Math.round(run.client.ttft))} ms` : "–"]];
    case "server": return [["endpoint", "POST /api/ask/stream"], ["format", "NDJSON: step · token · result"]];
    case "graph": return run ? [["verdict", run.verdict], ...["guard", "retrieve", "generate", "check"].filter((n) => run.timings[n] != null).map((n) => [n, `${fmt(Math.round(run.timings[n]))} ms`])] : [["verdict", "ask a question first"]];
    case "tower": return insp ? [["tokens", insp.embedding.tokens.length], ["layers × width", `${insp.embedding.layers} × ${fmt(insp.embedding.hidden)}`], ["pooling", insp.embedding.pooling ?? "last token"],
      ["end token at last layer", insp.embedding.layer_similarity.at(-1).at(-1).toFixed(3)]] : [];
    case "galaxy": return [["chunks in the index", galaxy ? fmt(galaxy.count) : "–"], ...(insp?.points.filter((p) => p.top_k).map((p) => [`#${p.fused_rank} ${p.chunk_id}`, `cosine ${p.cosine.toFixed(3)}`]) ?? [])];
    case "arbiter": return run && Object.keys(run.guard_probs).length ? Object.entries(run.guard_probs).map(([k, v]) => [k.replaceAll("_", " "), v.toFixed(3)]) : [["probabilities", "ask a question first"]];
    case "colossus": return [["input tokens", u.input_tokens ? fmt(u.input_tokens) : "–"], ["output tokens", u.output_tokens ? fmt(u.output_tokens) : "–"], ["reasoning tokens", u.output_token_details?.reasoning != null ? fmt(u.output_token_details.reasoning) : "–"]];
    default: return [];
  }
}

// Minimap frame: x from -165 to 130, z from -125 to 175.
const MX = (x) => ((x + 165) / 295) * 180 + 10, MZ = (z) => ((z + 125) / 300) * 180 + 10;

function Minimap({ bus, onGo }) {
  const [, setTick] = useState(0);
  useEffect(() => { const id = setInterval(() => setTick((t) => t + 1), 120); return () => clearInterval(id); }, []);
  const a = bus.avatar, p = bus.packet;
  return (
    <svg className="sp-map" viewBox="0 0 200 200" onClick={(e) => {
      const r = e.currentTarget.getBoundingClientRect();
      const x = ((e.clientX - r.left) / r.width * 200 - 10) / 180 * 295 - 165, z = ((e.clientY - r.top) / r.height * 200 - 10) / 180 * 300 - 125;
      onGo([x, 6, z]);
    }}>
      <rect x="1" y="1" width="198" height="198" rx="14" className="frame" />
      <line x1={MX(0)} y1={MZ(150)} x2={MX(0)} y2={MZ(-40)} className="road" />
      <circle cx={MX(GALAXY.center[0])} cy={MZ(GALAXY.center[2])} r={(GALAXY.radius / 295) * 180} className="gal" />
      {STATIONS.map((s) => <circle key={s.id} cx={MX(s.at[0])} cy={MZ(s.at[2])} r="4" fill={COLORS[s.layer]} className="st" />)}
      <circle cx={MX(p.x)} cy={MZ(p.z)} r="2.6" className="pk" />
      <g transform={`translate(${MX(a.x)} ${MZ(a.z)}) rotate(${(-bus.yaw * 180) / Math.PI})`}>
        <path d="M0 -7 L5 5 L0 2 L-5 5 Z" className="me" />
      </g>
      <text x="100" y="194" textAnchor="middle">click to fly · {Math.round(a.y)} m up · {bus.fps ?? "–"} fps</text>
    </svg>
  );
}

function Nearby({ bus, run, insp, galaxy }) {
  const [near, setNear] = useState(null);
  useEffect(() => {
    const id = setInterval(() => {
      const a = bus.avatar;
      let best = null;
      for (const s of STATIONS) {
        const c = s.fly ?? [s.at[0], a.y, s.at[2]];
        const d = Math.hypot(a.x - c[0], (a.y - c[1]) * 0.5, a.z - c[2]);
        if (d < s.radius * 1.4 && (!best || d < best.d)) best = { s, d };
      }
      setNear((cur) => (cur?.id === best?.s.id ? cur : best?.s ?? null));
    }, 200);
    return () => clearInterval(id);
  }, [bus]);
  if (!near) return null;
  return (
    <div className="sp-near sp-glass" style={{ "--c": COLORS[near.layer] }}>
      <div className="sp-k">You are at</div>
      <h3>{near.name}</h3>
      <p>{near.info}</p>
      <dl>{stationData(near.id, run, insp, galaxy).map(([k, v]) => <div key={k}><dt>{k}</dt><dd dir="auto">{v}</dd></div>)}</dl>
    </div>
  );
}

export default function Space({ lastRun, llm, onExit }) {
  const [galaxy, setGalaxy] = useState(null);
  const [insp, setInsp] = useState(null);
  const [error, setError] = useState(null);
  const [stage, setStage] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [ride, setRide] = useState(false);
  const [quality, setQuality] = useState("smooth"); // smooth: 1x pixels, half-res bloom; sharp: up to 1.5x
  const [help, setHelp] = useState(true);
  const bus = useRef({ avatar: new Vector3(...START.position), packet: new Vector3(), yaw: START.yaw, pitch: 0.32, dist: 17, keys: {}, ride: false, flight: null }).current;
  const refused = lastRun && lastRun.verdict !== "in_scope";

  useEffect(() => {
    fetch("/api/galaxy").then((r) => (r.ok ? r.json() : Promise.reject(new Error(`galaxy ${r.status}`)))).then(setGalaxy).catch((e) => setError(e.message));
    inspect(lastRun?.question ?? EXAMPLE_QUESTION).then(setInsp).catch((e) => setError(e.message));
  }, [lastRun]);

  useEffect(() => { bus.ride = ride; }, [bus, ride]);
  useEffect(() => { bus.onManual = () => setRide(false); }, [bus]);
  useEffect(() => {
    const esc = (e) => { if (e.key === "Escape") onExit(); if (e.key === "h" || e.key === "H") setHelp((v) => !v); };
    window.addEventListener("keydown", esc);
    document.body.classList.add("sp-lock");
    return () => { window.removeEventListener("keydown", esc); document.body.classList.remove("sp-lock"); };
  }, [onExit]);
  // Playing moves on when the packet finishes its flights for the stage, not on a fixed timer.
  const playingRef = useRef(false);
  useEffect(() => { playingRef.current = playing; }, [playing]);
  const advance = () => setStage((s) => {
    let n = s + 1;
    while (refused && STAGES[n]?.skip) n++;
    if (n >= STAGES.length) { setPlaying(false); return s; }
    return n;
  });
  const onPacketDone = () => { if (playingRef.current) advance(); };
  // Stages a refusal skipped have no packet, so they move on by themselves while playing.
  useEffect(() => { if (playing && refused && STAGES[stage].skip) advance(); }, [playing, stage, refused]); // eslint-disable-line react-hooks/exhaustive-deps

  const fly = (to, yaw = 0) => {
    bus.ride = false; setRide(false);
    const from = bus.avatar.clone(), dest = new Vector3(...to);
    const d = from.distanceTo(dest);
    bus.flight = { from, to: dest, t: 0, dur: Math.max(1.2, Math.min(3.6, d / 70)), lift: Math.min(45, d * 0.22) };
    bus.yaw = bus.yawT = yaw;
  };
  const goStation = (s) => { const c = s.fly ?? [s.at[0], 4, s.at[2]]; fly([c[0], c[1] + 3, c[2] + s.radius * 0.8]); };
  const go = (i) => { setPlaying(false); setStage(Math.max(0, Math.min(STAGES.length - 1, i))); };
  const s = STAGES[stage];
  const last = ANCHOR_LAYER[s.path.at(-1)];

  return (
    <div className="space">
      <Boundary>
        <Canvas camera={{ fov: 62, near: 0.5, far: 1600, position: [0, 8, 178] }} dpr={quality === "sharp" ? Math.min(1.5, window.devicePixelRatio || 1) : 1}
          gl={{ antialias: false, stencil: false, powerPreference: "high-performance" }}>
          <Suspense fallback={null}>
            <World run={lastRun} insp={insp} galaxy={galaxy} llm={llm} stage={stage} quality={quality} />
            <Packet stage={stage} bus={bus} hidden={refused && s.skip} onDone={onPacketDone} />
            <Player bus={bus} />
          </Suspense>
          <EffectComposer multisampling={0} enableNormalPass={false}>
            <Bloom mipmapBlur intensity={1.15} luminanceThreshold={0.22} luminanceSmoothing={0.25} radius={0.72}
              levels={quality === "sharp" ? 6 : 5} resolutionScale={quality === "sharp" ? 0.75 : 0.5} />
            <Vignette offset={0.22} darkness={0.82} />
            <ToneMapping mode={ToneMappingMode.ACES_FILMIC} />
          </EffectComposer>
        </Canvas>
      </Boundary>

      <div className="sp-top sp-glass">
        <button type="button" className="sp-btn" onClick={onExit} title="Leave (Esc)"><Icon name="chevron-left" />Exit</button>
        <div className="sp-brand"><b>Inside the system</b><span>third-person · live data from this machine</span></div>
      </div>

      <div className="sp-stage sp-glass" style={{ "--c": COLORS[last] }}>
        <div className="sp-stage-head">
          <span className="sp-num">{String(stage + 1).padStart(2, "0")}</span>
          <div><div className="sp-k">{LAYER_NAMES[last]} · stage {stage + 1} of {STAGES.length}</div><h3>{s.title}</h3></div>
        </div>
        <p>{s.body}</p>
        {refused && s.skip
          ? <div className="sp-note">Your last question was refused at the guard, so this stage did not run.</div>
          : <dl>{details(s, lastRun, insp).slice(0, 5).map(([k, v]) => <div key={k}><dt>{k}</dt><dd dir="auto">{v}</dd></div>)}</dl>}
        <code>{s.code}</code>
        <div className="sp-ctrl">
          <button type="button" className="sp-btn" onClick={() => go(stage - 1)} disabled={stage === 0} aria-label="Previous stage"><Icon name="chevron-left" /></button>
          <button type="button" className="sp-btn primary" onClick={() => {
            if (playing) { setPlaying(false); return; }
            setPlaying(true); setRide(true);
            if (stage === STAGES.length - 1 && bus.packetDone) setStage(0); // replay from the start
            else if (bus.packetDone) advance(); // this stage already finished its flights
          }}>
            <Icon name={playing ? "pause" : "play"} />{playing ? "Pause" : "Play journey"}
          </button>
          <button type="button" className="sp-btn" onClick={() => go(stage + 1)} disabled={stage === STAGES.length - 1} aria-label="Next stage"><Icon name="chevron" /></button>
          <button type="button" className={`sp-btn${ride ? " on" : ""}`} aria-pressed={ride} onClick={() => setRide(!ride)} title="Follow the packet">Ride along</button>
        </div>
        <div className="sp-ticks">{STAGES.map((st, i) => (
          <button key={st.id} type="button" title={st.title} onClick={() => go(i)} style={{ "--c": COLORS[ANCHOR_LAYER[st.path.at(-1)]] }}
            className={`${i === stage ? "cur" : i < stage ? "past" : ""}${refused && st.skip ? " skip" : ""}`} />
        ))}</div>
      </div>

      <div className="sp-places sp-glass">
        <div className="sp-k">Fly to</div>
        {STATIONS.map((st) => (
          <button key={st.id} type="button" className="sp-place" style={{ "--c": COLORS[st.layer] }} onClick={() => goStation(st)}><i />{st.name}</button>
        ))}
        <button type="button" className="sp-place" onClick={() => fly(START.position)}><i />Start</button>
        <div className="sp-k" style={{ marginTop: 10 }}>Quality</div>
        <div className="sp-seg">
          {["smooth", "sharp"].map((q) => <button key={q} type="button" aria-pressed={quality === q} onClick={() => setQuality(q)}>{q}</button>)}
        </div>
      </div>

      <Nearby bus={bus} run={lastRun} insp={insp} galaxy={galaxy} />
      <Minimap bus={bus} onGo={(to) => fly(to, bus.yaw)} />

      {help && (
        <div className="sp-help sp-glass">
          <div><kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd> move</div>
          <div><kbd>Space</kbd>/<kbd>E</kbd> up · <kbd>Q</kbd> down</div>
          <div><kbd>Shift</kbd> boost · drag to look · scroll to zoom</div>
          <div><kbd>H</kbd> hide help · <kbd>Esc</kbd> exit</div>
          {!lastRun && <div className="sp-warn">Ask a question on the assistant page first to light the world with your own run.</div>}
          {error && <div className="sp-warn">{error}. Is python ui.py running?</div>}
        </div>
      )}
      {!galaxy && !error && <div className="sp-loading sp-glass">Mapping every chunk in the index…</div>}
    </div>
  );
}
