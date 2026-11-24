// Real retrieval internals from /api/inspect: the embedding model's tokens, its layers, the query vector,
// BM25 terms, a 2D map of the candidate chunks and how reciprocal rank fusion ordered them.
import { useEffect, useState } from "react";
import { Icon } from "../icons.jsx";

const fmt = (n) => Number(n || 0).toLocaleString("en-US");
const clip = (s, n) => (s && s.length > n ? s.slice(0, n - 1) + "…" : s);
const show = (text) => text.replace(/\n/g, "↵").replace(/^ /, "·");

/** Tokens × layers, real values: how close each token's hidden state at each layer is to the final query vector. */
function LayerGrid({ emb }) {
  const sim = emb.layer_similarity;
  const rows = sim.length; // input embeddings + every layer
  const [front, setFront] = useState(rows);
  const [hover, setHover] = useState(null); // {col, row}
  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    setFront(0);
    let raf, start = null;
    const step = (now) => {
      start ??= now;
      const f = Math.min(rows, ((now - start) / 1400) * rows);
      setFront(f);
      if (f < rows) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [emb, rows]);

  // The instruction prefix is one column (its tokens averaged); then each question token; the last is the pooled end token.
  const rest = emb.tokens.slice(emb.prompt_tokens);
  const cols = [{ label: "prefix", id: null }, ...rest.map((t) => ({ label: t.text, id: t.id }))];
  const left = 64, gridW = 430, top = 22, cellH = 8.6;
  const colW = (gridW - 40) / (cols.length - 1 || 1);
  const xs = cols.map((c, i) => (i === 0 ? left : left + 40 + (i - 1) * colW));
  const ws = cols.map((c, i) => (i === 0 ? 38 : colW - 1.5));
  const last = cols.length - 1;
  const flat = sim.flat(), lo = Math.min(...flat), hi = Math.max(...flat);
  const level = (v) => 0.05 + 0.95 * ((v - lo) / (hi - lo || 1));
  const v = emb.vector, max = Math.max(...v.map(Math.abs)) || 1;
  const hx = 560, hy = 40, cell = 6.6;
  const [cellHover, setCellHover] = useState(null);
  const base = top + rows * cellH;
  const h = hover && sim[hover.row]?.[hover.col] != null ? hover : null;
  return (
    <svg className="viz layergrid" viewBox="0 0 780 366" role="img" aria-label="Similarity of every token's state at every layer to the final query vector">
      {Array.from({ length: rows }, (_, pos) => {
        const layer = rows - 1 - pos; // top row is the last layer; sim[0] is the input embeddings
        const row = sim[layer], y = top + pos * cellH;
        return (
          <g key={pos}>
            {(layer === 0 || layer === rows - 1 || layer % 7 === 0) && <text x={left - 8} y={y + 7} textAnchor="end" className="s">{layer === 0 ? "input" : `L${layer}`}</text>}
            {row.map((val, i) => {
              const reach = h && i <= h.col;
              return <rect key={i} x={xs[i]} y={y} width={ws[i]} height={cellH - 1.4} rx="1.5"
                className={`gcell${i === last ? " pool" : ""}${reach ? " reach" : ""}`}
                style={{ fillOpacity: layer < front ? level(val) : 0 }} onPointerEnter={() => setHover({ col: i, row: layer })} onPointerLeave={() => setHover(null)} />;
            })}
          </g>
        );
      })}
      {cols.map((c, i) => (i === 0 || i === last || cols.length < 26 || i % 2 === 1) && (
        <text key={i} x={xs[i] + ws[i] / 2} y={base + 12} textAnchor="end" className={`s tok${i === last ? " pooltxt" : ""}`}
          transform={`rotate(-50 ${xs[i] + ws[i] / 2} ${base + 12})`}>{i === 0 ? "prefix" : clip(show(c.label), 12)}</text>
      ))}
      <text x={left} y={12} className="k">{emb.tokens.length} tokens × {emb.layers} layers × {fmt(emb.hidden)} numbers each · {emb.heads} attention heads</text>
      <text x={left} y={358} className="s">{h
        ? `“${show(cols[h.col].label)}” at ${h.row === 0 ? "the input" : `layer ${h.row}`}: cosine ${sim[h.row][h.col].toFixed(3)} to the final vector · it can only attend to the ${h.col} column${h.col === 1 ? "" : "s"} to its left`
        : "Brighter = closer to the final query vector (real values). Hover a cell; the outline shows what that token can attend to."}</text>

      <path d={`M${xs[last] + ws[last] / 2} ${top - 2} C ${xs[last] + 30} ${top - 16}, ${hx - 40} ${hy - 26}, ${hx - 6} ${hy + 30}`} className="arrow" markerEnd="url(#lg-arrow)" />
      <defs>
        <marker id="lg-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto"><path d="M1 1L9 5L1 9z" style={{ fill: "var(--faint)" }} /></marker>
      </defs>
      <text x={hx} y={hy - 18} className="k">last-token pooling → length 1</text>
      <text x={hx} y={hy - 6} className="s">the real query vector, 32 × 32</text>
      {v.map((val, i) => (
        <rect key={i} x={hx + (i % 32) * cell} y={hy + Math.floor(i / 32) * cell} width={cell - 0.6} height={cell - 0.6}
          className={val >= 0 ? "vpos" : "vneg"} style={{ fillOpacity: 0.12 + 0.88 * Math.min(1, Math.abs(val) / max) }}
          onPointerEnter={() => setCellHover(i)} onPointerLeave={() => setCellHover(null)} />
      ))}
      <text x={hx} y={hy + 32 * cell + 16} className="s">
        {cellHover != null ? `dimension ${cellHover}: ${v[cellHover].toFixed(4)}` : "orange positive · blue negative · hover a cell"}
      </text>
    </svg>
  );
}

/** The real query vector as a heat strip, for models whose layers are not visible (API embeddings). */
function VectorGrid({ v }) {
  const [hover, setHover] = useState(null);
  const cols = 64, cell = 9, rows = Math.ceil(v.length / cols);
  const max = Math.max(...v.map(Math.abs)) || 1;
  return (
    <svg className="viz" viewBox={`0 0 ${cols * cell + 12} ${rows * cell + 40}`} role="img" aria-label={`Query vector, ${v.length} numbers`}>
      <text x={6} y={14} className="k">the real query vector · {v.length.toLocaleString("en-US")} numbers, length 1</text>
      {v.map((val, i) => (
        <rect key={i} x={6 + (i % cols) * cell} y={22 + Math.floor(i / cols) * cell} width={cell - 0.8} height={cell - 0.8}
          className={val >= 0 ? "vpos" : "vneg"} style={{ fillOpacity: 0.12 + 0.88 * Math.min(1, Math.abs(val) / max) }}
          onPointerEnter={() => setHover(i)} onPointerLeave={() => setHover(null)} />
      ))}
      <text x={6} y={rows * cell + 36} className="s">
        {hover != null ? `dimension ${hover}: ${v[hover].toFixed(4)}` : "orange positive · blue negative · hover a cell"}
      </text>
    </svg>
  );
}

export function EmbeddingViz({ insp }) {
  const emb = insp.embedding;
  if (emb.remote) {
    return (
      <>
        {emb.tokens.length > 0 && <>
          <div className="toks" aria-label="Tokens">
            {emb.tokens.map((t, i) => <span key={i} title={`token id ${t.id}`} className={i === emb.tokens.length - 1 ? "end" : ""} dir="auto">{show(t.text)}</span>)}
          </div>
          <p className="cap">Tokens from tiktoken's cl100k_base, the tokenizer of OpenAI's text-embedding-3 models.</p>
        </>}
        <div className="note"><Icon name="info" /><span>{emb.model} runs on the provider's servers, so its layers can't be shown;
          only the vector it returns is. Switch to <code>EMBEDDING_PROVIDER=local</code> to see tokens × layers.</span></div>
        <VectorGrid v={emb.vector} />
        <Bm25 insp={insp} />
      </>
    );
  }
  return (
    <>
      <div className="toks" aria-label="Tokens">
        {emb.tokens.map((t, i) => (
          <span key={i} title={`token id ${t.id}`} className={i < emb.prompt_tokens ? "pr" : i === emb.tokens.length - 1 ? "end" : ""} dir="auto">{show(t.text)}</span>
        ))}
      </div>
      <p className="cap">Real tokens from the Qwen3 tokenizer: the grey ones are the instruction prefix the model adds to every query; the green one is the end token whose final hidden state is the vector.</p>
      <LayerGrid emb={emb} />
      <Bm25 insp={insp} />
    </>
  );
}

function Bm25({ insp }) {
  return (
      <div className="bm25">
        <div><span className="k">BM25 sees</span><code dir="auto">{insp.bm25.normalized}</code></div>
        <Icon name="chevron" />
        <div><span className="k">terms</span>{insp.bm25.terms.length ? insp.bm25.terms.map((t) => <span key={t} className="term" dir="auto">{t}</span>) : <span className="term">{insp.bm25.n_terms} terms</span>}</div>
        <Icon name="chevron" />
        <div><span className="k">sparse vector</span><b>{insp.bm25.n_terms}</b> non-zero dimensions; Qdrant weights them by IDF, so rare words count more</div>
      </div>
  );
}

const MODES = { fused: "Fused (RRF)", dense: "Dense meaning", bm25: "BM25 keywords" };

export function VectorSpace({ insp }) {
  const [mode, setMode] = useState("fused");
  const [sel, setSel] = useState(null);
  const pts = insp.points;
  const X = (x) => 56 + ((x + 1) / 2) * 640, Y = (y) => 40 + (1 - (y + 1) / 2) * 300;
  const rankOf = (p) => (mode === "fused" ? p.fused_rank : mode === "dense" ? p.dense_rank : p.sparse_rank);
  const hot = (p) => { const r = rankOf(p); return r != null && r <= insp.k; };
  const [qx, qy] = insp.query_xy;
  const maxCos = Math.max(...pts.map((p) => p.cosine));
  const cur = sel != null ? pts[sel] : null;
  return (
    <>
      <div className="jtools">
        <div className="seg" role="group" aria-label="Ranking">
          {Object.entries(MODES).map(([k, label]) => <button key={k} type="button" aria-pressed={mode === k} onClick={() => setMode(k)}>{label}</button>)}
        </div>
        <span className="hint">{pts.length} candidate chunks · top {insp.k} of each ranking linked</span>
      </div>
      <svg className="viz vmap" viewBox="0 0 780 390" role="img" aria-label={`Candidate chunks and the question projected from ${fmt(insp.embedding.vector.length)} dimensions to 2`}>
        <rect x="30" y="14" width="710" height="350" rx="10" className="box" />
        {pts.filter(hot).map((p) => <line key={p.chunk_id} x1={X(qx)} y1={Y(qy)} x2={X(p.x)} y2={Y(p.y)} className={`vlink m-${mode}`} />)}
        {pts.map((p, i) => {
          const r = rankOf(p);
          const on = hot(p);
          const fill = mode === "dense" ? { fillOpacity: 0.15 + 0.85 * Math.max(0, p.cosine / maxCos) } : undefined;
          return (
            <g key={p.chunk_id} className={`vpt m-${mode}${on ? " on" : ""}${r == null ? " none" : ""}${sel === i ? " sel" : ""}`}
              onPointerEnter={() => setSel(i)} onClick={() => setSel(i)}>
              <circle cx={X(p.x)} cy={Y(p.y)} r={on ? 7 : 5} style={fill} />
              {on && <text x={X(p.x) + 9} y={Y(p.y) + 4} className="t">{r}</text>}
            </g>
          );
        })}
        <g className="vq">
          <path d={`M${X(qx)} ${Y(qy) - 10} L${X(qx) + 9} ${Y(qy)} L${X(qx)} ${Y(qy) + 10} L${X(qx) - 9} ${Y(qy)} Z`} />
          <text x={X(qx)} y={Y(qy) - 15} textAnchor="middle" className="t">your question</text>
        </g>
      </svg>
      <div className="vsel" dir="auto">
        {cur ? <>
          <div className="meta"><code className="chip">{cur.chunk_id}</code><span className="tag">{cur.lang}</span>
            <span>cosine <b>{cur.cosine.toFixed(3)}</b></span><span>dense #{cur.dense_rank ?? "–"}</span><span>BM25 #{cur.sparse_rank ?? "–"}</span>
            <span>fused #{cur.fused_rank ?? "–"}</span>{cur.top_k && <span className="badge b-ok">top {insp.k}</span>}</div>
          <p>{cur.excerpt}…</p>
        </> : <p className="cap">Hover a point to read the chunk. The map squeezes {fmt(insp.embedding.vector.length)} dimensions into 2 (PCA), so distances are approximate; the cosine number is exact.</p>}
      </div>
      <table className="state rrf">
        <thead><tr><th>Fused</th><th>Chunk</th><th>Dense rank</th><th>BM25 rank</th><th>1 / (rank + 1), summed</th></tr></thead>
        <tbody>
          {pts.filter((p) => p.fused_rank).sort((a, b) => a.fused_rank - b.fused_rank).slice(0, insp.k + 3).map((p) => (
            <tr key={p.chunk_id} className={p.top_k ? "" : "out"}>
              <td>#{p.fused_rank}</td><td><code>{p.chunk_id}</code></td><td>{p.dense_rank ?? "–"}</td><td>{p.sparse_rank ?? "–"}</td>
              <td className="num">{[p.dense_rank, p.sparse_rank].filter(Boolean).map((r) => `1/${r + 1}`).join(" + ")} = <b>{p.fused_score.toFixed(3)}</b></td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="cap">Rows below the line didn't make the top {insp.k}. A chunk only one search found gets one term, so agreement between meaning and keywords is rewarded.</p>
    </>
  );
}
