"use client";

import { useState } from "react";
import Link from "next/link";
import { AXIS_NAMES, BLOC_NAMES } from "@/lib/format";

export type Question = {
  id: string;
  order: number;
  axis: string;
  text: string;
  shortLabel: string;
};

type Answer = { value: number; important: boolean };

type MatchResponse = {
  answered: number;
  totalQuestions: number;
  parties: {
    id: string;
    name: string;
    slug: string;
    color: string;
    colorDark: string;
    bloc: string;
    score: number;
    projectedSeats: number;
    agreements: { axis: string; label: string; contribution: number }[];
    disagreements: { axis: string; label: string; contribution: number }[];
  }[];
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

export default function QuizWizard({ questions }: { questions: Question[] }) {
  const [answers, setAnswers] = useState<Record<string, Answer>>(() => {
    // Answers live only in the reader's own browser — they are never stored
    // on the server, and the scoring request keeps nothing.
    if (typeof window === "undefined") return {};
    try {
      const saved = window.localStorage.getItem(STORAGE_KEY);
      return saved ? (JSON.parse(saved) as Record<string, Answer>) : {};
    } catch {
      return {};
    }
  });
  const [result, setResult] = useState<MatchResponse | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const answered = Object.keys(answers).length;

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

  const grouped = groupByAxis(questions);

  return (
    <div>
      <div
        style={{
          position: "sticky",
          top: 0,
          background: "var(--color-bg)",
          padding: "0.6rem 0",
          borderBottom: "1px solid var(--color-divider)",
          marginBottom: "1rem",
          zIndex: 5,
        }}
      >
        <div style={{ display: "flex", justifyContent: "space-between", fontSize: "0.85rem" }}>
          <span>
            נענו <span className="ltr-nums">{answered}</span> מתוך{" "}
            <span className="ltr-nums">{questions.length}</span>
          </span>
          {answered > 0 && (
            <button
              type="button"
              onClick={reset}
              style={{
                border: "none",
                background: "transparent",
                color: "color-mix(in srgb, var(--color-text) 55%, transparent)",
                cursor: "pointer",
                font: "inherit",
                fontSize: "0.82rem",
              }}
            >
              איפוס
            </button>
          )}
        </div>
        <div
          style={{
            height: "0.3rem",
            background: "color-mix(in srgb, var(--color-text) 6%, transparent)",
            borderRadius: "4px",
            marginTop: "0.4rem",
          }}
        >
          <div
            style={{
              width: `${(answered / questions.length) * 100}%`,
              height: "100%",
              background: "var(--color-accent)",
              borderRadius: "4px",
            }}
          />
        </div>
      </div>

      {grouped.map(([axis, axisQuestions]) => (
        <section key={axis} style={{ marginBottom: "1.8rem" }}>
          <h2 style={{ fontSize: "1rem", marginBottom: "0.7rem" }}>
            {AXIS_NAMES[axis] ?? axis}
          </h2>
          {axisQuestions.map((question) => {
            const answer = answers[question.id];
            return (
              <fieldset
                key={question.id}
                style={{
                  border: "1px solid var(--color-divider)",
                  borderRadius: 0,
                  padding: "0.8rem 1rem",
                  marginBottom: "0.7rem",
                  background: "var(--color-bg)",
                }}
              >
                <legend style={{ fontSize: "0.9rem", padding: "0 0.3rem" }}>
                  {question.text}
                </legend>
                <div
                  style={{
                    display: "flex",
                    flexWrap: "wrap",
                    gap: "0.35rem",
                    marginTop: "0.4rem",
                  }}
                >
                  {SCALE.map((option) => {
                    const selected = answer?.value === option.value;
                    return (
                      <button
                        key={option.value}
                        type="button"
                        onClick={() => setValue(question.id, option.value)}
                        aria-pressed={selected}
                        style={{
                          border: `1px solid ${
                            selected ? "var(--color-accent)" : "var(--color-divider)"
                          }`,
                          background: selected ? "var(--tag-accent-bg)" : "transparent",
                          color: selected ? "var(--color-accent)" : "color-mix(in srgb, var(--color-text) 75%, transparent)",
                          borderRadius: 0,
                          padding: "0.3rem 0.65rem",
                          fontSize: "0.82rem",
                          cursor: "pointer",
                          font: "inherit",
                        }}
                      >
                        {option.label}
                      </button>
                    );
                  })}
                  {answer && (
                    <label
                      style={{
                        display: "inline-flex",
                        alignItems: "center",
                        gap: "0.35rem",
                        fontSize: "0.8rem",
                        color: "color-mix(in srgb, var(--color-text) 55%, transparent)",
                        marginInlineStart: "0.4rem",
                      }}
                    >
                      <input
                        type="checkbox"
                        checked={answer.important}
                        onChange={() => toggleImportant(question.id)}
                      />
                      חשוב לי במיוחד
                    </label>
                  )}
                </div>
              </fieldset>
            );
          })}
        </section>
      ))}

      {error && (
        <p style={{ color: "var(--color-warning)", fontSize: "0.85rem" }}>{error}</p>
      )}

      <button
        type="button"
        onClick={submit}
        disabled={answered === 0 || busy}
        style={{
          background: answered === 0 ? "var(--color-divider)" : "var(--color-accent)",
          color: "#fff",
          border: "none",
          borderRadius: 0,
          padding: "0.6rem 1.4rem",
          fontSize: "0.95rem",
          cursor: answered === 0 ? "not-allowed" : "pointer",
          font: "inherit",
        }}
      >
        {busy ? "מחשב…" : "הצג את ההתאמה שלי"}
      </button>
      {answered > 0 && answered < questions.length && (
        <p style={{ fontSize: "0.8rem", color: "color-mix(in srgb, var(--color-text) 55%, transparent)", marginTop: "0.5rem" }}>
          אפשר לחשב גם בלי לענות על הכול — שאלות שלא נענו פשוט לא נספרות.
        </p>
      )}
    </div>
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
      <div
        style={{
          background: "var(--color-bg)",
          border: "1px solid var(--color-divider)",
          borderRadius: 0,
          padding: "1.2rem",
          marginBottom: "1.2rem",
        }}
      >
        <p style={{ margin: 0, color: "color-mix(in srgb, var(--color-text) 55%, transparent)", fontSize: "0.85rem" }}>
          ההתאמה הגבוהה ביותר על בסיס{" "}
          <span className="ltr-nums">{result.answered}</span> תשובות
        </p>
        <p style={{ margin: "0.3rem 0 0", fontSize: "1.5rem", fontWeight: 700 }}>
          {best.name}{" "}
          <span className="ltr-nums" style={{ color: "var(--color-accent)" }}>
            {best.score}%
          </span>
        </p>
      </div>

      <h2 style={{ fontSize: "1.05rem" }}>התאמה לפי מפלגה</h2>
      <ol style={{ listStyle: "none", padding: 0, margin: "0 0 1.5rem" }}>
        {result.parties.map((party) => (
          <li
            key={party.id}
            style={{
              padding: "0.7rem 0",
              borderBottom: "1px solid var(--color-divider)",
            }}
          >
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: "0.6rem",
                flexWrap: "wrap",
              }}
            >
              <span
                aria-hidden="true"
                style={{
                  width: 10,
                  height: 10,
                  borderRadius: 2,
                  background: party.color,
                  flexShrink: 0,
                }}
              />
              {party.slug ? (
                <Link href={`/parties/${party.slug}`} style={{ fontWeight: 600 }}>
                  {party.name}
                </Link>
              ) : (
                <strong>{party.name}</strong>
              )}
              <span
                className="ltr-nums"
                style={{ marginInlineStart: "auto", fontWeight: 700 }}
              >
                {party.score}%
              </span>
            </div>

            <div
              style={{
                height: "0.4rem",
                background: "color-mix(in srgb, var(--color-text) 6%, transparent)",
                borderRadius: "4px",
                margin: "0.4rem 0",
              }}
            >
              <div
                style={{
                  width: `${party.score}%`,
                  height: "100%",
                  background: party.color,
                  borderRadius: "4px",
                }}
              />
            </div>

            {/* The explanation is the point: a bare percentage is not an answer. */}
            <div style={{ fontSize: "0.8rem", color: "color-mix(in srgb, var(--color-text) 75%, transparent)" }}>
              {party.agreements.length > 0 && (
                <div>
                  <span style={{ color: "color-mix(in srgb, var(--color-text) 55%, transparent)" }}>מסכימים בעיקר על: </span>
                  {party.agreements.map((a) => a.label).join(", ")}
                </div>
              )}
              {party.disagreements.length > 0 && (
                <div>
                  <span style={{ color: "color-mix(in srgb, var(--color-text) 55%, transparent)" }}>חלוקים בעיקר על: </span>
                  {party.disagreements.map((a) => a.label).join(", ")}
                </div>
              )}
            </div>
          </li>
        ))}
      </ol>

      {result.blocs.length > 0 && (
        <>
          <h2 style={{ fontSize: "1.05rem" }}>התאמה לפי גוש</h2>
          <p style={{ fontSize: "0.82rem", color: "color-mix(in srgb, var(--color-text) 55%, transparent)", marginTop: 0 }}>
            ממוצע ההתאמה למפלגות הגוש, משוקלל לפי המנדטים החזויים שלהן.
          </p>
          <ul style={{ listStyle: "none", padding: 0, margin: "0 0 1.5rem" }}>
            {result.blocs.map((bloc) => (
              <li
                key={bloc.bloc}
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  padding: "0.4rem 0",
                  borderBottom: "1px solid var(--color-divider)",
                  fontSize: "0.9rem",
                }}
              >
                <span>{BLOC_NAMES[bloc.bloc] ?? bloc.bloc}</span>
                <strong className="ltr-nums">{bloc.score}%</strong>
              </li>
            ))}
          </ul>
        </>
      )}

      <p
        style={{
          background: "color-mix(in srgb, var(--color-text) 6%, transparent)",
          border: "1px solid var(--color-divider)",
          borderRadius: 0,
          padding: "0.8rem 1rem",
          fontSize: "0.83rem",
          color: "color-mix(in srgb, var(--color-text) 75%, transparent)",
        }}
      >
        ההתאמה מחושבת כדמיון קוסינוס בין העמדות שסימנת לבין וקטור העמדות של כל
        מפלגה, שנבנה ממצעה המפורסם. זהו כלי עזר להתמצאות — לא המלצה למי להצביע,
        ואינו מביא בחשבון שיקולים קואליציוניים, אמון אישי או סוגיות שלא נכללו בשאלון.
      </p>

      <button
        type="button"
        onClick={onRestart}
        style={{
          marginTop: "1rem",
          border: "1px solid var(--color-divider)",
          background: "transparent",
          color: "color-mix(in srgb, var(--color-text) 75%, transparent)",
          borderRadius: 0,
          padding: "0.5rem 1rem",
          cursor: "pointer",
          font: "inherit",
          fontSize: "0.88rem",
        }}
      >
        למלא מחדש
      </button>
    </div>
  );
}

function groupByAxis(questions: Question[]): [string, Question[]][] {
  const groups = new Map<string, Question[]>();
  for (const question of [...questions].sort((a, b) => a.order - b.order)) {
    const list = groups.get(question.axis) ?? [];
    list.push(question);
    groups.set(question.axis, list);
  }
  return [...groups.entries()];
}
