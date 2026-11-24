import { useLayoutEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Icon } from "../icons.jsx";
import { pageTitle, siteName } from "../sources.js";
import { Favicon } from "./Favicon.jsx";

/** Short label for a source: the host and path of a URL, or the file name. */
export const host = (hit) => hit.source_type === "url"
  ? hit.source.replace(/^https?:\/\/(www\.)?/, "").replace(/\/$/, "")
  : hit.source.split(/[\\/]/).pop();

function Flag({ hit, closest }) {
  if (closest) return <span className="badge b-info" title="Nearest passage in the index; it does not answer the question">closest match</span>;
  if (hit.cited) return <span className="badge b-ok"><Icon name="check" size="xs" />cited</span>;
  if (hit.used) return <span className="badge b-info">sent to model</span>;
  if (hit.used === false) return <span className="badge b-muted" title="Did not fit the context budget">over budget</span>;
  return null;
}

/** One retrieved chunk; `anchor` is its element id (for citation jumps), `flash` briefly highlights it. */
export function Passage({ hit, rank, topScore, flash, closest = false, anchor }) {
  const text = useRef(null);
  const [open, setOpen] = useState(false);
  const [long, setLong] = useState(false);
  useLayoutEffect(() => setLong(text.current.scrollHeight > text.current.clientHeight + 2), []);
  const pct = topScore ? Math.round((hit.score / topScore) * 100) : 0;
  const copy = () => {
    navigator.clipboard?.writeText(`[${hit.chunk_id}]`);
    toast.success(`Copied [${hit.chunk_id}]`);
  };
  const Title = hit.source_type === "url" ? "a" : "span";
  return (
    <article className={`hit${flash ? " flash" : ""}${hit.used === false ? " dim" : ""}`} id={anchor}>
      <div className="hit-head">
        <span className="num-badge">{rank}</span>
        <Favicon hit={hit} size={16} />
        <div className="hit-src">
          <Title className="hit-title" dir="auto" {...(hit.source_type === "url" ? { href: hit.source, target: "_blank", rel: "noopener noreferrer" } : {})}>
            {pageTitle(hit)}{hit.source_type === "url" && <Icon name="arrow-up-right" size="xs" />}
          </Title>
          <span className="hit-site">{siteName(hit)} · {host(hit)}</span>
        </div>
        <div className="hit-flags">
          <span className="tag">{hit.lang}</span>
          <Flag hit={hit} closest={closest} />
          <span className="score" title={`Relevance relative to the top passage. RRF score ${hit.score.toFixed(4)} (dense + BM25)`}>
            <span className="bar"><i style={{ width: `${pct}%` }} /></span>{pct}%
          </span>
          <button className="ghost-btn sm" type="button" title={`Copy citation [${hit.chunk_id}]`} aria-label="Copy citation" onClick={copy}><Icon name="copy" /></button>
        </div>
      </div>
      <p ref={text} className={`text${open ? "" : " clamped"}`} dir="auto">{hit.content ?? hit.excerpt}</p>
      {long && (
        <button className="link-btn" type="button" onClick={() => setOpen(!open)} aria-expanded={open}>
          {open ? "Show less" : "Show more"}<span className={`chev${open ? " up" : ""}`}><Icon name="chevron-down" /></span>
        </button>
      )}
    </article>
  );
}
