// The LangGraph pipeline as a diagram: START → guard → route → retrieve → generate → check → END,
// with the refusal branch and the model or engine each node calls. Lights up the path a run takes.

const fmt = (n) => Number(n || 0).toLocaleString("en-US");
const secs = (ms) => (ms == null ? "" : ms >= 1000 ? `${(ms / 1000).toFixed(1)} s` : `${Math.round(ms)} ms`);
const ORDER = ["guard", "retrieve", "generate", "check"];
const X = { guard: 120, retrieve: 322, generate: 472, check: 622 }; // node centres

/** Work out each node's and edge's state from a finished result or from live step events. */
function layout({ result, steps = {}, live, draftChars }) {
  const done = result
    ? Object.fromEntries(result.explanation.map((s) => [s.step, { status: s.status, ms: result.timings[s.step] }]))
    : steps;
  const refused = done.guard && done.guard.status === "refused";
  const active = live && !refused ? ORDER.find((n) => !done[n]) : null;
  const state = (n) => (done[n] ? done[n].status : active === n ? "active" : refused || result ? "skipped" : "idle");
  const nodes = Object.fromEntries(ORDER.map((n) => [n, state(n)]));
  const reached = (n) => !!done[n];
  const edge = (from, to) => (reached(from) && (reached(to) || active === to) ? (active === to ? "live" : "on") : "");
  const probs = result?.guard_probs ?? {};
  const top = Object.keys(probs).sort((a, b) => probs[b] - probs[a])[0];
  const used = result?.sources.filter((s) => s.used).length;
  const c = result?.checks;
  const mark = (ok) => (ok ? "✓" : "✗");
  return {
    nodes, refused, active,
    edges: {
      start: done.guard || active === "guard" ? (active === "guard" ? "live" : "on") : "",
      guardRoute: reached("guard") ? (refused ? "bad" : "on") : "",
      routeRetrieve: refused ? "" : edge("guard", "retrieve"),
      retrieveGenerate: edge("retrieve", "generate"),
      generateCheck: edge("generate", "check"),
      checkEnd: reached("check") ? "on" : "",
      refusal: refused ? "bad" : "",
    },
    subs: Object.fromEntries(ORDER.map((n) => [n, nodes[n] === "active" ? (n === "generate" && draftChars ? "writing…" : "running…")
      : done[n] ? `${done[n].status} · ${secs(done[n].ms)}` : nodes[n] === "skipped" ? "not run" : "waiting"])),
    metrics: {
      guard: top ? `${top.replaceAll("_", " ")} p=${probs[top].toFixed(2)}` : refused ? "length check" : "scores 4 options",
      retrieve: result?.sources.length ? `${result.sources.length} chunks · ${used} sent` : "dense + BM25 → RRF",
      generate: result?.answerable === false && result.sources.length ? "not called"
        : result?.usage?.input_tokens ? `${fmt(result.usage.input_tokens)} in · ${fmt(result.usage.output_tokens)} out tok`
        : draftChars ? `${fmt(draftChars)} chars streamed` : "reasons, then writes",
      check: c?.citations ? `cite ${mark(c.citations_ok)} num ${mark(c.numbers_ok)} lang ${mark(c.lang_ok)}` : "cites · numbers · lang",
    },
  };
}

function Node({ x, title, sub, state }) {
  return (
    <g className={`fnode ${state}`}>
      <rect x={x - 60} y="118" width="120" height="54" rx="10" />
      <text x={x} y="140" textAnchor="middle" className="t">{title}</text>
      <text x={x} y="158" textAnchor="middle" className="s">{sub}</text>
    </g>
  );
}

function Engine({ x, kind, name, metric, link, state }) {
  return (
    <g className={`fmodel ${state}`}>
      <path d={`M${x} 172 V220`} className="flink" />
      <text x={x + 6} y="200" className="s">{link}</text>
      <rect x={x - 65} y="222" width="130" height="64" rx="10" />
      <text x={x} y="240" textAnchor="middle" className="k">{kind}</text>
      <text x={x} y="257" textAnchor="middle" className="t">{name}</text>
      <text x={x} y="274" textAnchor="middle" className="s">{metric}</text>
    </g>
  );
}

const Edge = ({ d, state }) => <path d={d} className={`fedge ${state}`} markerEnd={`url(#arrow-${state === "bad" ? "bad" : state ? "on" : "off"})`} />;

/** The dense embedder for the retrieve box: from the run's config, else from /api/info (`embedding`), else the default. */
function embedder(result, embedding) {
  const model = result?.config?.embedding ?? embedding?.model ?? "Qwen3-Embedding";
  const remote = (result?.config?.embedding_provider ?? embedding?.provider) === "openai";
  const short = model.split("/").pop();
  return remote
    ? { kind: "api · bm25 local", name: short.replace(/^text-embedding-/, "embed-"), link: "1 call" }
    : { kind: "local · no API", name: `${short.split("-")[0]} + BM25`, link: "local" };
}

export function FlowDiagram({ result, steps, live = false, draftChars = 0, llm = "GPT 6", embedding }) {
  const emb = embedder(result, embedding);
  const f = layout({ result, steps, live, draftChars });
  const n = f.nodes;
  const engineState = (node) => (n[node] === "skipped" || n[node] === "idle" ? n[node] : n[node] === "active" ? "active" : "used");
  return (
    <div className="flow">
      <svg viewBox="0 0 780 300" role="img" aria-label="LangGraph pipeline: guard, route, retrieve, generate, check">
        <defs>
          {[["off", "var(--faint)"], ["on", "var(--accent)"], ["bad", "var(--bad)"]].map(([id, color]) => (
            <marker key={id} id={`arrow-${id}`} viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto">
              <path d="M1 1L9 5L1 9z" style={{ fill: color }} />
            </marker>
          ))}
        </defs>
        <g className={`fterm ${f.edges.start ? "on" : ""}`}><circle cx="26" cy="145" r="9" /><text x="26" y="172" textAnchor="middle" className="k">START</text></g>
        <Edge d="M36 145 H56" state={f.edges.start} />
        <Node x={X.guard} title="guard" sub={f.subs.guard} state={n.guard} />
        <Edge d="M181 145 H198" state={f.edges.guardRoute} />
        <g className={`froute ${f.edges.guardRoute}`}>
          <path d="M218 127 L236 145 L218 163 L200 145 Z" />
          <text x="218" y="185" textAnchor="middle" className="k">route</text>
        </g>
        <Edge d="M237 145 H258" state={f.edges.routeRetrieve} />
        <Node x={X.retrieve} title="retrieve" sub={f.subs.retrieve} state={n.retrieve} />
        <Edge d="M383 145 H408" state={f.edges.retrieveGenerate} />
        <Node x={X.generate} title="generate" sub={f.subs.generate} state={n.generate} />
        <Edge d="M533 145 H558" state={f.edges.generateCheck} />
        <Node x={X.check} title="check" sub={f.subs.check} state={n.check} />
        <Edge d="M683 145 H728" state={f.edges.checkEnd} />
        <g className={`fterm ${f.edges.checkEnd || f.edges.refusal ? "on" : ""}`}><circle cx="742" cy="145" r="9" /><text x="742" y="172" textAnchor="middle" className="k">END</text></g>

        <Edge d="M218 126 V46 H258" state={f.edges.refusal} />
        <g className={`fnode ${f.refused ? "refused" : result || live ? "skipped" : "idle"}`}>
          <rect x="262" y="24" width="270" height="44" rx="10" />
          <text x="397" y="42" textAnchor="middle" className="t">refusal</text>
          <text x="397" y="58" textAnchor="middle" className="s">fixed bilingual message · no retrieval, no GPT call</text>
        </g>
        <Edge d="M533 46 H742 V132" state={f.edges.refusal} />

        <Engine x={X.guard} kind="scoring model" name="Arbiter" metric={f.metrics.guard} link="1 call" state={engineState("guard")} />
        <Engine x={X.retrieve} kind={emb.kind} name={emb.name} metric={f.metrics.retrieve} link={emb.link} state={engineState("retrieve")} />
        <Engine x={X.generate} kind="generative model" name={llm} metric={f.metrics.generate} link={n.generate === "skipped" ? "no call" : "1 call"} state={engineState("generate")} />
        <Engine x={X.check} kind="code · no model" name="Grounding rules" metric={f.metrics.check} link="local" state={engineState("check")} />
      </svg>
      <div className="flegend">
        <span><i className="dot passed" />done</span><span><i className="dot active" />running</span>
        <span><i className="dot refused" />refused</span><span><i className="dot warning" />warning</span><span><i className="dot skipped" />not run</span>
      </div>
    </div>
  );
}
