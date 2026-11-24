import { motion } from "motion/react";
import { useEffect, useState } from "react";
import { Icon } from "../icons.jsx";
import { ActionBar, AnswerText, Progress, Related, SourceStrip, cleanDraft, outcome } from "./Answer.jsx";
import { Details } from "./Details.jsx";
import { Notice } from "./EmptyState.jsx";
import { FlowDiagram } from "./FlowDiagram.jsx";
import { Passage } from "./Passage.jsx";

const fmt = (n) => Number(n || 0).toLocaleString("en-US");

function lockNote(r, closest) {
  if (r.verdict !== "in_scope") return ["lock", "Refusals are fixed messages: the question is never echoed back or sent to the answer model."];
  if (!closest) return ["lock", "Written only from the retrieved passages, which are treated as untrusted data, never as instructions."];
  return ["info", r.answerable === false
    ? "No passage answers this, so the answer model was not called. The closest matches are under Sources."
    : "The answer model found no answer in the passages it was given. The closest matches are under Sources."];
}

function Passages({ turn, hits, flash, closest }) {
  return hits.map((s, i) => (
    <Passage key={s.chunk_id} hit={s} rank={i + 1} topScore={hits[0].score} flash={flash === s.chunk_id} closest={closest}
      anchor={`p-${turn.id}-${s.chunk_id}`} />
  ));
}

/** One question and everything about its answer, in three tabs. */
export function Turn({ turn, info, onAsk, onRetry }) {
  const [tab, setTab] = useState("answer");
  const [flash, setFlash] = useState(null);
  const r = turn.result;
  const embedding = info && { model: info.model, provider: info.embedding_provider };

  useEffect(() => { // after a citation click: show the passage in the Sources tab
    if (!flash || tab !== "sources") return;
    document.getElementById(`p-${turn.id}-${flash}`)?.scrollIntoView({ behavior: "smooth", block: "center" });
    const t = setTimeout(() => setFlash(null), 1800);
    return () => clearTimeout(t);
  }, [flash, tab, turn.id]);
  const cite = (id) => { setTab("sources"); setFlash(id); };

  if (turn.mode === "search") {
    return (
      <motion.article className="turn" id={`turn-${turn.id}`} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}>
        <h2 className="turn-q" dir="auto">{turn.q}</h2>
        <div className="turn-meta"><span className="chip"><Icon name="search" size="xs" />Search only</span>
          {turn.state === "done" && <span>{turn.hits.length} passages · {fmt(Math.round(turn.ms))} ms · no model called</span>}</div>
        {turn.state === "live" && <div className="hit skel-hit"><i /><i /><i /></div>}
        {turn.state === "error" && <ErrorBox turn={turn} onRetry={onRetry} />}
        {turn.state === "done" && (turn.hits.length
          ? <Passages turn={turn} hits={turn.hits} />
          : <Notice>No matching passages. Try other words, or the other language.</Notice>)}
      </motion.article>
    );
  }

  const closest = r && r.verdict === "in_scope" && r.checks.idk;
  const [cls, icon, label] = r ? outcome(r) : [];
  const nSources = r?.sources.length ?? 0;
  const TABS = [["answer", "sparkles", "Answer"], ["sources", "layers", nSources ? `Sources · ${nSources}` : "Sources"], ["steps", "workflow", "Steps"]];

  return (
    <motion.article className="turn" id={`turn-${turn.id}`} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}>
      <h2 className="turn-q" dir="auto">{turn.q}</h2>
      <div className="turn-tabs">
        <div role="tablist" aria-label="Answer views">
          {TABS.map(([id, ic, text]) => (
            <button key={id} role="tab" type="button" aria-selected={tab === id} onClick={() => setTab(id)}
              disabled={id === "sources" && !nSources}>
              {tab === id && <motion.span layoutId={`tab-${turn.id}`} className="tab-line" transition={{ type: "spring", bounce: 0.15, duration: 0.35 }} />}
              <Icon name={ic} /><span>{text}</span>
            </button>
          ))}
        </div>
        {r && <span className={`badge ${cls}`}><Icon name={icon} size="xs" />{label}</span>}
        {turn.state === "live" && <span className="badge b-info"><span className="spinner" />{turn.draft ? "Writing" : "Working"}</span>}
      </div>

      {tab === "answer" && (
        <div role="tabpanel" className="turn-body">
          {turn.state === "live" && <>
            <Progress steps={turn.steps} chunks={info?.chunks} />
            <SourceStrip loading sources={[]} />
            {turn.draft && <AnswerText text={cleanDraft(turn.draft)} sources={[]} onCite={() => {}} className="draft" />}
          </>}
          {turn.state === "error" && <ErrorBox turn={turn} onRetry={onRetry} />}
          {turn.state === "stopped" && <Notice icon="info">Stopped. {turn.draft ? "The unverified draft was discarded." : ""}</Notice>}
          {r && <>
            <SourceStrip sources={r.sources} onMore={() => setTab("sources")} />
            <AnswerText text={r.answer} sources={r.sources} onCite={cite} />
            {turn.replacedDraft && <p className="fine warn"><Icon name="alert" />The streamed draft failed the grounding check, so it was replaced.</p>}
            {(() => { const [ic, note] = lockNote(r, closest); return <p className="fine"><Icon name={ic} />{note}</p>; })()}
            <ActionBar result={r} onRetry={() => onRetry(turn)} onSteps={() => setTab("steps")} />
            <Related result={r} onAsk={onAsk} />
          </>}
        </div>
      )}

      {tab === "sources" && r && (
        <div role="tabpanel" className="turn-body">
          {closest && <p className="fine"><Icon name="info" />These are the closest matches; none of them answers the question.</p>}
          <Passages turn={turn} hits={r.sources} flash={flash} closest={closest} />
        </div>
      )}

      {tab === "steps" && (
        <div role="tabpanel" className="turn-body steps-panel">
          {r ? <Details result={r} /> : <FlowDiagram steps={turn.steps} live={turn.state === "live"} draftChars={turn.draft.length} llm={info?.llm ?? "GPT 6"} embedding={embedding} />}
        </div>
      )}
    </motion.article>
  );
}

function ErrorBox({ turn, onRetry }) {
  return (
    <div className="error-box">
      <Icon name="alert" size="" />
      <div><b>Something went wrong</b><p>{turn.error}. Check that the server is running, the index is built and the model settings in .env are correct.</p></div>
      <button type="button" className="act" onClick={() => onRetry(turn)}><Icon name="retry" /><span>Try again</span></button>
    </div>
  );
}
