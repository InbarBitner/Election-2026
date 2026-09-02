"use client";

import { useEffect, useState } from "react";
import { ELECTION_DATE } from "@/lib/format";
import { Corners, Kicker } from "./ui";

type Unit = { value: number; label: string };

function unitsUntil(target: Date, now: Date): Unit[] {
  const ms = Math.max(0, target.getTime() - now.getTime());
  const seconds = Math.floor(ms / 1000);
  return [
    { value: Math.floor(seconds / 86400), label: "ימים" },
    { value: Math.floor(seconds / 3600) % 24, label: "שעות" },
    { value: Math.floor(seconds / 60) % 60, label: "דקות" },
    { value: seconds % 60, label: "שניות" },
  ];
}

/**
 * Countdown to election day.
 *
 * Rendered on the client and mounted empty, because a server-rendered "now"
 * and the browser's "now" are never the same second — hydrating the live value
 * directly would guarantee a mismatch on every load.
 */
export default function Countdown() {
  const [units, setUnits] = useState<Unit[] | null>(null);

  useEffect(() => {
    const tick = () => setUnits(unitsUntil(ELECTION_DATE, new Date()));
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, []);

  return (
    <div className="blueprint" style={{ padding: "26px 24px" }}>
      <Corners />
      <Kicker>נותרו עד יום הבחירות</Kicker>
      <div
        style={{
          display: "flex",
          alignItems: "stretch",
          border: "1px solid var(--color-divider)",
        }}
      >
        {(units ?? unitsUntil(ELECTION_DATE, ELECTION_DATE)).map((unit, index) => (
          <div
            key={unit.label}
            style={{
              flex: 1,
              padding: "14px 8px",
              textAlign: "center",
              borderInlineStart:
                index === 0 ? undefined : "1px solid var(--color-divider)",
            }}
          >
            <div
              className="num ltr-nums"
              style={{
                fontSize: "40px",
                lineHeight: 1,
                fontWeight: 600,
                // Until the first client tick the figures would read as a row
                // of zeros, which looks like the election already happened.
                visibility: units ? "visible" : "hidden",
              }}
            >
              {String(unit.value).padStart(2, "0")}
            </div>
            <div
              className="text-muted"
              style={{ fontSize: "10px", letterSpacing: "0.1em", marginTop: "6px" }}
            >
              {unit.label}
            </div>
          </div>
        ))}
      </div>
      <p
        className="text-muted"
        style={{ fontSize: "11px", marginTop: "12px", marginBottom: 0, lineHeight: 1.5 }}
      >
        יום הבחירות: 27 באוקטובר 2026.
      </p>
    </div>
  );
}
