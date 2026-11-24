import { motion } from "motion/react";
import { useState } from "react";
import { Icon } from "../icons.jsx";
import { asQuestion, topicHue, topicIcon } from "../sources.js";

const fmt = (n) => Number(n || 0).toLocaleString("en-US");
const FEATURES = [
  ["shield-check", "Guarded before anything runs", "Arbiter scores every question; injections and off-topic requests are refused before search."],
  ["quote", "Every claim is cited", "Numbered citations link to the exact passage, and answers that cite nothing real are replaced."],
  ["languages", "English and Arabic", "Ask in either language; hybrid search matches meaning across both and answers in yours."],
];

/** Example questions built from the indexed topics, plus one in Arabic. */
function examples(topics) {
  const pick = (names) => names.find((n) => topics.includes(n));
  const chosen = [pick(["Generative AI", "Large language model"]), pick(["AI agents", "Agentic AI"]), pick(["Deep learning", "Machine learning"])]
    .filter(Boolean);
  const en = (chosen.length ? chosen : topics.slice(0, 3)).map(asQuestion);
  return [...en, "ما هو التعلم العميق؟"];
}

/** First screen: headline, live index stats, the composer (passed in), example questions, topics and features. */
export function Welcome({ info, composer, onAsk, onTopic }) {
  const [all, setAll] = useState(false);
  const topics = info?.topics ?? [];
  const shown = all ? topics : topics.slice(0, 8);
  return (
    <div className="welcome">
      <motion.section className="hero-ask" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.45, ease: "easeOut" }}>
        <div className="hero-badge">
          <i className="dot t-ok" />
          {info?.documents ? <>{fmt(info.documents)} documents · {fmt(info.chunks)} passages indexed</> : "Grounded retrieval-augmented answers"}
        </div>
        <h1>Answers you can <em>trace</em><br />back to the source.</h1>
        <p>Ask in English or Arabic. Every answer is written only from your documents, with each claim cited and checked before you see it.</p>
        {composer}
        {topics.length > 0 && (
          <div className="try">
            <span>Try</span>
            {examples(topics).map((q) => (
              <button key={q} type="button" dir="auto" onClick={() => onAsk(q)}>{q}</button>
            ))}
          </div>
        )}
      </motion.section>

      {topics.length > 0 && (
        <section className="topics-sec" aria-label="Topics in the index">
          <div className="sec-row">
            <h2>Explore the knowledge base</h2>
            <span>{topics.length} topics</span>
          </div>
          <div className="topic-grid">
            {shown.map((t, i) => (
              <motion.button key={t} type="button" className="topic" onClick={() => onTopic(t)}
                initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: Math.min(i, 12) * 0.025, duration: 0.3 }}>
                <span className={`tile hue-${topicHue(t)}`}><Icon name={topicIcon(t)} /></span>
                <span className="topic-name">{t}</span>
                <Icon name="arrow-up-right" />
              </motion.button>
            ))}
          </div>
          {topics.length > 8 && (
            <button type="button" className="more-topics" onClick={() => setAll(!all)}>
              {all ? "Show fewer" : `Show all ${topics.length} topics`}<Icon name="chevron-down" />
            </button>
          )}
        </section>
      )}

      <section className="features" aria-label="How answers are made">
        {FEATURES.map(([icon, title, text]) => (
          <div key={title} className="feature">
            <span className="feature-ico"><Icon name={icon} size="" /></span>
            <b>{title}</b>
            <p>{text}</p>
          </div>
        ))}
      </section>
    </div>
  );
}

/** A quiet inline message, e.g. when a search finds nothing. */
export function Notice({ icon = "search", children }) {
  return <div className="notice"><Icon name={icon} size="" /><p>{children}</p></div>;
}
