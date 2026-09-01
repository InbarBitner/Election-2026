import { BLOC_NAMES } from "@/lib/format";
import { THRESHOLD, TOTAL_SEATS, type SeatProjection } from "@/lib/seats";
import type { PartyRow } from "@/lib/queries";
import { PartySwatch, TrendPill } from "./ui";

type Props = {
  parties: PartyRow[];
  projections: SeatProjection[];
  averages: Map<string, { mean: number }>;
  changes: Map<string, number>;
  blocSeats: { bloc: string; seats: number }[];
};

/**
 * Seats are shown as a bar per party rather than as a Knesset semicircle: the
 * question a reader has is "how many, and who is near the threshold", and a
 * ranked bar answers it directly.
 */
export default function SeatProjectionTable({
  parties,
  projections,
  averages,
  changes,
  blocSeats,
}: Props) {
  const byId = new Map(parties.map((p) => [p.id, p]));
  const ranked = [...projections].sort(
    (a, b) => b.seats - a.seats || b.share - a.share,
  );
  const max = Math.max(...ranked.map((p) => p.seats), 1);
  const thresholdSeats = THRESHOLD * TOTAL_SEATS;

  const passed = ranked.filter((p) => p.passedThreshold);
  const failed = ranked.filter((p) => !p.passedThreshold);

  return (
    <div>
      <ol style={{ listStyle: "none", padding: 0, margin: 0 }}>
        {passed.map((projection) => {
          const party = byId.get(projection.partyId);
          if (!party) return null;
          const average = averages.get(projection.partyId)?.mean ?? 0;
          return (
            <li
              key={projection.partyId}
              style={{
                display: "grid",
                gridTemplateColumns: "minmax(7rem, 10rem) 1fr auto",
                gap: "0.6rem",
                alignItems: "center",
                padding: "0.35rem 0",
              }}
            >
              <span
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "0.45rem",
                  fontSize: "0.88rem",
                  minWidth: 0,
                }}
              >
                <PartySwatch color={party.color} />
                <span
                  style={{
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                  }}
                >
                  {party.name}
                </span>
              </span>

              <span
                style={{
                  background: "var(--surface-sunken)",
                  borderRadius: "0 4px 4px 0",
                  height: "0.85rem",
                  position: "relative",
                }}
              >
                <span
                  style={{
                    display: "block",
                    width: `${(projection.seats / max) * 100}%`,
                    height: "100%",
                    background: party.color,
                    borderRadius: "4px 0 0 4px",
                  }}
                />
              </span>

              <span
                style={{
                  display: "flex",
                  gap: "0.6rem",
                  alignItems: "baseline",
                  fontSize: "0.85rem",
                  whiteSpace: "nowrap",
                }}
              >
                <strong className="ltr-nums">{projection.seats}</strong>
                <span className="ltr-nums" style={{ color: "var(--ink-muted)" }}>
                  ({average.toFixed(1)})
                </span>
                <TrendPill change={changes.get(projection.partyId) ?? 0} />
              </span>
            </li>
          );
        })}
      </ol>

      {failed.length > 0 && (
        <div
          style={{
            marginTop: "0.9rem",
            paddingTop: "0.8rem",
            borderTop: "1px dashed var(--border-strong)",
          }}
        >
          <p
            style={{
              margin: "0 0 0.4rem",
              fontSize: "0.82rem",
              color: "var(--ink-muted)",
            }}
          >
            מתחת לאחוז החסימה ({(THRESHOLD * 100).toFixed(2)}% ≈{" "}
            <span className="ltr-nums">{thresholdSeats.toFixed(1)}</span> מנדטים) —
            אינן מקבלות מנדטים, וקולותיהן מתחלקים בין שאר הרשימות:
          </p>
          <ul
            style={{
              listStyle: "none",
              padding: 0,
              margin: 0,
              display: "flex",
              flexWrap: "wrap",
              gap: "0.5rem 1.1rem",
            }}
          >
            {failed.map((projection) => {
              const party = byId.get(projection.partyId);
              if (!party) return null;
              return (
                <li
                  key={projection.partyId}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: "0.4rem",
                    fontSize: "0.83rem",
                    color: "var(--ink-secondary)",
                  }}
                >
                  <PartySwatch color={party.color} size={8} />
                  {party.name}
                  <span className="ltr-nums" style={{ color: "var(--ink-muted)" }}>
                    {(averages.get(projection.partyId)?.mean ?? 0).toFixed(1)}
                  </span>
                </li>
              );
            })}
          </ul>
        </div>
      )}

      <div
        style={{
          marginTop: "1.1rem",
          paddingTop: "0.8rem",
          borderTop: "1px solid var(--border)",
          display: "flex",
          flexWrap: "wrap",
          gap: "0.5rem 1.4rem",
          fontSize: "0.85rem",
        }}
      >
        {blocSeats.map((bloc) => (
          <span key={bloc.bloc}>
            <span style={{ color: "var(--ink-muted)" }}>
              {BLOC_NAMES[bloc.bloc] ?? bloc.bloc}:{" "}
            </span>
            <strong className="ltr-nums">{bloc.seats}</strong>
          </span>
        ))}
      </div>
    </div>
  );
}
