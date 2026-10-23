"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { AXIS_NAMES, BLOC_NAMES } from "@/lib/format";
import { Panel, SectionTitle } from "@/components/ui";

export type Question = {
  id: string;
  order: number;
  axis: string;
  text: string;
  shortLabel: string;
};

type Answer = { value: number; important: boolean };

type Reason = {
  questionId: string;
  label: string;
  contribution: number;
  evidence?: {
    kind: "platform" | "bill" | "statement";
    text: string;
    url?: string;
    status?: string;
    speaker?: string;
    date?: string;
  };
};

type PartyMatch = {
  id: string;
  name: string;
  slug: string;
  color: string;
  colorDark: string;
  bloc: string;
  score: number;
  /** Answered questions the party has a known position on. */
  shared: number;
  projectedSeats: number;
  agreements: Reason[];
  disagreements: Reason[];
};

type MatchResponse = {
  answered: number;
  totalQuestions: number;
  parties: PartyMatch[];
  blocs: { bloc: string; score: number }[];
};

const SCALE = [
  { value: 1, label: "מתנגד/ת בהחלט" },
  { value: 2, label: "נוטה להתנגד" },
  { value: 3, label: "אין לי עמדה" },
  { value: 4, label: "נוטה להסכים" },
  { value: 5, label: "מסכים/ה בהחלט" },
];

const STORAGE_KEY = "election2026:quiz";

/** How many parties the results show in full; the rest open on tap. */
const EXPANDED_PARTIES = 3;

export default function QuizWizard({ questions }: { questions: Question[] }) {
  const ordered = [...questions].sort((a, b) => a.order - b.order);
  const [answers, setAnswers] = useState<Record<string, Answer>>({});
  const [step, setStep] = useState(0);
  useEffect(() => {
    // Answers live only in the reader's own browser — they are never stored
    // on the server, and the scoring request keeps nothing. They are read
    // after the first render: reading them during it made the server's HTML
    // (no answers) disagree with the browser's, and React threw a hydration
    // error whenever answers had been saved.
    try {
      const saved = window.localStorage.getItem(STORAGE_KEY);
      if (saved) {
        const parsed = JSON.parse(saved) as Record<string, Answer>;
        setAnswers(parsed);
        // A returning reader picks up at the first question they left open.
        const next = ordered.findIndex((q) => !parsed[q.id]);
        setStep(next === -1 ? ordered.length - 1 : next);
      }
    } catch {
      // Storage blocked or corrupt: start empty.
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const [result, setResult] = useState<MatchResponse | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const answered = Object.keys(answers).length;
  const question = ordered[step];
  const answer = answers[question.id];
  const isLast = step === ordered.length - 1;

  function persist(next: Record<string, Answer>) {
    setAnswers(next);
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    } catch {
      // A browser with storage disabled still works, it just does not remember.
    }
  }

  function setValue(id: string, value: number) {
    persist({ ...answers, [id]: { value, important: answers[id]?.important ?? false } });
  }

  function toggleImportant(id: string) {
    const current = answers[id];
    if (!current) return;
    persist({ ...answers, [id]: { ...current, important: !current.important } });
  }

  function reset() {
    persist({});
    setStep(0);
    setResult(null);
    setError(null);
  }

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch("/api/match", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ answers }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error ?? "שגיאה");
      setResult(payload as MatchResponse);
      window.scrollTo({ top: 0, behavior: "smooth" });
    } catch (exception) {
      setError(exception instanceof Error ? exception.message : "החישוב נכשל");
    } finally {
      setBusy(false);
    }
  }

  if (result) {
    return <Results result={result} onRestart={reset} />;
  }

  return (
    <Panel>
      <div
        className="text-muted"
        style={{ display: "flex", justifyContent: "space-between", gap: "1rem", fontSize: "13px" }}
      >
        <span>
          שאלה <span className="ltr-nums">{step + 1}</span> מתוך{" "}
          <span className="ltr-nums">{ordered.length}</span> · {AXIS_NAMES[question.axis] ?? question.axis}
        </span>
        <span>
          נענו <span className="ltr-nums">{answered}</span>
          {answered > 0 && (
            <>
              {" · "}
              <button type="button" onClick={reset} className="link-button">
                איפוס
              </button>
            </>
          )}
        </span>
      </div>

      {/* One mark per question: filled when answered, ringed when current.
          The shape carries the state, not only the colour, and each mark
          jumps to its question. */}
      <nav aria-label="מעבר בין השאלות" style={{ display: "flex", flexWrap: "wrap", gap: "4px", margin: "10px 0 22px" }}>
        {ordered.map((q, i) => {
          const done = Boolean(answers[q.id]);
          const current = i === step;
          return (
            <button
              key={q.id}
              type="button"
              onClick={() => setStep(i)}
              aria-label={`שאלה ${i + 1}${done ? ", נענתה" : ""}`}
              aria-current={current ? "step" : undefined}
              style={{
                width: "16px",
                height: "6px",
                padding: 0,
                borderRadius: "3px",
                cursor: "pointer",
                border: current ? "1.5px solid var(--color-text)" : "1px solid var(--color-divider)",
                background: done ? "var(--color-accent)" : "transparent",
              }}
            />
          );
        })}
      </nav>

      <fieldset style={{ border: "none", padding: 0, margin: 0 }}>
        <legend style={{ fontSize: "22px", fontWeight: 600, lineHeight: 1.35, padding: 0 }}>
          {question.text}
        </legend>
        <div style={{ display: "flex", flexWrap: "wrap", gap: "8px", marginTop: "18px" }}>
          {SCALE.map((option) => {
            const selected = answer?.value === option.value;
            return (
              <button
                key={option.value}
                type="button"
                className="btn"
                onClick={() => setValue(question.id, option.value)}
                aria-pressed={selected}
                style={
                  selected
                    ? {
                        borderColor: "var(--color-accent)",
                        background: "var(--tag-accent-bg)",
                        color: "var(--color-accent)",
                        fontWeight: 600,
                      }
                    : undefined
                }
              >
                {option.label}
              </button>
            );
          })}
        </div>
        <label
          className="text-muted"
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: "6px",
            fontSize: "13px",
            marginTop: "14px",
            visibility: answer ? "visible" : "hidden",
          }}
        >
          <input
            type="checkbox"
            checked={answer?.important ?? false}
            onChange={() => toggleImportant(question.id)}
            disabled={!answer}
          />
          חשוב לי במיוחד
        </label>
      </fieldset>

      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          gap: "8px",
          flexWrap: "wrap",
          marginTop: "22px",
          paddingTop: "16px",
          borderTop: "1px solid var(--color-divider)",
        }}
      >
        <button
          type="button"
          className="btn btn-secondary"
          onClick={() => setStep(step - 1)}
          disabled={step === 0}
        >
          → הקודם
        </button>
        <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
          {!isLast && answered > 0 && (
            <button type="button" className="btn btn-ghost" onClick={submit} disabled={busy}>
              {busy ? "מחשב…" : "הצג תוצאה עכשיו"}
            </button>
          )}
          {isLast ? (
            <button
              type="button"
              className="btn btn-primary"
              onClick={submit}
              disabled={answered === 0 || busy}
            >
              {busy ? "מחשב…" : "הצג את ההתאמה שלי"}
            </button>
          ) : (
            <button
              type="button"
              className={answer ? "btn btn-primary" : "btn btn-secondary"}
              onClick={() => setStep(step + 1)}
            >
              {answer ? "הבא ←" : "דלג ←"}
            </button>
          )}
        </div>
      </div>

      {error && (
        <p style={{ color: "var(--color-warning)", fontSize: "13px", margin: "12px 0 0" }}>{error}</p>
      )}
      {isLast && answered > 0 && answered < ordered.length && (
        <p className="text-muted" style={{ fontSize: "13px", margin: "12px 0 0" }}>
          שאלות שלא נענו פשוט לא נספרות.
        </p>
      )}
    </Panel>
  );
}

function Results({
  result,
  onRestart,
}: {
  result: MatchResponse;
  onRestart: () => void;
}) {
  const best = result.parties[0];
  return (
    <div>
      <Panel style={{ marginBottom: "20px" }}>
        <p className="text-muted" style={{ margin: 0, fontSize: "13px" }}>
          ההתאמה הגבוהה ביותר, על בסיס <span className="ltr-nums">{result.answered}</span> תשובות
        </p>
        <p style={{ margin: "6px 0 0", fontSize: "28px", fontWeight: 700 }}>
          {best.name}{" "}
          <span className="ltr-nums" style={{ color: "var(--color-accent)" }}>
            {best.score}%
          </span>
        </p>
        <p className="text-muted" style={{ margin: "8px 0 0", fontSize: "13px" }}>
          <strong>כלי עזר להתמצאות, לא המלצה למי להצביע.</strong>
        </p>
      </Panel>

      <Panel style={{ marginBottom: "20px" }}>
        <SectionTitle hint="לחיצה על נושא מציגה את המקור לעמדת המפלגה.">התאמה לפי מפלגה</SectionTitle>
        <ol style={{ listStyle: "none", padding: 0, margin: 0 }}>
          {result.parties.map((party, i) => (
            <PartyRow key={party.id} party={party} expanded={i < EXPANDED_PARTIES} />
          ))}
        </ol>
      </Panel>

      {result.blocs.length > 0 && (
        <Panel style={{ marginBottom: "20px" }}>
          <SectionTitle hint="ממוצע ההתאמה למפלגות הגוש, משוקלל לפי המנדטים החזויים שלהן.">
            התאמה לפי גוש
          </SectionTitle>
          <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
            {result.blocs.map((bloc) => (
              <li
                key={bloc.bloc}
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  padding: "8px 0",
                  borderBottom: "1px solid var(--color-divider)",
                  fontSize: "15px",
                }}
              >
                <span>{BLOC_NAMES[bloc.bloc] ?? bloc.bloc}</span>
                <strong className="ltr-nums">{bloc.score}%</strong>
              </li>
            ))}
          </ul>
        </Panel>
      )}

      <button type="button" className="btn btn-secondary" onClick={onRestart}>
        למלא מחדש
      </button>
    </div>
  );
}

/**
 * One party in the results. The leading parties show why they scored as they
 * did; the rest keep that behind a tap, so the list stays short. The
 * explanation is the point: a bare percentage is not an answer.
 */
function PartyRow({ party, expanded }: { party: PartyMatch; expanded: boolean }) {
  const [open, setOpen] = useState(expanded);
  const hasReasons = party.agreements.length + party.disagreements.length > 0;

  return (
    <li style={{ padding: expanded ? "12px 0" : "8px 0", borderBottom: "1px solid var(--color-divider)" }}>
      <div style={{ display: "flex", alignItems: "center", gap: "10px", flexWrap: "wrap" }}>
        <span
          aria-hidden="true"
          style={{ width: 10, height: 10, borderRadius: 2, background: party.color, flexShrink: 0 }}
        />
        {party.slug ? (
          <Link href={`/parties/${party.slug}`} style={{ fontWeight: 600 }}>
            {party.name}
          </Link>
        ) : (
          <strong>{party.name}</strong>
        )}
        {!expanded && hasReasons && (
          <button
            type="button"
            className="link-button"
            onClick={() => setOpen(!open)}
            aria-expanded={open}
            style={{ fontSize: "12px" }}
          >
            {open ? "הסתר" : "למה?"}
          </button>
        )}
        <span className="ltr-nums" style={{ marginInlineStart: "auto", fontWeight: 700 }}>
          {party.score}%
        </span>
      </div>

      <div
        style={{
          height: expanded ? "6px" : "4px",
          background: "color-mix(in srgb, var(--color-text) 6%, transparent)",
          borderRadius: "4px",
          margin: "6px 0",
        }}
      >
        <div
          style={{ width: `${party.score}%`, height: "100%", background: party.color, borderRadius: "4px" }}
        />
      </div>

      {open && (
        <div style={{ fontSize: "13px", color: "color-mix(in srgb, var(--color-text) 75%, transparent)" }}>
          <div className="text-muted">
            {party.shared === 0 ? (
              "אין לנו מידע על עמדות המפלגה בשאלות שענית עליהן"
            ) : (
              <>
                על סמך <span className="ltr-nums">{party.shared}</span>{" "}
                {party.shared === 1 ? "שאלה" : "שאלות"} שידועה בהן עמדת המפלגה
              </>
            )}
          </div>
          <Reasons title="מסכימים בעיקר על" reasons={party.agreements} />
          <Reasons title="חלוקים בעיקר על" reasons={party.disagreements} />
        </div>
      )}
    </li>
  );
}

function evidenceLabel(evidence: NonNullable<Reason["evidence"]>): string {
  if (evidence.kind === "bill") return "הצעת חוק";
  if (evidence.kind === "platform") return "מהמצע";
  const date = evidence.date ? new Date(evidence.date).toLocaleDateString("he-IL") : "";
  return [evidence.speaker, date].filter(Boolean).join(", ");
}

/**
 * The topics behind a score. Each one opens its evidence — the quote, the
 * bill or the statement — on tap rather than on hover, so it can be read on a
 * phone too.
 */
function Reasons({ title, reasons }: { title: string; reasons: Reason[] }) {
  const [open, setOpen] = useState<string | null>(null);
  if (reasons.length === 0) return null;
  const shown = reasons.find((r) => r.questionId === open && r.evidence);

  return (
    <div style={{ marginTop: "0.2rem" }}>
      <span className="text-muted">{title}: </span>
      {reasons.map((r, i) => (
        <span key={r.questionId}>
          {i > 0 && ", "}
          {r.evidence ? (
            <button
              type="button"
              className="link-button"
              onClick={() => setOpen(open === r.questionId ? null : r.questionId)}
              aria-expanded={open === r.questionId}
            >
              {r.label}
            </button>
          ) : (
            r.label
          )}
        </span>
      ))}
      {shown?.evidence && (
        <div
          style={{
            margin: "0.35rem 0 0.2rem",
            padding: "0.5rem 0.7rem",
            borderInlineStart: "3px solid var(--color-divider)",
            background: "color-mix(in srgb, var(--color-text) 4%, transparent)",
          }}
        >
          <div className="text-muted">
            {shown.label} · {evidenceLabel(shown.evidence)}
            {shown.evidence.status && ` · ${shown.evidence.status}`}
          </div>
          <q dir="auto" style={{ display: "block", margin: "0.2rem 0" }}>
            {shown.evidence.text}
          </q>
          {shown.evidence.url && (
            <a href={shown.evidence.url} target="_blank" rel="noopener noreferrer">
              למקור
            </a>
          )}
        </div>
      )}
    </div>
  );
}
