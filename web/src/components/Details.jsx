import { Icon, STEP_ICONS } from "../icons.jsx";
import { FlowDiagram } from "./FlowDiagram.jsx";

const fmt = (n) => Number(n || 0).toLocaleString("en-US");
const RISKY = ["harmful", "prompt_injection"];

function GuardProbabilities({ probs }) {
  const keys = Object.keys(probs);
  if (!keys.length) return <div className="note"><Icon name="info" /><span>No model call: refused by the length check.</span></div>;
  const top = keys.reduce((a, b) => (probs[a] >= probs[b] ? a : b));
  const risk = (probs.harmful || 0) + (probs.prompt_injection || 0);
  return (
    <>
      {keys.map((k) => (
        <div className="prob" key={k}>
          <span>{k.replaceAll("_", " ")}</span>
          <span className="track"><i className={`${k === top ? "top" : ""} ${RISKY.includes(k) && risk >= 0.4 ? "risk" : ""}`}
            style={{ width: `${Math.max(1, probs[k] * 100)}%` }} /></span>
          <span className="num">{probs[k].toFixed(2)}</span>
        </div>
      ))}
      <div className="note"><Icon name="scale" /><span>Risk = P(harmful) + P(prompt injection) = <b>{risk.toFixed(2)}</b>.
        Refused at ≥ 0.40, even when neither is the top class.</span></div>
    </>
  );
}

function Check({ ok, children }) {
  return <li><span className={ok ? "ok" : "bad"}><Icon name={ok ? "check-circle" : "x-circle"} /></span><span>{children}</span></li>;
}

function GroundingChecks({ checks: c }) {
  if (!c?.citations) return <div className="note"><Icon name="minus-circle" /><span>Not run: the question stopped at the guard.</span></div>;
  return (
    <ul className="checks">
      <Check ok={c.citations_ok}>{c.idk ? "Answer is “I don't know”: no citations needed"
        : `Citations: ${c.citations.length} given, ${c.invalid_citations.length} invalid`}</Check>
      <Check ok={c.numbers_ok}>{c.numbers_ok ? "All numbers appear in the cited passages"
        : `Not in cited text: ${c.unsupported_numbers.join(", ")}`}</Check>
      <Check ok={c.lang_ok}>Answer language {c.answer_lang === "ar" ? "Arabic" : "English"}
        {c.lang_ok ? " matches the question" : " differs from the question"}</Check>
    </ul>
  );
}

/** "How this answer was produced": pipeline, plain-language reasons, guard probabilities, checks, run facts. */
export function Details({ result: r }) {
  const u = r.usage || {}, cfg = r.config;
  return (
    <div className="details-body">
      <FlowDiagram result={r} llm={r.config.llm} />
      <ul className="why">
        {r.explanation.map((s) => <li key={s.step}><Icon name={STEP_ICONS[s.step]} /><b>{s.step}</b><span>{s.text}</span></li>)}
      </ul>
      <div className="grid2">
        <div><div className="sub"><Icon name="shield" />Guard classification · Arbiter</div><GuardProbabilities probs={r.guard_probs} /></div>
        <div><div className="sub"><Icon name="check-circle" />Grounding checks · deterministic, no model</div><GroundingChecks checks={r.checks} /></div>
      </div>
      <div className="kv">
        <span><Icon name="clock" />Total <b>{fmt(Math.round(r.timings.total))} ms</b></span>
        <span><Icon name="hash" />Tokens <b>{fmt(u.input_tokens)}</b> in / <b>{fmt(u.output_tokens)}</b> out</span>
        <span><Icon name="cpu" /><b>{cfg.llm}</b></span>
        <span><Icon name="tag" /><b>{cfg.answer_prompt}</b></span>
        <span><Icon name="layers" />top_k <b>{cfg.top_k}</b> · budget <b>{fmt(cfg.context_chars)}</b> chars</span>
        {r.trace_url && (
          <span><Icon name="activity" /><a href={r.trace_url} target="_blank" rel="noopener noreferrer">Open trace in Langfuse</a> (PII masked)</span>
        )}
      </div>
    </div>
  );
}
