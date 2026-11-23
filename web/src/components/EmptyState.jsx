import { Icon } from "../icons.jsx";

function Illustration() {
  return (
    <svg className="art" viewBox="0 0 150 100" aria-hidden="true" fill="none" strokeLinecap="round" strokeLinejoin="round">
      <rect x="18" y="22" width="62" height="68" rx="8" fill="var(--sunken)" stroke="var(--line)" strokeWidth="1.5" />
      <path d="M30 40h38M30 50h30M30 60h34M30 70h22" stroke="var(--faint)" strokeWidth="2.5" />
      <rect x="62" y="12" width="70" height="44" rx="10" fill="var(--accent-soft)" stroke="var(--accent)" strokeWidth="1.5" />
      <path d="M74 28h40M74 38h28" stroke="var(--accent)" strokeWidth="2.5" />
      <rect x="114" y="34" width="12" height="7" rx="3" fill="var(--accent)" />
      <circle cx="104" cy="76" r="13" fill="var(--surface)" stroke="var(--accent)" strokeWidth="2" />
      <path d="M113.5 85.5l9 9" stroke="var(--accent)" strokeWidth="3" />
    </svg>
  );
}

/** Shown before the first question; topic chips come from the indexed sources and only fill the box. */
export function EmptyState({ topics, onTopic, message }) {
  return (
    <div className="empty">
      {!message && <Illustration />}
      <p>
        {message ?? <>Answers are written only from the indexed documents, with citations like <code>[doc_id#n]</code> that
          link to the exact passages used. <b>Search only</b> shows the raw passages without calling any model.</>}
      </p>
      {!message && topics.length > 0 && (
        <div className="topics">
          {topics.map((t) => (
            <button key={t} type="button" onClick={() => onTopic(t)}><Icon name="tag" />{t}</button>
          ))}
        </div>
      )}
    </div>
  );
}
