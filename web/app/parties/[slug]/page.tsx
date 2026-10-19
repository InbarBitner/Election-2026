import Link from "next/link";
import { notFound } from "next/navigation";
import CandidateXray from "@/components/CandidateXray";
import { Callout, Panel, PartySwatch, SectionTitle, SourceBadge, TrendPill } from "@/components/ui";
import { AXIS_NAMES, BLOC_NAMES } from "@/lib/format";
import { getPartyBySlug, getPollSnapshot } from "@/lib/queries";
import { prisma } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function generateStaticParams() {
  try {
    const parties = await prisma.party.findMany({ select: { slug: true } });
    return parties.map((party) => ({ slug: party.slug }));
  } catch {
    return [];
  }
}

export default async function PartyPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const [party, snapshot] = await Promise.all([
    getPartyBySlug(slug),
    getPollSnapshot(),
  ]);

  if (!party) notFound();

  const average = snapshot.latest.get(party.id)?.mean ?? 0;
  const projection = snapshot.projections.find((p) => p.partyId === party.id);
  const change = snapshot.changes.get(party.id) ?? 0;

  return (
    <>
      <p style={{ fontSize: "0.85rem", marginBottom: "0.5rem" }}>
        <Link href="/parties" style={{ color: "color-mix(in srgb, var(--color-text) 55%, transparent)" }}>
          ← לכל המפלגות
        </Link>
      </p>

      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: "0.6rem",
          marginBottom: "0.2rem",
        }}
      >
        <PartySwatch color={party.color} size={14} />
        <h1 style={{ margin: 0, fontSize: "52px" }}>{party.name}</h1>
      </div>
      <p style={{ color: "color-mix(in srgb, var(--color-text) 55%, transparent)", marginTop: 0, fontSize: "0.9rem" }}>
        בראשות {party.leader} · {BLOC_NAMES[party.bloc] ?? party.bloc} ·{" "}
        <SourceBadge url={party.sourceUrl} name={party.sourceName} />
      </p>

      <div
        style={{
          display: "grid",
          gap: "1.1rem",
          gridTemplateColumns: "repeat(auto-fit, minmax(18rem, 1fr))",
          alignItems: "start",
        }}
      >
        <Panel>
          <SectionTitle hint="לפי הממוצע הנע הנוכחי.">מצב בסקרים</SectionTitle>
          <div style={{ display: "flex", gap: "1.4rem", flexWrap: "wrap" }}>
            <div>
              <div style={{ fontSize: "1.9rem", fontWeight: 700 }} className="ltr-nums">
                {average.toFixed(1)}
              </div>
              <div style={{ fontSize: "0.8rem", color: "color-mix(in srgb, var(--color-text) 55%, transparent)" }}>
                ממוצע מנדטים
              </div>
            </div>
            <div>
              <div style={{ fontSize: "1.9rem", fontWeight: 700 }} className="ltr-nums">
                {projection?.seats ?? 0}
              </div>
              <div style={{ fontSize: "0.8rem", color: "color-mix(in srgb, var(--color-text) 55%, transparent)" }}>
                תחזית הקצאה
              </div>
            </div>
            <div>
              <div style={{ fontSize: "1.1rem", paddingTop: "0.6rem" }}>
                <TrendPill change={change} />
              </div>
              <div style={{ fontSize: "0.8rem", color: "color-mix(in srgb, var(--color-text) 55%, transparent)" }}>
                שינוי בשבוע
              </div>
            </div>
          </div>
          {projection && !projection.passedThreshold && (
            <p
              style={{
                marginBottom: 0,
                marginTop: "0.8rem",
                fontSize: "0.83rem",
                color: "var(--color-warning)",
              }}
            >
              בממוצע הנוכחי המפלגה אינה עוברת את אחוז החסימה, ולכן אינה מקבלת מנדטים
              בתחזית ההקצאה.
            </p>
          )}
        </Panel>

        <Panel>
          <SectionTitle>המצע בקצרה</SectionTitle>
          <p style={{ fontSize: "0.88rem", color: "color-mix(in srgb, var(--color-text) 75%, transparent)", margin: 0 }}>
            {party.platformText || "לא נטען טקסט מצע."}
          </p>
        </Panel>

        {party.platform.length > 0 && (
          <Panel style={{ gridColumn: "1 / -1" }}>
            <SectionTitle hint="העמדות שמהן נבנה וקטור ההתאמה בשאלון.">
              עמדות לפי תחום
            </SectionTitle>
            <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
              {party.platform.map((plank) => (
                <li
                  key={plank.id}
                  style={{
                    padding: "0.6rem 0",
                    borderBottom: "1px solid var(--color-divider)",
                  }}
                >
                  <div
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      gap: "0.8rem",
                      flexWrap: "wrap",
                      alignItems: "baseline",
                    }}
                  >
                    <strong style={{ fontSize: "0.9rem" }}>
                      {AXIS_NAMES[plank.axis] ?? plank.axis}
                    </strong>
                    <SourceBadge url={plank.sourceUrl} name={plank.sourceName} />
                  </div>
                  <p
                    style={{
                      margin: "0.2rem 0 0",
                      fontSize: "0.87rem",
                      color: "color-mix(in srgb, var(--color-text) 75%, transparent)",
                    }}
                  >
                    {plank.text}
                  </p>
                </li>
              ))}
            </ul>
          </Panel>
        )}

        <Panel style={{ gridColumn: "1 / -1" }}>
          <SectionTitle
            hint={
              party.candidates.length === 0
                ? undefined
                : "לחיצה על ״רנטגן מועמד״ פותחת סקירה כללית מוויקיפדיה, היסטוריית הצבעות והצעות חוק — כל פריט עם קישור למקורו."
            }
          >
            רשימת המועמדים
          </SectionTitle>
          {party.candidates.length === 0 ? (
            // Deliberately empty rather than filled with placeholders: the
            // lists are not public yet, and inventing names on a page about a
            // real election is not an acceptable stand-in for missing data.
            <Callout>
              <strong>הרשימה טרם פורסמה.</strong> רשימות המועמדים מוגשות לוועדת
              הבחירות המרכזית סמוך למועד הבחירות, ומוצגות כאן רק לאחר פרסומן
              הרשמי. עד אז לא מוצגים כאן מועמדים — לא שמות משוערים ולא נתוני
              הדגמה.
            </Callout>
          ) : (
            <ol style={{ listStyle: "none", padding: 0, margin: 0 }}>
              {party.candidates.map((candidate) => (
                <li
                  key={candidate.id}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: "0.7rem",
                    padding: "0.5rem 0",
                    borderBottom: "1px solid var(--color-divider)",
                    flexWrap: "wrap",
                  }}
                >
                  <span
                    className="ltr-nums"
                    style={{
                      color: "color-mix(in srgb, var(--color-text) 55%, transparent)",
                      fontSize: "0.85rem",
                      minWidth: "1.5rem",
                    }}
                  >
                    {candidate.listPosition}
                  </span>
                  <span style={{ fontSize: "0.9rem", flex: 1, minWidth: "10rem" }}>
                    {candidate.name}
                  </span>
                  <CandidateXray
                    candidateId={candidate.id}
                    candidateName={candidate.name}
                  />
                </li>
              ))}
            </ol>
          )}
        </Panel>
      </div>
    </>
  );
}
