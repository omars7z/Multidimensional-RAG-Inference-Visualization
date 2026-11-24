// One question's journey through five layers (browser, server, LangGraph, local engines, model APIs),
// drawn as a rotatable 3D stack. A scrubber walks the 16 stages; each shows the data at that point.
import { useEffect, useRef, useState } from "react";
import { Icon } from "../icons.jsx";

const fmt = (n) => Number(n || 0).toLocaleString("en-US");
const secs = (ms) => (ms == null ? "–" : ms >= 1000 ? `${(ms / 1000).toFixed(2)} s` : `${Math.round(ms)} ms`);
const clip = (s, n) => (s && s.length > n ? s.slice(0, n - 1) + "…" : s);
const DEG = Math.PI / 180;

const LAYERS = [
  { id: "browser", name: "Browser", where: "React · web/src" },
  { id: "server", name: "Web server", where: "Starlette · ui.py" },
  { id: "graph", name: "LangGraph", where: "app/graph.py" },
  { id: "local", name: "This machine", where: "local engines · no API" },
  { id: "cloud", name: "Model APIs", where: "remote · HTTPS" },
];
const LI = Object.fromEntries(LAYERS.map((l, i) => [l.id, i]));

// [layer, x, y, label]; the plane spans x -300..300, y -55..55.
const ITEMS = {
  ask: ["browser", -205, 0, "Ask box"], fetch: ["browser", -68, 0, "askStream()"],
  reader: ["browser", 72, 0, "NDJSON reader"], view: ["browser", 210, 0, "answer view"],
  post: ["server", -205, 0, "/api/ask/stream"], thread: ["server", -68, 0, "producer thread"],
  queue: ["server", 72, 0, "event queue"], stream: ["server", 210, 0, "streamed lines"],
  guard: ["graph", -230, 0, "guard"], route: ["graph", -122, 0, "route"], retrieve: ["graph", -14, 0, "retrieve"],
  generate: ["graph", 96, 0, "generate"], check: ["graph", 208, 0, "check"],
  lang: ["local", -232, 0, "lang · length"], qwen: ["local", -118, -24, "Qwen3 embed"], bm25: ["local", -118, 26, "BM25 terms"],
  qdrant: ["local", 0, 0, "Qdrant + RRF"], budget: ["local", 112, 0, "context budget"], rules: ["local", 228, 0, "grounding rules"],
  arbiter: ["cloud", -205, 0, "Arbiter"], prefill: ["cloud", 40, 0, "prefill"], decode: ["cloud", 175, 0, "decode loop"],
};
const W = 98, D = 34, H = 12, GAP = 118, PLANE_W = 300, PLANE_D = 55;
const VW = 780, VH = 600, CX = 390, CY = 300, FLAT_TOP = 62, FLAT_GAP = 112;

/** Stages in order; `path` is the item route the packet travels, `skip` marks stages a refusal never reaches. */
export const STAGES = [
  { id: "send", title: "You press Ask", path: ["ask", "fetch"], code: "web/src/App.jsx · submit()",
    body: "The question is trimmed and checked (1–1,000 characters). Any earlier request is aborted, and askStream() starts a streaming fetch." },
  { id: "post", title: "HTTP POST to the local server", path: ["fetch", "post"], code: "web/src/api.js · askStream()",
    body: "The question travels as JSON to 127.0.0.1:8001. The server checks the answer model is configured and replies with an NDJSON stream it keeps open." },
  { id: "thread", title: "A producer thread runs the graph", path: ["post", "thread", "guard"], code: "ui.py · api_ask_stream()",
    body: "One thread owns the whole run so the tracing context stays intact. It takes the index lock, opens a Langfuse trace (if enabled) and calls graph.stream() with stream_mode = updates + messages." },
  { id: "lang", title: "guard: language and length", path: ["guard", "lang"], code: "app/guardrails.py · question_lang()",
    body: "Arabic-script letters are counted: 50% or more means Arabic, otherwise English. That language picks the refusal text, the \"I don't know\" text and the answer language. Over 1,000 characters is refused right here." },
  { id: "arbiter", title: "Arbiter classifies the question", path: ["guard", "arbiter"], code: "app/models/arbiter.py · arbitrate()",
    body: "One HTTPS call: the question as state, plus a typed choice question with four described options. The model does one forward pass and returns a calibrated probability per option. It writes no text." },
  { id: "route", title: "route_after_guard picks the next edge", path: ["arbiter", "guard", "route"], code: "app/graph.py · route_after_guard()",
    body: "Risk = P(harmful) + P(prompt_injection). At 0.4 or more it refuses; if out_of_scope is the top class it declines; otherwise the edge goes to retrieve. The guard's step event is queued and the page lights up its first node." },
  { id: "embed", title: "The question becomes a 1,024-number vector", path: ["retrieve", "qwen"], skip: true, code: "app/retrieval.py · SentenceEmbeddings",
    body: "Qwen3-Embedding runs on this machine. An instruction prefix is added, the text is split into tokens, 28 transformer layers process them, and the hidden state of the last token becomes the vector, scaled to length 1." },
  { id: "bm25", title: "Keywords for BM25", path: ["qwen", "bm25"], skip: true, code: "app/retrieval.py · NormalizedSparse",
    body: "In parallel with meaning, exact words count too. Arabic is normalised (diacritics, tatweel, alef and yaa forms, digits), English is stemmed and stop words dropped. Each remaining term is one dimension of a sparse vector." },
  { id: "qdrant", title: "Hybrid search with rank fusion", path: ["bm25", "qdrant"], skip: true, code: "app/retrieval.py · search()",
    body: "Embedded Qdrant runs two searches over the on-disk index: cosine similarity on the dense vectors and IDF-weighted BM25 on the sparse ones, 20 candidates each. Reciprocal rank fusion adds 1 / (rank + 1) from each list; the top k survive." },
  { id: "budget", title: "Fit the context budget", path: ["qdrant", "budget", "retrieve"], skip: true, code: "app/prompts.py · select_context()",
    body: "In score order, duplicate texts are dropped and chunks are added until 8,000 characters. What fits is sent to the model; the rest is shown as \"over budget\". The retrieve step event goes to the page." },
  { id: "prompt", title: "The prompt is assembled", path: ["retrieve", "generate"], skip: true, code: "app/prompts.py · answer_messages()",
    body: "A system message with the answer-v1 rules (documents only, cite [doc_id#n], answer in the question's language, else \"I don't know\"), and a user message with each chunk inside <document id=…> tags, marked as untrusted data, then the question." },
  { id: "prefill", title: "Prefill: the model reads everything at once", path: ["generate", "prefill"], skip: true, code: "app/llm.py · get_llm()",
    body: "The Responses API request reaches GPT 6. Its tokenizer turns the prompt into tokens, and one parallel pass through every layer computes attention keys and values for all of them: the KV cache." },
  { id: "reason", title: "Hidden reasoning", path: ["prefill", "decode"], skip: true, code: "remote",
    body: "As a reasoning model it first generates private tokens: they are billed and counted, but never sent back. This is most of the wait before the first visible word." },
  { id: "decode", title: "Decode: one token at a time, streamed", path: ["decode", "generate", "queue", "stream", "reader"], skip: true, code: "app/graph.py · stream()",
    body: "Each step runs only the newest token through the layers, reusing the KV cache, turns the final state into a score per vocabulary entry, samples one, and appends it. Each piece arrives as a 'messages' event, becomes an NDJSON token line, and the page appends it to the draft." },
  { id: "check", title: "check: the output guard", path: ["generate", "check", "rules"], skip: true, code: "app/guardrails.py · check_answer()",
    body: "Plain code, no model. Every [doc_id#n] must be a chunk that was sent; every number must appear in the cited text; the answer's language must match. With no valid citation the draft is replaced by \"I don't know\"." },
  { id: "result", title: "The result is rendered", path: ["check", "queue", "stream", "reader", "view"], code: "web/src/components/Answer.jsx",
    body: "The final result event carries the answer, sources, checks, usage, timings and trace link. The trace gets its scores; the page swaps the draft for the checked answer with clickable citations." },
];

export function details(stage, run, insp) {
  const q = run?.question ?? insp?.question;
  const used = run?.sources.filter((s) => s.used) ?? [];
  const p = run?.guard_probs ?? {};
  const u = run?.usage ?? {};
  const t = run?.timings ?? {};
  const top = insp?.points.filter((x) => x.top_k) ?? [];
  switch (stage.id) {
    case "send": return [["question", q ? clip(q, 60) : "–"], ["length", q ? `${q.length} / 1000 chars` : "–"]];
    case "post": return [["request", "POST /api/ask/stream"], ["body", q ? `{"question": "${clip(q, 34)}"}` : "{question}"], ["response", "application/x-ndjson"]];
    case "thread": return [["stream modes", "updates · messages"], ["trace", run?.trace_url ? "Langfuse trace opened" : "only if LANGFUSE_ENABLED"], ["checkpointer", "none: nothing stored between runs"]];
    case "lang": return [["detected", run ? (run.lang === "ar" ? "Arabic" : "English") : "–"], ["length check", q ? (q.length <= 1000 ? "passed" : "too long") : "–"]];
    case "arbiter": return Object.keys(p).length
      ? Object.entries(p).map(([k, v]) => [k.replaceAll("_", " "), v.toFixed(3)]).concat([["time", secs(t.guard)]])
      : [["probabilities", "ask a question to see them"]];
    case "route": {
      if (!run) return [["verdict", "–"]];
      const risk = (p.harmful || 0) + (p.prompt_injection || 0);
      return [["risk", Object.keys(p).length ? `${risk.toFixed(3)} ${risk >= 0.4 ? "≥" : "<"} 0.4` : "–"], ["verdict", run.verdict], ["next", run.verdict === "in_scope" ? "retrieve" : "END (refusal)"]];
    }
    case "embed": return insp ? [["tokens", `${insp.embedding.tokens.length} (${insp.embedding.prompt_tokens} instruction + question + end)`],
      ["layers × width", `${insp.embedding.layers} × ${fmt(insp.embedding.hidden)}`], ["pooling", insp.embedding.pooling ?? "last token"],
      ["first numbers", insp.embedding.vector.slice(0, 4).map((v) => v.toFixed(3)).join(", ") + " …"], ["time", secs(insp.timings.embed_dense)]]
      : [["vector", "inspect a question to see it"]];
    case "bm25": return insp ? [["normalised", clip(insp.bm25.normalized, 48)], ["terms", insp.bm25.terms.join(" · ") || `${insp.bm25.n_terms} terms`], ["time", secs(insp.timings.embed_sparse)]]
      : [["terms", "inspect a question to see them"]];
    case "qdrant": return insp ? top.map((x) => [`#${x.fused_rank} ${x.chunk_id}`, `dense ${x.dense_rank ?? "–"} · bm25 ${x.sparse_rank ?? "–"} → ${x.fused_score.toFixed(3)}`])
      : run ? used.map((s) => [s.chunk_id, `score ${s.score.toFixed(3)}`]) : [["hits", "–"]];
    case "budget": return run ? [["retrieved", `${run.sources.length} chunks`], ["sent to model", `${used.length} · ${fmt(used.reduce((a, s) => a + s.excerpt.length, 0))} / 8,000 chars`], ["time", secs(t.retrieve)]]
      : [["budget", "8,000 characters"]];
    case "prompt": return [["prompt version", run?.config?.answer_prompt ?? "answer-v1"], ["answer language", run ? (run.lang === "ar" ? "Arabic" : "English") : "the question's"],
      ["documents", used.length ? used.map((s) => s.chunk_id).join(", ") : "–"]];
    case "prefill": return [["model", run?.config?.llm ?? "GPT 6"], ["input tokens", u.input_tokens ? fmt(u.input_tokens) : "–"],
      ["cached tokens", u.input_token_details?.cache_read != null ? fmt(u.input_token_details.cache_read) : "–"]];
    case "reason": return [["reasoning tokens", u.output_token_details?.reasoning != null ? fmt(u.output_token_details.reasoning) : "–"]];
    case "decode": return [["output tokens", u.output_tokens ? fmt(u.output_tokens) : "–"], ["visible answer", run ? `${fmt(run.answer.length)} chars` : "–"], ["generate step", secs(t.generate)]];
    case "check": {
      const c = run?.checks;
      if (!c?.citations) return [["checks", "–"]];
      return [["citations", `${c.citations.length} · ${c.citations_ok ? "valid" : "invalid"}`], ["numbers", c.numbers_ok ? "all found in sources" : `missing: ${c.unsupported_numbers.join(", ")}`],
        ["language", c.lang_ok ? "matches" : `answer is ${c.answer_lang}`], ["time", secs(t.check)]];
    }
    case "result": return [["total", secs(t.total)], ["cited", run ? `${run.sources.filter((s) => s.cited).length} of ${run.sources.length}` : "–"], ["trace", run?.trace_url ? "linked" : "off"]];
    default: return [];
  }
}

function makeProject(yaw, pitch, t) {
  const cy = Math.cos(yaw), sy = Math.sin(yaw), sp = Math.sin(pitch), cp = Math.cos(pitch);
  return (x, y, zLocal, li) => {
    const z = (2 - li) * GAP + zLocal;
    const x1 = x * cy - y * sy, y1 = x * sy + y * cy;
    const X3 = CX + x1, Y3 = CY + y1 * sp - z * cp;
    const X2 = CX + x * 1.08, Y2 = FLAT_TOP + li * FLAT_GAP + y * 0.62 - zLocal * 0.25;
    return [X3 + (X2 - X3) * t, Y3 + (Y2 - Y3) * t];
  };
}

const poly = (pts) => pts.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(" ");

function Block({ id, project, yaw, h, state }) {
  const [layer, x, y, label] = ITEMS[id];
  const li = LI[layer];
  const x0 = x - W / 2, x1 = x + W / 2, y0 = y - D / 2, y1 = y + D / 2;
  const P = (px, py, pz) => project(px, py, pz, li);
  const top = [P(x0, y0, h), P(x1, y0, h), P(x1, y1, h), P(x0, y1, h)];
  const front = [P(x0, y1, 0), P(x1, y1, 0), P(x1, y1, h), P(x0, y1, h)];
  const sx = Math.sin(yaw) > 0 ? x1 : x0;
  const side = [P(sx, y0, 0), P(sx, y1, 0), P(sx, y1, h), P(sx, y0, h)];
  const [tx, ty] = P(x, y, h);
  return (
    <g className={`jblock l-${layer} ${state}`}>
      {h > 0.5 && <><polygon className="side" points={poly(side)} /><polygon className="front" points={poly(front)} /></>}
      <polygon className="top" points={poly(top)} />
      <text x={tx} y={ty + 3.5} textAnchor="middle">{label}</text>
    </g>
  );
}

/** Point at fraction f along the route of item tops. */
function along(route, f) {
  if (route.length === 1) return route[0];
  const seg = route.slice(1).map((b, i) => Math.hypot(b[0] - route[i][0], b[1] - route[i][1]));
  let d = f * seg.reduce((a, b) => a + b, 0);
  for (let i = 0; i < seg.length; i++) {
    if (d <= seg[i] || i === seg.length - 1) {
      const r = seg[i] ? Math.min(1, d / seg[i]) : 1;
      return [route[i][0] + (route[i + 1][0] - route[i][0]) * r, route[i][1] + (route[i + 1][1] - route[i][1]) * r];
    }
    d -= seg[i];
  }
  return route.at(-1);
}

const reduced = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;

export function Journey3D({ run, insp }) {
  const [stage, setStage] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [view, setView] = useState({ yaw: -18, pitch: 27 });
  const [flat, setFlat] = useState(false);
  const [t, setT] = useState(0); // 0 = 3D, 1 = flat lanes
  const [packet, setPacket] = useState(1);
  const drag = useRef(null);
  const refused = run && run.verdict !== "in_scope";

  useEffect(() => { // ease between 3D and flat
    const target = flat ? 1 : 0;
    if (reduced()) { setT(target); return; }
    let raf, from = null;
    const step = (now) => {
      from ??= now;
      const k = Math.min(1, (now - from) / 500);
      setT((v) => v + (target - v) * (k < 1 ? 0.18 : 1));
      if (k < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [flat]);

  useEffect(() => { // packet travels the stage's route, on a loop
    if (reduced()) { setPacket(1); return; }
    let raf, start = null;
    const step = (now) => {
      start ??= now;
      setPacket(Math.min(1, ((now - start) % 1700) / 1100));
      raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [stage]);

  useEffect(() => {
    if (!playing) return;
    const id = setInterval(() => setStage((s) => {
      let next = s + 1;
      while (refused && STAGES[next]?.skip) next++;
      if (next >= STAGES.length) { setPlaying(false); return s; }
      return next;
    }), 2600);
    return () => clearInterval(id);
  }, [playing, refused]);

  const project = makeProject(view.yaw * DEG, view.pitch * DEG, t);
  const h = H * (1 - t);
  const s = STAGES[stage];
  const onPath = new Set(s.path);
  const route = s.path.map((id) => { const [layer, x, y] = ITEMS[id]; return project(x, y, h + 5, LI[layer]); });
  const [px, py] = along(route, packet);
  const activeLayers = new Set(s.path.map((id) => ITEMS[id][0]));
  const skipped = refused && s.skip;

  const onDown = (e) => { if (flat) return; drag.current = { x: e.clientX, y: e.clientY, ...view }; e.currentTarget.setPointerCapture(e.pointerId); };
  const onMove = (e) => {
    const d = drag.current;
    if (!d) return;
    setView({ yaw: Math.max(-60, Math.min(60, d.yaw + (e.clientX - d.x) * 0.35)), pitch: Math.max(8, Math.min(75, d.pitch - (e.clientY - d.y) * 0.25)) });
  };
  const onUp = () => { drag.current = null; };
  const go = (i) => { setPlaying(false); setStage(Math.max(0, Math.min(STAGES.length - 1, i))); };

  return (
    <div className="journey">
      <div className="jtools">
        <div className="seg" role="group" aria-label="View">
          <button type="button" aria-pressed={!flat} onClick={() => setFlat(false)}><Icon name="layers" />3D stack</button>
          <button type="button" aria-pressed={flat} onClick={() => setFlat(true)}><Icon name="route" />Flat lanes</button>
        </div>
        {!flat && <span className="hint">Drag to rotate · double-click to reset</span>}
      </div>
      <div className="jstage">
        <svg viewBox={`0 0 ${VW} ${VH}`} role="img" aria-label={`Stage ${stage + 1} of ${STAGES.length}: ${s.title}`}
          onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp}
          onDoubleClick={() => setView({ yaw: -18, pitch: 27 })} style={{ cursor: flat ? "default" : drag.current ? "grabbing" : "grab" }}>
          {[...LAYERS].reverse().map((layer) => { // lowest first, so higher planes paint over it
            const li = LI[layer.id];
            const P = (x, y) => project(x, y, 0, li);
            const corners = [P(-PLANE_W, -PLANE_D), P(PLANE_W, -PLANE_D), P(PLANE_W, PLANE_D), P(-PLANE_W, PLANE_D)];
            const ids = Object.keys(ITEMS).filter((id) => ITEMS[id][0] === layer.id);
            const dim = activeLayers.has(layer.id) ? "" : " dim";
            return (
              <g key={layer.id} className={`jlayer l-${layer.id}${dim}`}>
                <polygon className="plane" points={poly(corners)} />
                {ids.map((id) => (
                  <Block key={id} id={id} project={project} yaw={view.yaw * DEG} h={h}
                    state={onPath.has(id) ? (skipped ? "skip" : "on") : refused && STAGES.every((st) => !st.path.includes(id) || st.skip) ? "never" : ""} />
                ))}
              </g>
            );
          })}
          {LAYERS.map((layer, li) => { // labels last so no plane covers them: below the plane's lower-left corner
            const corners = [[-PLANE_W, -PLANE_D], [PLANE_W, -PLANE_D], [PLANE_W, PLANE_D], [-PLANE_W, PLANE_D]].map(([x, y]) => project(x, y, 0, li));
            const [lx, ly] = corners.reduce((a, c) => (c[1] - c[0] > a[1] - a[0] ? c : a));
            return (
              <text key={layer.id} x={Math.max(8, lx)} y={ly + 16} className={`jlabel l-${layer.id}`}>
                <tspan className="n">{layer.name}</tspan><tspan dx="8" className="w">{layer.where}</tspan>
              </text>
            );
          })}
          {!skipped && <>
            <polyline className="jroute" points={poly(route)} />
            <circle className="jpacket-glow" cx={px} cy={py} r="11" />
            <circle className="jpacket" cx={px} cy={py} r="5" />
          </>}
        </svg>
      </div>

      <div className="jcontrols">
        <button type="button" className="iconbtn" onClick={() => go(stage - 1)} disabled={stage === 0} aria-label="Previous stage"><Icon name="chevron-left" /></button>
        <button type="button" className="go" onClick={() => { if (stage === STAGES.length - 1) setStage(0); setPlaying(!playing); }}>
          <Icon name={playing ? "pause" : "play"} /><span>{playing ? "Pause" : stage === STAGES.length - 1 ? "Replay" : "Play"}</span>
        </button>
        <button type="button" className="iconbtn" onClick={() => go(stage + 1)} disabled={stage === STAGES.length - 1} aria-label="Next stage"><Icon name="chevron" /></button>
        <input type="range" min="0" max={STAGES.length - 1} value={stage} onChange={(e) => go(Number(e.target.value))} aria-label="Stage" />
        <span className="jcount">{stage + 1} / {STAGES.length}</span>
      </div>
      <ol className="jticks" aria-hidden="true">
        {STAGES.map((st, i) => (
          <li key={st.id} className={`${i === stage ? "cur" : i < stage ? "past" : ""} l-${ITEMS[st.path.at(-1)][0]}${refused && st.skip ? " skip" : ""}`}>
            <button type="button" tabIndex={-1} onClick={() => go(i)} title={st.title} />
          </li>
        ))}
      </ol>

      <div className={`jdetail l-${ITEMS[s.path.at(-1)][0]}`}>
        <div className="jhead">
          <span className="jnum">{stage + 1}</span>
          <div>
            <h4>{s.title}</h4>
            <div className="jlayers">{[...activeLayers].map((l) => <span key={l} className={`jchip l-${l}`}>{LAYERS[LI[l]].name}</span>)}<code>{s.code}</code></div>
          </div>
        </div>
        <p>{s.body}</p>
        {skipped
          ? <div className="note"><Icon name="info" />Your last question was refused at the guard, so this stage did not run.</div>
          : <dl className="jdata">{details(s, run, insp).map(([k, v]) => <div key={k}><dt>{k}</dt><dd dir="auto">{v}</dd></div>)}</dl>}
      </div>
    </div>
  );
}
