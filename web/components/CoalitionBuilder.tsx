"use client";

import { useMemo, useState } from "react";
import { BLOC_NAMES } from "@/lib/format";
import { MAJORITY, coalitionSeats, completions } from "@/lib/coalitions";
import { majorityProbability } from "@/lib/coalitionSim";
import { TOTAL_SEATS } from "@/lib/seats";
import { PartySwatch } from "./ui";

export type CoalitionParty = {
  id: string;
  name: string;
  bloc: string;
  color: string;
  /** Projected seats after the threshold. */
  seats: number;
  /** The poll average before the threshold, for parties that fall below it. */
  average: number;
  passedThreshold: boolean;
  /** Standard deviation of the party's seats in the simulation. */
  spread: number;
  /** Share of simulated elections in which the party clears the threshold. */
  passChance: number;
};

type State = "in" | "open" | "out";

const STATES: { value: State; label: string }[] = [
  { value: "in", label: "בפנים" },
  { value: "open", label: "פתוח" },
  { value: "out", label: "בחוץ" },
];

const SHOWN_COMPLETIONS = 12;

const muted = { color: "color-mix(in srgb, var(--color-text) 60%, transparent)" };

/** A probability as readers can take it: whole percents, and no false 0 or 100. */
function chance(p: number): string {
  if (p < 0.01) return "פחות מ-1%";
  if (p > 0.99) return "יותר מ-99%";
  return `${Math.round(p * 100)}%`;
}

export default function CoalitionBuilder({
  parties,
  draws: encoded,
}: {
  parties: CoalitionParty[];
  /** Simulated seats, row-major n × parties, base64 of a Uint8Array. */
  draws: string;
}) {
  const [state, setState] = useState<Record<string, State>>({});
  const draws = useMemo(() => Uint8Array.from(atob(encoded), (c) => c.charCodeAt(0)), [encoded]);
  const indexOf = useMemo(() => new Map(parties.map((p, i) => [p.id, i])), [parties]);
  const odds = (ids: string[]) =>
    majorityProbability(draws, parties.length, ids.map((id) => indexOf.get(id)!));
  const stateOf = (id: string): State => state[id] ?? "open";

  const seats = useMemo(() => Object.fromEntries(parties.map((p) => [p.id, p.seats])), [parties]);
  const byId = useMemo(() => new Map(parties.map((p) => [p.id, p])), [parties]);
  const included = parties.filter((p) => stateOf(p.id) === "in");
  const excluded = parties.filter((p) => stateOf(p.id) === "out").map((p) => p.id);
  const total = coalitionSeats(seats, included.map((p) => p.id));
  // At most a few thousand subsets: cheap enough to recount on every click.
  const options = completions(seats, included.map((p) => p.id), excluded);

  const set = (ids: string[], value: State) =>
    setState((prev) => ({ ...prev, ...Object.fromEntries(ids.map((id) => [id, value])) }));

  return (
    <div>
      {/* Where the chosen parties stand */}
      <div style={{ marginBottom: "22px" }}>
        <p style={{ margin: 0, fontSize: "30px", fontWeight: 700 }}>
          <span className="ltr-nums">{total}</span> מנדטים{" "}
          <span style={{ fontSize: "16px", fontWeight: 500, ...muted }}>
            {included.length === 0
              ? "— בחר מפלגות לקואליציה"
              : total >= MAJORITY
                ? `— רוב של ${total - 60} מעבר ל-60`
                : `— חסרים ${MAJORITY - total} לרוב`}
          </span>
        </p>
        {included.length > 0 && (
          <p style={{ margin: "2px 0 0", fontSize: "15px" }}>
            סיכוי להגיע ל-61:{" "}
            <strong className="ltr-nums">{chance(odds(included.map((p) => p.id)))}</strong>
          </p>
        )}
        <SeatBar parties={included} total={total} />
        {included.length > 0 && (
          <p style={{ margin: "6px 0 0", fontSize: "13px" }}>
            {included.map((p) => `${p.name} ${p.seats}`).join(" · ")}
          </p>
        )}
      </div>

      <div style={{ display: "flex", gap: "8px", flexWrap: "wrap", marginBottom: "14px" }}>
        <button type="button" className="btn btn-ghost" onClick={() => setState({})}>
          איפוס
        </button>
      </div>

      <div className="scroll-x" style={{ marginBottom: "26px" }}>
        <table className="table" style={{ minWidth: "36rem" }}>
          <thead>
            <tr>
              <th>מפלגה</th>
              <th>גוש</th>
              <th>מנדטים</th>
              <th title="החלק מהבחירות המדומות שבהן המפלגה עוברת את אחוז החסימה">סיכוי לעבור</th>
              <th>בקואליציה?</th>
            </tr>
          </thead>
          <tbody>
            {parties.map((p) => (
              <tr key={p.id}>
                <td>
                  <span style={{ display: "inline-flex", alignItems: "center", gap: "8px" }}>
                    <PartySwatch color={p.color} />
                    {p.name}
                  </span>
                </td>
                <td style={muted}>{BLOC_NAMES[p.bloc] ?? p.bloc}</td>
                <td className="ltr-nums">
                  {p.passedThreshold ? (
                    p.seats
                  ) : (
                    <span style={muted} title="ממוצע הסקרים, לפני אחוז החסימה">
                      0 (מתחת לאחוז החסימה, {p.average.toFixed(1)})
                    </span>
                  )}
                  <span style={{ ...muted, fontSize: "11px" }} title="סטיית התקן בסימולציה">
                    {" "}±{p.spread.toFixed(1)}
                  </span>
                </td>
                <td className="ltr-nums" style={{ whiteSpace: "nowrap", ...(p.passChance > 0.99 ? muted : {}) }}>
                  {chance(p.passChance)}
                </td>
                <td>
                  <div role="radiogroup" aria-label={`${p.name} בקואליציה`} style={{ display: "inline-flex", gap: "4px" }}>
                    {STATES.map((s) => {
                      const active = stateOf(p.id) === s.value;
                      return (
                        <button
                          key={s.value}
                          type="button"
                          role="radio"
                          aria-checked={active}
                          onClick={() => set([p.id], s.value)}
                          className={active ? "btn btn-primary" : "btn btn-secondary"}
                          style={{ padding: "2px 10px", fontSize: "12px" }}
                        >
                          {s.label}
                        </button>
                      );
                    })}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <h3 style={{ fontSize: "20px", margin: "0 0 6px" }}>
        {included.length === 0 ? "קואליציות מינימליות" : "מה חסר כדי להגיע ל-61"}
      </h3>
      <p style={{ margin: "0 0 12px", fontSize: "12px", ...muted }}>
        צירופים של המפלגות הפתוחות שבהם כל מפלגה נחוצה: בלי אחת מהן הרוב אובד. מסומנות
        &quot;בחוץ&quot; לא נכללות.
      </p>
      {total >= MAJORITY ? (
        <p style={{ fontSize: "14px" }}>לבחירה שלך כבר יש רוב.</p>
      ) : options.length === 0 ? (
        <p style={{ fontSize: "14px" }}>שום צירוף של המפלגות הפתוחות לא מגיע ל-61.</p>
      ) : (
        <>
          <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
            {options.slice(0, SHOWN_COMPLETIONS).map((option) => (
              <li
                key={option.members.join()}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "10px",
                  padding: "8px 0",
                  borderBottom: "1px solid var(--color-divider)",
                  flexWrap: "wrap",
                }}
              >
                <span style={{ flex: 1, minWidth: "14rem" }}>
                  {included.length > 0 && "+ "}
                  {option.members.map((id) => byId.get(id)?.name ?? id).join(" + ")}
                </span>
                <span className="ltr-nums" style={{ fontWeight: 700 }}>
                  {option.seats}
                </span>
                <span
                  className="ltr-nums"
                  style={{ minWidth: "7.5rem", fontSize: "13px", ...muted }}
                  title="הסיכוי שהבחירה שלך יחד עם הצירוף הזה תגיע ל-61"
                >
                  סיכוי {chance(odds([...included.map((p) => p.id), ...option.members]))}
                </span>
                <button
                  type="button"
                  className="btn btn-ghost"
                  onClick={() => set(option.members, "in")}
                  aria-label={`צרף ${option.members.map((id) => byId.get(id)?.name ?? id).join(", ")}`}
                >
                  צרף
                </button>
              </li>
            ))}
          </ul>
          {options.length > SHOWN_COMPLETIONS && (
            <p style={{ fontSize: "12px", ...muted }}>
              מוצגים <span className="ltr-nums">{SHOWN_COMPLETIONS}</span> מתוך{" "}
              <span className="ltr-nums">{options.length}</span>. סמן מפלגות &quot;בחוץ&quot; כדי לצמצם.
            </p>
          )}
        </>
      )}
    </div>
  );
}

/** The chosen parties' seats on a 0–120 bar, with the majority line marked. */
function SeatBar({ parties, total }: { parties: CoalitionParty[]; total: number }) {
  return (
    <div
      role="img"
      aria-label={`${total} מנדטים מתוך ${TOTAL_SEATS}; רוב הוא ${MAJORITY}`}
      style={{
        position: "relative",
        height: "18px",
        marginTop: "10px",
        background: "color-mix(in srgb, var(--color-text) 7%, transparent)",
        display: "flex",
      }}
    >
      {parties
        .filter((p) => p.seats > 0)
        .map((p) => (
          <div
            key={p.id}
            title={`${p.name}: ${p.seats}`}
            style={{
              width: `${(p.seats / TOTAL_SEATS) * 100}%`,
              background: p.color,
              borderInlineEnd: "1px solid var(--color-bg)",
            }}
          />
        ))}
      <div
        aria-hidden="true"
        style={{
          position: "absolute",
          insetInlineStart: `${(MAJORITY / TOTAL_SEATS) * 100}%`,
          top: "-4px",
          bottom: "-4px",
          borderInlineStart: "2px solid var(--color-text)",
        }}
      />
      <span
        aria-hidden="true"
        className="ltr-nums"
        style={{
          position: "absolute",
          insetInlineStart: `calc(${(MAJORITY / TOTAL_SEATS) * 100}% + 4px)`,
          top: "20px",
          fontSize: "11px",
        }}
      >
        61
      </span>
    </div>
  );
}
