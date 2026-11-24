// How a remote generative model produces the answer: prefill, hidden reasoning, then decode one token at a time.
// Token counts come from the last run; GPT 6's tokenizer, layers and logits are not exposed, so token
// boundaries, candidate scores and attention weights here are simulated and labelled as such.
import { useEffect, useMemo, useState } from "react";
import { Icon } from "../icons.jsx";

const fmt = (n) => Number(n || 0).toLocaleString("en-US");
const EXAMPLE_ANSWER = "Retrieval-augmented generation (RAG) lets a language model answer from your own documents: it first retrieves the most relevant passages, then adds them to the prompt [url-d02f7c3f24#0]. The model writes its answer from those passages instead of only its training data [url-d02f7c3f24#5].";
const MAX_TOKENS = 160, PREFILL = 22, REASON = 22, STEPS = 16, LAYERS = 12;
const SPEEDS = { "1×": 34, "4×": 9, "16×": 2 };

/** Rough BPE-like split: words over 7 letters are cut into pieces, punctuation stands alone. */
function pieces(text) {
  const out = [];
  for (const [m] of text.matchAll(/\s*[\p{L}\p{M}\p{N}]+|\s*[^\s\p{L}\p{M}\p{N}]|\s+/gu)) {
    let w = m;
    while (w.trim().length > 7) {
      const cut = w.length - w.trimStart().length + 5;
      out.push(w.slice(0, cut));
      w = w.slice(cut);
    }
    out.push(w);
  }
  return out;
}

const rand = (n) => { const x = Math.sin(n * 12.9898 + 78.233) * 43758.5453; return x - Math.floor(x); };
const show = (t) => (t.trim() ? t.trim() : "·");

function candidates(tokens, i) {
  const pool = [...new Set(tokens)].filter((t) => t !== tokens[i]);
  const alts = [];
  for (let k = 0; alts.length < Math.min(4, pool.length); k++) {
    const t = pool[Math.floor(rand(i * 31 + k) * pool.length)];
    if (!alts.includes(t)) alts.push(t);
  }
  const top = 0.42 + 0.53 * rand(i + 0.5);
  const rest = [0.5, 0.25, 0.15, 0.1].map((f) => f * (1 - top));
  const list = [{ t: tokens[i], p: top, chosen: true }, ...alts.map((t, k) => ({ t, p: rest[k] }))];
  if (rand(i * 3.3) < 0.12 && list.length > 1) [list[0].p, list[1].p] = [list[1].p, list[0].p]; // sampling sometimes picks #2
  return list.sort((a, b) => b.p - a.p);
}

export function TokenLoop({ run }) {
  const real = run && run.verdict === "in_scope" && run.answer;
  const answer = real ? run.answer : EXAMPLE_ANSWER;
  const tokens = useMemo(() => pieces(answer).slice(0, MAX_TOKENS), [answer]);
  const usage = run?.usage?.input_tokens ? run.usage : null;
  const reasoning = usage?.output_token_details?.reasoning ?? null;
  const [tick, setTick] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState("1×");
  const end = PREFILL + REASON + tokens.length * STEPS;

  useEffect(() => { setTick(0); setPlaying(false); }, [answer]);
  useEffect(() => {
    if (!playing) return;
    const id = setInterval(() => setTick((t) => { if (t + 1 >= end) { setPlaying(false); return end; } return t + 1; }), SPEEDS[speed]);
    return () => clearInterval(id);
  }, [playing, speed, end]);

  const phase = tick < PREFILL ? "prefill" : tick < PREFILL + REASON ? "reason" : tick >= end ? "done" : "decode";
  const d = Math.max(0, tick - PREFILL - REASON);
  const idx = Math.min(tokens.length - 1, Math.floor(d / STEPS));
  const sub = phase === "decode" ? d % STEPS : phase === "done" ? STEPS - 1 : -1;
  const emitted = phase === "done" ? tokens.length : phase === "decode" ? idx + (sub >= 14 ? 1 : 0) : 0;
  const cands = useMemo(() => candidates(tokens, idx), [tokens, idx]);

  // Context window: input split by characters (estimate), reasoning and output counts real when the run has them.
  const used = run?.sources.filter((s) => s.used) ?? [];
  const docChars = used.reduce((a, s) => a + s.excerpt.length, 0) || 4000;
  const qChars = (run?.question ?? "What is retrieval-augmented generation?").length;
  const sysChars = 900;
  const input = usage?.input_tokens ?? Math.round((sysChars + docChars + qChars) / 4);
  const share = (c) => Math.round((input * c) / (sysChars + docChars + qChars));
  const reasonTok = reasoning ?? 0;
  const outTok = usage ? usage.output_tokens - reasonTok : tokens.length;
  const segs = [
    ["system", share(sysChars), "sys"], ["documents", share(docChars), "doc"], ["question", Math.max(1, share(qChars)), "q"],
    ["reasoning", reasonTok, "rea"], ["answer", outTok, "ans"],
  ];
  const total = segs.reduce((a, s) => a + s[1], 0) || 1;
  const fill = phase === "prefill" ? (tick + 1) / PREFILL : 1;
  const reasonFill = phase === "prefill" ? 0 : phase === "reason" ? (tick - PREFILL + 1) / REASON : 1;
  const ansFill = tokens.length ? emitted / tokens.length : 0;
  const cacheNow = Math.round(input * fill) + Math.round(reasonTok * reasonFill) + Math.round(outTok * ansFill);

  const fed = phase === "decode" || phase === "done" ? (idx === 0 ? "<start>" : show(tokens[idx - 1])) : phase === "reason" ? "hidden" : "all input";
  const layerLit = phase === "prefill" ? LAYERS : phase === "reason" ? (tick % LAYERS) + 1 : sub < 1 ? 0 : Math.min(LAYERS, sub - 0);
  const showLogits = phase === "done" || (phase === "decode" && sub >= 11);
  const recent = tokens.slice(Math.max(0, emitted - 9), emitted);
  const rtl = run?.lang === "ar";
  const W = 760;

  let x = 10;
  return (
    <div className="tloop">
      <div className="jtools">
        <button type="button" className="go" onClick={() => { if (tick >= end) setTick(0); setPlaying(!playing); }}>
          <Icon name={playing ? "pause" : "play"} /><span>{playing ? "Pause" : tick >= end ? "Replay" : tick ? "Resume" : "Generate"}</span>
        </button>
        <div className="seg" role="group" aria-label="Speed">
          {Object.keys(SPEEDS).map((s) => <button key={s} type="button" aria-pressed={speed === s} onClick={() => setSpeed(s)}>{s}</button>)}
        </div>
        <button type="button" className="iconbtn" onClick={() => { setPlaying(false); setTick(end); }}>Skip to end</button>
        <span className={`badge ${phase === "prefill" ? "b-info" : phase === "reason" ? "b-warn" : "b-ok"}`}>
          {phase === "prefill" ? "prefill" : phase === "reason" ? "hidden reasoning" : phase === "done" ? "done" : `decode · token ${idx + 1} of ${tokens.length}`}
        </span>
      </div>
      <svg className="viz" viewBox="0 0 780 318" role="img" aria-label="Context window, layers, next-token scores and attention for the token being generated">
        <defs>
          <marker id="tl-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto"><path d="M1 1L9 5L1 9z" style={{ fill: "var(--faint)" }} /></marker>
        </defs>
        <text x="10" y="12" className="k">context window / KV cache · {fmt(cacheNow)} tokens held</text>
        {segs.map(([name, n, cls]) => {
          const w = Math.max(n ? 3 : 0, (n / total) * W);
          const f = cls === "rea" ? reasonFill : cls === "ans" ? ansFill : fill;
          const g = (
            <g key={name}>
              <rect x={x} y="20" width={w} height="20" rx="3" className="cw" />
              <rect x={x} y="20" width={w * f} height="20" rx="3" className={`cw ${cls}`} />
              {w > 56 && <text x={x + 5} y="54" className="s">{name} {usage || cls === "ans" ? "" : "≈"}{fmt(n)}</text>}
            </g>
          );
          x += w;
          return g;
        })}

        <rect x="10" y="82" width="104" height="62" rx="10" className="box" />
        <text x="62" y="102" textAnchor="middle" className="k">token in</text>
        <text x="62" y="124" textAnchor="middle" className="t" dir="auto">{fed.length > 12 ? fed.slice(0, 11) + "…" : fed}</text>
        <path d="M116 113 H146" className="arrow" markerEnd="url(#tl-arrow)" />
        <rect x="150" y="82" width="74" height="62" rx="10" className={`box${layerLit ? " info" : ""}`} />
        <text x="187" y="108" textAnchor="middle" className="t">embed</text>
        <text x="187" y="124" textAnchor="middle" className="s">row lookup</text>
        <path d="M226 113 H246" className="arrow" markerEnd="url(#tl-arrow)" />
        {Array.from({ length: LAYERS }, (_, i) => (
          <g key={i}>
            <rect x={252 + i * 20} y="78" width="15" height="70" rx="3" className={`tlayer${i < layerLit ? " lit" : ""}`} />
            {i < layerLit && phase === "decode" && <rect x={252 + i * 20} y="78" width="15" height="12" rx="3" className="tattn" />}
          </g>
        ))}
        <text x="252" y="164" className="s">transformer layers · attention reads the KV cache, then an MLP</text>
        <text x="252" y="178" className="s">({phase === "prefill" ? "all input tokens at once, in parallel" : "only the newest token runs"}; real depth isn't published)</text>
        <path d="M494 113 H514" className="arrow" markerEnd="url(#tl-arrow)" />
        <text x="520" y="82" className="k">next-token scores (softmax) · simulated</text>
        {showLogits ? cands.map((c, k) => (
          <g key={k} className={c.chosen && (sub >= 14 || phase === "done") ? "picked" : ""}>
            <text x="520" y={100 + k * 17} className="s tokname" dir="auto">{show(c.t).slice(0, 12)}</text>
            <rect x="610" y={92 + k * 17} width="130" height="9" rx="4" className="bar" />
            <rect x="610" y={92 + k * 17} width={Math.max(2, c.p * 130)} height="9" rx="4" className={`bar ${c.chosen ? "top" : ""}`} />
            <text x="746" y={100 + k * 17} className="s">{c.p.toFixed(2)}</text>
          </g>
        )) : <text x="520" y="112" className="s">{phase === "prefill" ? "no output yet: building the cache" : phase === "reason" ? `writing private reasoning${reasoning != null ? ` (${fmt(reasoning)} tokens)` : ""}` : "running layers…"}</text>}

        <text x="10" y="210" className="k">newest tokens · lines = attention from the token fed in to earlier ones (simulated weights)</text>
        {recent.map((t, k) => {
          const n = recent.length;
          const pos = rtl ? n - 1 - k : k;
          const bx = 10 + pos * 84;
          const isNew = k === n - 1;
          const wgt = 0.15 + 0.85 * rand(idx * 17 + k);
          const nx = 10 + (rtl ? 0 : (n - 1)) * 84 + 39;
          return (
            <g key={`${emitted}-${k}`}>
              {!isNew && <path d={`M${nx} 248 Q ${(nx + bx + 39) / 2} ${Math.max(180, 240 - Math.abs(nx - bx - 39) * 0.11)} ${bx + 39} 248`} className="tarc" style={{ strokeWidth: 0.6 + 3 * wgt, opacity: 0.25 + 0.75 * wgt }} />}
              <rect x={bx} y="250" width="78" height="28" rx="7" className={`box${isNew ? " accent" : ""}`} />
              <text x={bx + 39} y="268" textAnchor="middle" className="t" dir="auto">{show(t).slice(0, 10)}</text>
            </g>
          );
        })}
        {!recent.length && <text x="10" y="268" className="s">nothing visible yet: the first answer token comes after reasoning</text>}
        <text x="10" y="306" className="s">Each token then goes back up the stack: messages event → NDJSON line → the page's draft</text>
      </svg>
      <div className={`tstream${real ? "" : " example"}`} dir="auto">
        {tokens.slice(0, emitted).join("")}{phase !== "done" && <span className="caret" />}
        {phase === "done" && tokens.length < pieces(answer).length && <span className="cap"> …{pieces(answer).length - tokens.length} more pieces</span>}
      </div>
      <p className="cap">
        {real ? "Your last answer, replayed." : "Example answer: ask a question to replay your own."}{" "}
        {usage ? `Real counts: ${fmt(usage.input_tokens)} input, ${fmt(usage.output_tokens)} output${reasoning != null ? ` (${fmt(reasoning)} of them reasoning)` : ""}.` : "Counts are estimates until you ask a question."}{" "}
        The model's tokenizer, layer count and scores are not exposed, so the pieces, candidates and attention lines are illustrative.
      </p>
    </div>
  );
}
