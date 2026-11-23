import { Icon } from "../icons.jsx";

const PAGES = [["ask", "home", "Assistant"], ["how", "route", "How it works"], ["inference", "layers", "Inside inference"],
  ["space", "globe", "Enter the system"]];
const CLASSES = { ask: "home", space: "enter" };
const fmt = (n) => Number(n || 0).toLocaleString("en-US");

function Pill({ icon, label, value, on = true }) {
  return (
    <span className={`pill ${on ? "on" : "off"}`}>
      <Icon name={icon} />
      {label} <b>{value}</b>
    </span>
  );
}

/** One toggle group above the header: Assistant is the main page; pressing an open page again also returns there. */
function PageBar({ page, onPage }) {
  return (
    <nav className="pagebar" aria-label="Pages">
      <div className="seg">
        {PAGES.map(([id, icon, label]) => (
          <button key={id} type="button" className={CLASSES[id]} aria-pressed={page === id}
            onClick={() => onPage(page === id ? "ask" : id)} title={id === "ask" ? "Back to the assistant" : label}>
            {id === "space" && <i className="pulse" aria-hidden="true" />}
            <Icon name={icon} /><span className="label">{label}</span>
            {id === "space" && <span className="tag">3D</span>}
          </button>
        ))}
      </div>
    </nav>
  );
}

export function Header({ info, error, dark, onToggleTheme, page, onPage }) {
  return (
    <>
      <PageBar page={page} onPage={onPage} />
      <header>
        <div className="logo" aria-hidden="true"><Icon name="book" size="" /></div>
        <h1>Knowledge Assistant<span dir="rtl">المساعد المعرفي</span></h1>
        <button className="theme" type="button" onClick={onToggleTheme} aria-label="Toggle light or dark theme" title="Toggle theme">
          <Icon name={dark ? "sun" : "moon"} size="" />
        </button>
      </header>
      <div className="pills">
        {error && <span className="pill off"><Icon name="alert" />Server not reachable</span>}
        {!error && !info && <span className="pill"><Icon name="database" />Loading index…</span>}
        {info && !info.documents && <span className="pill off"><Icon name="database" />Index is empty. Run <b>python rag.py ingest</b></span>}
        {info?.documents > 0 && (
          <>
            <Pill icon="database" label="Index" value={`${info.documents} docs · ${fmt(info.chunks)} chunks`} />
            <Pill icon="layers" label="Embeddings" value={info.model.split("/").pop()} />
            <Pill icon="cpu" label="Answers" value={info.llm ?? "not configured"} on={!!info.llm} />
            <Pill icon="shield" label="Guard" value={info.judge ?? "not configured"} on={!!info.judge} />
            <Pill icon="activity" label="Tracing" value={info.tracing ?? "off"} on={!!info.tracing} />
          </>
        )}
      </div>
    </>
  );
}
