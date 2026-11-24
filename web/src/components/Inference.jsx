// "Inside inference": one question followed from the Ask button to the rendered answer, across layers (space),
// stages and milliseconds (time), tokens × layers × numbers (the embedding model), vector space and the decode loop.
import { useEffect, useState } from "react";
import { inspect } from "../api.js";
import { Icon } from "../icons.jsx";
import { Journey3D } from "./Journey3D.jsx";
import { PageHero, Section, Toc } from "./Section.jsx";
import { EmbeddingViz, VectorSpace } from "./RetrievalViz.jsx";
import { TokenLoop } from "./TokenLoop.jsx";

const EXAMPLE_QUESTION = "What is retrieval-augmented generation?";
const secs = (ms) => (ms == null ? "–" : ms >= 1000 ? `${(ms / 1000).toFixed(2)} s` : `${Math.round(ms)} ms`);

/** Where the time went: graph steps from the server, first visible token from the browser, retrieval parts from inspect. */
function Waterfall({ run, insp }) {
  if (!run) return <p className="cap">Ask a question on the assistant page, then come back: each step's measured time appears here.</p>;
  const t = run.timings;
  const c = run.client ?? {};
  const total = c.total ?? t.total;
  // Place each step where the browser saw it end (its event's arrival) minus its server-side duration.
  const nodes = ["guard", "retrieve", "generate", "check"].filter((n) => t[n] != null);
  const starts = {};
  let cursor = 0;
  for (const n of nodes) { starts[n] = c.at?.[n] != null ? Math.max(cursor, c.at[n] - t[n]) : cursor; cursor = starts[n] + t[n]; }
  const rows = [];
  const add = (label, ms, cls, start, sub = false) => { if (ms != null && ms >= 0) rows.push({ label, ms, cls, sub, start }); };
  if (nodes.length && starts[nodes[0]] > 1) add("before the graph: request, thread, trace setup", starts[nodes[0]], "l-server", 0);
  add("guard · Arbiter", t.guard, "l-cloud", starts.guard);
  if (t.retrieve != null) {
    add("retrieve", t.retrieve, "l-local", starts.retrieve);
    if (insp) {
      let s = starts.retrieve;
      const remote = insp.embedding.remote;
      for (const [k, label] of [["embed_dense", remote ? "embed question (API call)" : "embed question (local model)"], ["embed_sparse", "BM25 terms"], ["search_dense", "dense search"], ["search_sparse", "keyword search"]]) {
        add(label, insp.timings[k], k === "embed_dense" && remote ? "l-cloud" : "l-local", s, true); s += insp.timings[k] || 0;
      }
    }
  }
  if (t.generate != null) {
    const g0 = starts.generate;
    const grade = t.grade ?? 0;
    add(run.answerable === false ? "generate · answer model skipped" : `generate · ${run.config?.llm ?? "LLM"}`, t.generate, "l-cloud", g0);
    add("relevance check · Arbiter", t.grade, "l-cloud", g0, true);
    if (c.ttft != null && c.ttft > g0 + grade) {
      add("waiting: prefill + reasoning", c.ttft - g0 - grade, "l-cloud", g0 + grade, true);
      add("streaming visible tokens", Math.max(0, g0 + t.generate - c.ttft), "l-browser", c.ttft, true);
    }
  }
  add("check · grounding rules", t.check, "l-local", starts.check);
  add("after the graph: result, trace scores, render", Math.max(0, total - cursor), "l-server", cursor);
  return (
    <>
      <div className="wf">
        {rows.map((r, i) => (
          <div key={i} className={`wfrow${r.sub ? " sub" : ""}`}>
            <span className="wfl">{r.label}</span>
            <span className="wft"><i className={r.cls} style={{ left: `${(r.start / total) * 100}%`, width: `${Math.max(0.4, (r.ms / total) * 100)}%` }} /></span>
            <span className="num">{secs(r.ms)}</span>
          </div>
        ))}
        <div className="wfrow total"><span className="wfl">total, as the browser saw it</span><span className="wft" /><span className="num">{secs(total)}</span></div>
      </div>
      <p className="cap">Step durations are measured by the server and placed where the browser received each step's event; the first visible token and the total are measured by the browser.{insp ? " Retrieval's sub-steps come from the inspect run below, so they are close but not the same measurement." : ""}</p>
    </>
  );
}

const TOC = [["journey", "Journey"], ["time", "Time"], ["embedding", "Embedding"], ["search", "Search space"], ["decode", "Decode loop"]];

export function Inference({ lastRun, llm, onBack }) {
  const [q, setQ] = useState(lastRun?.question ?? EXAMPLE_QUESTION);
  const [insp, setInsp] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  async function run(question) {
    setBusy(true); setError(null);
    try { setInsp(await inspect(question)); } catch (err) { setError(err.message); } finally { setBusy(false); }
  }
  useEffect(() => { run(q); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const runMatches = lastRun && insp && lastRun.question.trim() === insp.question.trim();
  const emb = insp?.embedding;
  const stats = [
    [emb ? emb.tokens.length : "–", "query tokens", "l-local"],
    [emb ? (emb.layers ?? "hosted") : "–", "embedding layers", emb?.remote ? "l-cloud" : "l-local"],
    [emb ? emb.vector.length.toLocaleString("en-US") : "–", "vector dimensions", "l-local"],
    [insp ? insp.points.length : "–", "candidate chunks", "l-graph"],
    [lastRun?.usage?.output_tokens ? lastRun.usage.output_tokens.toLocaleString("en-US") : "–", "tokens generated", "l-cloud"],
    [lastRun ? secs(lastRun.client?.total ?? lastRun.timings.total) : "–", "end to end", "l-browser"],
  ];
  return (
    <>
      <PageHero eyebrow="Inside inference" title="From Ask to answer, every step" stats={stats}>
        <p>One question seen five ways: <b>space</b> (which layer of the system is working), <b>time</b> (where the
          milliseconds go), <b>tokens × layers</b> (inside the embedding model), <b>vector space</b> (how chunks are found and
          ranked) and the <b>decode loop</b> (how {llm} writes one token at a time).</p>
        <form className="inspect" onSubmit={(e) => { e.preventDefault(); if (q.trim()) run(q.trim()); }}>
          <label className="sr-only" htmlFor="iq">Question to inspect</label>
          <Icon name="search" />
          <input id="iq" dir="auto" maxLength={1000} value={q} onChange={(e) => setQ(e.target.value)} placeholder="A question to trace" />
          <button className="go" type="submit" disabled={busy}><span>{busy ? "Inspecting…" : "Inspect"}</span></button>
        </form>
        <div className="note"><Icon name="info" />
          {emb?.remote ? "Inspect runs only the retrieval part (one embeddings API call, no answer model) and shows its real numbers."
            : "Inspect runs only the local retrieval part (no model API calls) and shows its real numbers."}
          {lastRun ? (runMatches ? " Guard, generation and check values come from your last answer to this question." : " Guard, generation and check values come from your last answer, which was a different question.")
            : " Ask a question on the assistant page to fill in the guard, generation and check stages too."}
        </div>
        {error && <div className="status error"><Icon name="alert" />{error}. Is <b>python ui.py</b> running and the index built?</div>}
      </PageHero>
      <Toc items={TOC} onBack={onBack} />

      <Section id="journey" n={1} icon="route" title="The journey: five layers, sixteen stages" kind={lastRun ? "live" : "example"}>
        <p>The dot is the data in flight. Press Play, or step through; each stage shows what runs, where in the code, and the values it saw.</p>
        <Journey3D run={lastRun} insp={insp} />
      </Section>

      <Section id="time" n={2} icon="clock" title="Time: where the wait goes" kind={lastRun ? "measured" : "example"}>
        <Waterfall run={lastRun} insp={insp} />
      </Section>

      <Section id="embedding" n={3} icon="grid" title="Meaning as numbers: the embedding model" kind="live">
        {insp ? <>
          {emb.remote
            ? <p>{emb.model.split("/").pop()} runs as an API: the question is sent to the provider, which returns a
                {" "}{emb.vector.length.toLocaleString("en-US")}-number vector. BM25 still runs on this machine and keeps the exact words.</p>
            : <p>{emb.model.split("/").pop()} runs on this machine. The question is cut into tokens, every token flows up
                through {emb.layers} layers, and the last token, which has attended to all the others, becomes a
                {" "}{emb.vector.length.toLocaleString("en-US")}-number vector. Alongside it, BM25 keeps the exact words.</p>}
          <EmbeddingViz insp={insp} />
        </> : <p className="cap">{busy ? "Running the embedding model…" : "Inspect a question to see its tokens and vector."}</p>}
      </Section>

      <Section id="search" n={4} icon="database" title="Search space: finding and ranking chunks" kind="live">
        {insp ? <>
          <p>Every chunk in the index was embedded the same way at ingest time. Dense search ranks by cosine similarity
            (meaning), BM25 by matching terms (wording), and reciprocal rank fusion merges the two lists.</p>
          <VectorSpace insp={insp} />
        </> : <p className="cap">{busy ? "Searching…" : "Inspect a question to see the candidates."}</p>}
      </Section>

      <Section id="decode" n={5} icon="sparkles" title={`Writing the answer: ${llm}, one token at a time`} kind={lastRun ? "mixed" : "example"}>
        <p>The model first reads the whole prompt in one parallel pass (prefill), thinks privately, then repeats one loop per
          token: run the newest token through every layer, score the whole vocabulary, pick one, append it, stream it.</p>
        <TokenLoop run={lastRun} />
      </Section>
    </>
  );
}
