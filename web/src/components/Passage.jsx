import { useLayoutEffect, useRef, useState } from "react";
import { Icon } from "../icons.jsx";

export function SourceLink({ hit }) {
  if (hit.source_type !== "url") {
    return <span className="source" title={hit.source}><Icon name="file" />{hit.source}</span>;
  }
  return (
    <a className="source" href={hit.source} target="_blank" rel="noopener noreferrer" title={hit.source}>
      <Icon name="globe" />{hit.source.replace(/^https?:\/\//, "")}<Icon name="external" />
    </a>
  );
}

function Flag({ hit, closest }) {
  if (closest) return <span className="badge b-info" title="Nearest passage in the index; it does not answer the question">closest match</span>;
  if (hit.cited) return <span className="badge b-ok"><Icon name="check" />cited</span>;
  if (hit.used) return <span className="badge b-info">sent to model</span>;
  if (hit.used === false) return <span className="badge b-warn">over budget</span>;
  return null;
}

/** One retrieved chunk; `flash` briefly highlights it after a citation click; `closest` marks a non-answering match. */
export function Passage({ hit, rank, topScore, flash, closest = false }) {
  const text = useRef(null);
  const [open, setOpen] = useState(false);
  const [long, setLong] = useState(false);
  const [copied, setCopied] = useState(false);
  useLayoutEffect(() => setLong(text.current.scrollHeight > text.current.clientHeight + 2), []);
  const pct = topScore ? Math.round((hit.score / topScore) * 100) : 0;
  const copy = () => {
    navigator.clipboard?.writeText(`[${hit.chunk_id}]`);
    setCopied(true);
    setTimeout(() => setCopied(false), 1000);
  };
  return (
    <article className={`hit${flash ? " flash" : ""}`} id={`hit-${hit.chunk_id}`}>
      <div className="meta">
        <span className="rank">{rank}</span>
        <button className="chip" type="button" title="Copy citation" onClick={copy}>{copied ? "copied" : hit.chunk_id}</button>
        <span className="tag">{hit.lang}</span>
        <Flag hit={hit} closest={closest} />
        <SourceLink hit={hit} />
        <span className="score" title="Reciprocal-rank-fusion score of the dense and BM25 rankings">
          <span className="bar"><i style={{ width: `${pct}%` }} /></span>{hit.score.toFixed(3)}
        </span>
      </div>
      <p ref={text} className={`text${open ? "" : " clamped"}`} dir="auto">{hit.content ?? hit.excerpt}</p>
      {long && (
        <button className="more" type="button" onClick={() => setOpen(!open)}>
          <Icon name="chevron-down" /><span>{open ? "Show less" : "Show more"}</span>
        </button>
      )}
    </article>
  );
}
