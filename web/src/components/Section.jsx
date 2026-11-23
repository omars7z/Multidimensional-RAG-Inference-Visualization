// Shared layout for the explainer pages: a hero band with live stats, a sticky section nav with scroll spy,
// and numbered sections that say where their data comes from (live, measured or illustrative).
import { useEffect, useState } from "react";
import { Icon } from "../icons.jsx";

const PROVENANCE = {
  live: ["Live data", "Values from this machine or your last run"],
  measured: ["Measured", "Timings measured by the server and the browser"],
  mixed: ["Partly simulated", "Counts are real; model internals that aren't exposed are illustrated"],
  example: ["Example", "Ask a question to replace the example with your own run"],
};

export function Provenance({ kind }) {
  const [label, title] = PROVENANCE[kind];
  return <span className={`prov p-${kind}`} title={title}><i />{label}</span>;
}

export function PageHero({ eyebrow, title, children, stats = [] }) {
  return (
    <section className="hero">
      <div className="hero-glow" aria-hidden="true" />
      <div className="eyebrow">{eyebrow}</div>
      <h2 className="hero-title">{title}</h2>
      <div className="hero-body">{children}</div>
      {stats.length > 0 && (
        <dl className="stats">
          {stats.map(([value, label, cls]) => (
            <div key={label} className={cls}><dt>{label}</dt><dd>{value}</dd></div>
          ))}
        </dl>
      )}
    </section>
  );
}

export function Section({ id, n, icon, title, kind, children }) {
  return (
    <section className="card explain sec" id={id}>
      <header className="sec-head">
        <span className="sn">{String(n).padStart(2, "0")}</span>
        <h3><Icon name={icon} />{title}</h3>
        {kind && <Provenance kind={kind} />}
      </header>
      {children}
    </section>
  );
}

/** Sticky nav with a way back to the assistant; the last section whose top has scrolled past the nav is marked current. */
export function Toc({ items, onBack }) {
  const [current, setCurrent] = useState(items[0]?.[0]);
  useEffect(() => {
    const onScroll = () => {
      let cur = items[0]?.[0];
      for (const [id] of items) { const el = document.getElementById(id); if (el && el.getBoundingClientRect().top <= 140) cur = id; }
      setCurrent(cur);
    };
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, [items]);
  return (
    <nav className="toc" aria-label="Sections">
      <button className="toc-back" type="button" onClick={onBack} title="Back to the assistant">
        <Icon name="chevron-left" />Assistant
      </button>
      {items.map(([id, label], i) => (
        <a key={id} href={`#${id}`} aria-current={current === id ? "true" : undefined}
          onClick={(e) => { e.preventDefault(); document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" }); }}>
          <span>{String(i + 1).padStart(2, "0")}</span>{label}
        </a>
      ))}
    </nav>
  );
}
