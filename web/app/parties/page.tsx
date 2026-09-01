import Link from "next/link";
import { Callout, Card, PartySwatch, SourceBadge, TrendPill } from "@/components/ui";
import { BLOC_NAMES } from "@/lib/format";
import { getPollSnapshot, rankedParties } from "@/lib/queries";
import { prisma } from "@/lib/db";

export const dynamic = "force-dynamic";

export default async function PartiesPage() {
  const [snapshot, counts] = await Promise.all([
    getPollSnapshot(),
    prisma.candidate.groupBy({ by: ["partyId"], _count: { _all: true } }),
  ]);

  if (snapshot.parties.length === 0) {
    return (
      <>
        <h1>מפלגות ומועמדים</h1>
        <Callout tone="warning">
          לא נטענו מפלגות. הרץ <code>python -m pipeline.seed</code>.
        </Callout>
      </>
    );
  }

  const candidateCount = new Map(counts.map((row) => [row.partyId, row._count._all]));
  const ranked = rankedParties(snapshot);

  // Grouped by bloc, and within a bloc by the poll average — never by hand.
  const byBloc = new Map<string, typeof ranked>();
  for (const party of ranked) {
    const list = byBloc.get(party.bloc) ?? [];
    list.push(party);
    byBloc.set(party.bloc, list);
  }
  // blocSeats is already ordered by projected seats, descending. A bloc with no
  // projected seats at all is absent from it and sorts last.
  const blocOrder = snapshot.blocSeats.map((b) => b.bloc);
  const rank = (bloc: string) => {
    const index = blocOrder.indexOf(bloc);
    return index === -1 ? Number.MAX_SAFE_INTEGER : index;
  };
  const blocs = [...byBloc.keys()].sort((a, b) => rank(a) - rank(b));

  return (
    <>
      <h1 style={{ marginBottom: "0.3rem" }}>מפלגות ומועמדים</h1>
      <p style={{ color: "var(--ink-muted)", marginTop: 0, fontSize: "0.9rem" }}>
        <span className="ltr-nums">{snapshot.parties.length}</span> רשימות, מקובצות
        לפי גוש ומסודרות לפי ממוצע הסקרים.
      </p>

      {blocs.map((bloc) => (
        <section key={bloc} style={{ marginBottom: "1.6rem" }}>
          <h2 style={{ fontSize: "1rem", marginBottom: "0.6rem" }}>
            {BLOC_NAMES[bloc] ?? bloc}
          </h2>
          <div
            style={{
              display: "grid",
              gap: "0.8rem",
              gridTemplateColumns: "repeat(auto-fill, minmax(17rem, 1fr))",
            }}
          >
            {(byBloc.get(bloc) ?? []).map((party) => {
              const average = snapshot.latest.get(party.id)?.mean ?? 0;
              const projection = snapshot.projections.find((p) => p.partyId === party.id);
              return (
                <Card key={party.id}>
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: "0.5rem",
                      marginBottom: "0.4rem",
                    }}
                  >
                    <PartySwatch color={party.color} />
                    <Link
                      href={`/parties/${party.slug}`}
                      style={{ fontWeight: 600, fontSize: "1rem" }}
                    >
                      {party.name}
                    </Link>
                  </div>
                  <p
                    style={{
                      margin: "0 0 0.6rem",
                      fontSize: "0.85rem",
                      color: "var(--ink-muted)",
                    }}
                  >
                    בראשות {party.leader}
                  </p>
                  <div
                    style={{
                      display: "flex",
                      gap: "0.9rem",
                      flexWrap: "wrap",
                      fontSize: "0.85rem",
                      marginBottom: "0.6rem",
                    }}
                  >
                    <span>
                      <span style={{ color: "var(--ink-muted)" }}>ממוצע: </span>
                      <strong className="ltr-nums">{average.toFixed(1)}</strong>
                    </span>
                    <span>
                      <span style={{ color: "var(--ink-muted)" }}>תחזית: </span>
                      <strong className="ltr-nums">{projection?.seats ?? 0}</strong>
                    </span>
                    <TrendPill change={snapshot.changes.get(party.id) ?? 0} />
                  </div>
                  {projection && !projection.passedThreshold && (
                    <p
                      style={{
                        margin: "0 0 0.6rem",
                        fontSize: "0.78rem",
                        color: "var(--warning)",
                      }}
                    >
                      מתחת לאחוז החסימה בממוצע הנוכחי.
                    </p>
                  )}
                  <div
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "baseline",
                      gap: "0.5rem",
                      flexWrap: "wrap",
                    }}
                  >
                    <span style={{ fontSize: "0.8rem", color: "var(--ink-muted)" }}>
                      <span className="ltr-nums">
                        {candidateCount.get(party.id) ?? 0}
                      </span>{" "}
                      מועמדים ברשימה
                    </span>
                    <SourceBadge url={party.sourceUrl} name={party.sourceName} />
                  </div>
                </Card>
              );
            })}
          </div>
        </section>
      ))}
    </>
  );
}
