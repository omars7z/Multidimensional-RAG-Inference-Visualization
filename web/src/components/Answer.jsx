import { useState } from "react";
import { Icon } from "../icons.jsx";
import { Details } from "./Details.jsx";
import { Passage, SourceLink } from "./Passage.jsx";
import { FlowDiagram } from "./FlowDiagram.jsx";

const CITATION = /\[([^[\]\s#]+#\d+)\]/g;

function outcome(r) {
  if (r.verdict === "unsafe") return ["b-bad", "shield-x", "Refused: unsafe request"];
  if (r.verdict === "too_long") return ["b-bad", "shield-x", "Refused: question too long"];
  if (r.verdict === "out_of_scope") return ["b-info", "info", "Declined: outside the documents"];
  if (r.checks.idk) return ["b-info", "help", "Not in the documents"];
  if (!r.checks.citations_ok) return ["b-warn", "alert", "Replaced: answer was not grounded"];
  if (!r.checks.numbers_ok || !r.checks.lang_ok) return ["b-warn", "alert", "Answered with warnings"];
  return ["b-ok", "shield-check", "Grounded answer"];
}

/** Answer text with [doc_id#n] turned into buttons that jump to the passage (red if not retrieved). */
function AnswerText({ text, known, onJump }) {
  const parts = [];
  let last = 0;
  for (const match of text.matchAll(CITATION)) {
    parts.push(text.slice(last, match.index));
    const id = match[1];
    parts.push(known.has(id)
      ? <button key={match.index} className="cite" type="button" title={`Go to passage ${id}`} onClick={() => onJump(id)}>{id}</button>
      : <span key={match.index} className="cite bad" title="This citation does not match a retrieved passage">{id}</span>);
    last = match.index + match[0].length;
  }
  parts.push(text.slice(last));
  return <p className="answer" dir="auto">{parts}</p>;
}

/** While streaming: the draft as the model writes it, and the pipeline filling in step by step. */
export function LiveAnswer({ draft, steps, llm }) {
  return (
    <>
      <section className="card">
        <div className="head"><span className="badge b-info"><Icon name="sparkles" />{draft ? "Writing…" : "Working…"}</span></div>
        <p className="answer draft" dir="auto">{draft}<span className="caret" /></p>
        <div className="note"><Icon name="info" /><span>The draft appears as it is written. Citations, numbers and language are checked when it finishes; an ungrounded draft is replaced with “I don't know”.</span></div>
      </section>
      <h2><Icon name="route" />How this answer is being produced</h2>
      <section className="card"><FlowDiagram steps={steps} live draftChars={draft.length} llm={llm} /></section>
    </>
  );
}

export function Answer({ result: r, replacedDraft }) {
  const [flash, setFlash] = useState(null);
  const [copied, setCopied] = useState(false);
  const [cls, icon, label] = outcome(r);
  const cited = r.sources.filter((s) => s.cited);
  // "I don't know": the passages are only the nearest matches, not the basis of an answer.
  const closest = r.verdict === "in_scope" && r.checks.idk;
  const lockNote = r.verdict !== "in_scope"
    ? "Refusals are fixed messages: the question is never echoed back or sent to the answer model."
    : !closest ? "Written only from the passages below. Retrieved text is treated as untrusted data, never as instructions."
    : r.answerable === false ? "No passage in the documents answers this, so the answer model was not called. The closest matches are shown below."
    : "The answer model found no answer in the passages it was given. The closest matches are shown below.";
  const jump = (id) => {
    document.getElementById(`hit-${id}`)?.scrollIntoView({ behavior: "smooth", block: "center" });
    setFlash(id);
    setTimeout(() => setFlash(null), 1400);
  };
  const copy = () => {
    navigator.clipboard?.writeText(r.answer);
    setCopied(true);
    setTimeout(() => setCopied(false), 1000);
  };
  return (
    <>
      <section className="card">
        <div className="head">
          <span className={`badge ${cls}`}><Icon name={icon} />{label}</span>
          <button className="iconbtn" type="button" onClick={copy}><Icon name="copy" /><span>{copied ? "Copied" : "Copy"}</span></button>
        </div>
        <AnswerText text={r.answer} known={new Set(r.sources.map((s) => s.chunk_id))} onJump={jump} />
        {cited.length > 0 && (
          <ul className="srclist">
            {cited.map((s) => <li key={s.chunk_id}><code>{s.chunk_id}</code><SourceLink hit={s} /></li>)}
          </ul>
        )}
        {replacedDraft && (
          <div className="note"><Icon name="alert" /><span>The streamed draft failed the grounding check, so it was replaced.</span></div>
        )}
        <div className="note"><Icon name={closest ? "info" : "lock"} /><span>{lockNote}</span></div>
      </section>
      <h2><Icon name="route" />How this answer was produced</h2>
      <Details result={r} />
      {r.sources.length > 0 && (
        <>
          <h2><Icon name="layers" />{closest ? "Closest matches, none answers the question" : "Retrieved passages"} · {r.sources.length}</h2>
          {r.sources.map((s, i) => <Passage key={s.chunk_id} hit={s} rank={i + 1} topScore={r.sources[0].score} flash={flash === s.chunk_id} closest={closest} />)}
        </>
      )}
    </>
  );
}
