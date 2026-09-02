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
 * Seats as a ranked bar per party rather than a Knesset semicircle: the
 * question a reader actually has is "how many, and who is near the threshold",
 * and a ranked bar answers it directly.
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
      <ol
        style={{
          listStyle: "none",
          padding: 0,
          margin: 0,
          borderTop: "1px solid var(--color-divider)",
        }}
      >
        {passed.map((projection) => {
          const party = byId.get(projection.partyId);
          if (!party) return null;
          const average = averages.get(projection.partyId)?.mean ?? 0;
          return (
            <li
              key={projection.partyId}
              style={{
                display: "grid",
                gridTemplateColumns: "minmax(7.5rem, 11rem) 1fr auto",
                gap: "14px",
                alignItems: "center",
                padding: "9px 0",
                borderBottom: "1px solid color-mix(in srgb, var(--color-text) 8%, transparent)",
              }}
            >
              <span
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "8px",
                  fontSize: "14px",
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
                  background: "color-mix(in srgb, var(--color-text) 6%, transparent)",
                  height: "0.7rem",
                  position: "relative",
                  minWidth: "3rem",
                }}
              >
                <span
                  style={{
                    display: "block",
                    width: `${(projection.seats / max) * 100}%`,
                    height: "100%",
                    background: party.color,
                  }}
                />
              </span>

              <span
                style={{
                  display: "flex",
                  gap: "12px",
                  alignItems: "baseline",
                  whiteSpace: "nowrap",
                }}
              >
                <strong className="num ltr-nums" style={{ fontSize: "20px", minWidth: "2ch" }}>
                  {projection.seats}
                </strong>
                <span className="ltr-nums text-muted" style={{ fontSize: "12px" }}>
                  ({average.toFixed(1)})
                </span>
                <TrendPill change={changes.get(projection.partyId) ?? 0} />
              </span>
            </li>
          );
        })}
      </ol>

      {failed.length > 0 && (
        <div style={{ marginTop: "18px" }}>
          <p className="text-muted" style={{ margin: "0 0 8px", fontSize: "12px" }}>
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
              gap: "8px 20px",
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
                    gap: "8px",
                    fontSize: "13px",
                  }}
                >
                  <PartySwatch color={party.color} size={8} />
                  {party.name}
                  <span className="num ltr-nums text-muted">
                    {(averages.get(projection.partyId)?.mean ?? 0).toFixed(1)}
                  </span>
                </li>
              );
            })}
          </ul>
        </div>
      )}

      {/* Bloc totals as a divided strip — the design's three-column figure. */}
      <div
        style={{
          marginTop: "22px",
          display: "grid",
          gridTemplateColumns: `repeat(auto-fit, minmax(8rem, 1fr))`,
          border: "1px solid var(--color-divider)",
        }}
      >
        {blocSeats.map((bloc, index) => (
          <div
            key={bloc.bloc}
            style={{
              padding: "12px 14px",
              borderInlineStart:
                index === 0 ? undefined : "1px solid var(--color-divider)",
            }}
          >
            <div className="num ltr-nums" style={{ fontSize: "28px", lineHeight: 1 }}>
              {bloc.seats}
            </div>
            <div
              className="text-muted"
              style={{ fontSize: "11px", marginTop: "5px" }}
            >
              {BLOC_NAMES[bloc.bloc] ?? bloc.bloc}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
