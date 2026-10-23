import Link from "next/link";
import { notFound } from "next/navigation";
import CandidateXray from "@/components/CandidateXray";
import { Callout, Panel, PartySwatch, SectionTitle, SourceBadge, TrendPill } from "@/components/ui";
import type { Evidence } from "@/lib/cosine";
import { BLOC_NAMES, formatDate } from "@/lib/format";
import { getPartyBySlug, getPollSnapshot, getQuizQuestions } from "@/lib/queries";
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

const muted = { color: "color-mix(in srgb, var(--color-text) 55%, transparent)" };

/** A hand label (±1 sure, ±0.5 partial, 0 unclear) as a reader can take it. */
function stance(value: number): string {
  if (value >= 1) return "בעד";
  if (value > 0) return "נוטה בעד";
  if (value <= -1) return "נגד";
  if (value < 0) return "נוטה נגד";
  return "עמדה לא ברורה";
}

function evidenceLabel(evidence: Evidence): string {
  if (evidence.kind === "bill") return evidence.status ? `הצעת חוק · ${evidence.status}` : "הצעת חוק";
  if (evidence.kind === "platform") return "מהמצע";
  const date = evidence.date ? formatDate(evidence.date) : "";
  return [evidence.speaker, date].filter(Boolean).join(", ");
}

/** How many candidates a list shows when the projection gives it no seats. */
const SHOWN_WITHOUT_SEATS = 5;

export default async function PartyPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const [party, snapshot, questions] = await Promise.all([
    getPartyBySlug(slug),
    getPollSnapshot(),
    getQuizQuestions(),
  ]);

  if (!party) notFound();

  const average = snapshot.latest.get(party.id)?.mean ?? 0;
  const projection = snapshot.projections.find((p) => p.partyId === party.id);
  const seats = projection?.seats ?? 0;
  const change = snapshot.changes.get(party.id) ?? 0;

  // The party's labelled position on each quiz statement — the same vector
  // the quiz compares a reader's answers with. A question it has no label on
  // is absent, which is not the same as "unclear".
  const vector = party.vector ? (JSON.parse(party.vector.vectorJson) as Record<string, number>) : {};
  const evidence = party.vector
    ? (JSON.parse(party.vector.evidenceJson) as Record<string, Evidence>)
    : {};
  const positions = questions.filter((q) => q.id in vector);

  // The list down to the projected seat line and the next candidate, who
  // would get in with one seat more. The rest open on request.
  const shownCandidates = seats > 0 ? seats + 1 : SHOWN_WITHOUT_SEATS;
  const visible = party.candidates.slice(0, shownCandidates);
  const rest = party.candidates.slice(shownCandidates);

  return (
    <>
      <p style={{ fontSize: "14px", margin: "0 0 8px" }}>
        <Link href="/parties" style={muted}>
          ← לכל המפלגות
        </Link>
      </p>

      <div style={{ display: "flex", alignItems: "center", gap: "10px", marginBottom: "4px" }}>
        <PartySwatch color={party.color} size={14} />
        <h1 style={{ margin: 0 }}>{party.name}</h1>
      </div>
      <p style={{ ...muted, margin: "0 0 6px", fontSize: "14px" }}>
        בראשות {party.leader} · {BLOC_NAMES[party.bloc] ?? party.bloc} ·{" "}
        <SourceBadge url={party.sourceUrl} name={party.sourceName} />
      </p>
      {party.isActive && (
        <p style={{ margin: "0 0 20px", fontSize: "15px", display: "flex", gap: "6px", flexWrap: "wrap", alignItems: "center" }}>
          <span>
            <strong className="ltr-nums" style={{ fontSize: "20px" }}>{seats}</strong> מנדטים בתחזית
          </span>
          <span style={muted}>·</span>
          <span>
            ממוצע <span className="ltr-nums">{average.toFixed(1)}</span>
          </span>
          <span style={muted}>·</span>
          <TrendPill change={change} />
          <span style={muted}>בשבוע ·</span>
          <strong style={{ fontSize: "13px" }}>ממוצע סקרים אינו תחזית תוצאות</strong>
        </p>
      )}

      {party.isActive && projection && !projection.passedThreshold && (
        <Callout tone="warning">
          בממוצע הנוכחי המפלגה אינה עוברת את אחוז החסימה, ולכן אינה מקבלת מנדטים בתחזית.
        </Callout>
      )}

      {!party.isActive && (
        <Callout tone="warning">
          המפלגה פרשה מהמרוץ
          {party.withdrawnOn && <> ב-{formatDate(party.withdrawnOn)}</>} ואינה מתמודדת בבחירות.
          היא לא נכללת בממוצע הסקרים, בתחזית המנדטים ובשאלון.
          {party.withdrawalSourceUrl && (
            <>
              {" "}
              <a href={party.withdrawalSourceUrl} target="_blank" rel="noopener noreferrer">
                מקור
              </a>
            </>
          )}
        </Callout>
      )}

      <Panel style={{ marginBottom: "20px" }}>
        <SectionTitle>המצע בקצרה</SectionTitle>
        <p style={{ fontSize: "15px", color: "color-mix(in srgb, var(--color-text) 78%, transparent)", margin: 0, maxWidth: "75ch" }}>
          {party.platformText || "לא נטען טקסט מצע."}
        </p>
      </Panel>

      {positions.length > 0 && (
        <Panel style={{ marginBottom: "20px" }}>
          <SectionTitle
            hint={
              party.isActive
                ? "העמדות שהשאלון משווה אליהן את התשובות שלך, כל אחת עם המקור שלה."
                : "העמדות כפי שתויגו לפני הפרישה, כל אחת עם המקור שלה. המפלגה כבר לא נכללת בשאלון."
            }
          >
            עמדות בשאלון
          </SectionTitle>
          <details>
            <summary className="btn btn-secondary" style={{ display: "inline-flex", listStyle: "none" }}>
              {`הצג את העמדות (${positions.length} מתוך ${questions.length})`}
            </summary>
            <ul style={{ listStyle: "none", padding: 0, margin: "14px 0 0" }}>
              {positions.map((question) => {
                const source = evidence[question.id];
                return (
                  <li
                    key={question.id}
                    style={{ padding: "10px 0", borderBottom: "1px solid var(--color-divider)" }}
                  >
                    <div style={{ display: "flex", justifyContent: "space-between", gap: "12px", alignItems: "baseline" }}>
                      <span style={{ fontSize: "15px" }}>{question.text}</span>
                      <strong style={{ whiteSpace: "nowrap", fontSize: "14px" }}>
                        {stance(vector[question.id])}
                      </strong>
                    </div>
                    {source && (
                      <div style={{ fontSize: "13px", marginTop: "4px", color: "color-mix(in srgb, var(--color-text) 75%, transparent)" }}>
                        <span style={muted}>{evidenceLabel(source)}: </span>
                        <q dir="auto">{source.text}</q>
                        {source.url && (
                          <>
                            {" "}
                            <a href={source.url} target="_blank" rel="noopener noreferrer">
                              למקור
                            </a>
                          </>
                        )}
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          </details>
        </Panel>
      )}

      <Panel>
        <SectionTitle
          hint={
            party.candidates.length === 0
              ? undefined
              : "לחיצה על שם פותחת את רנטגן המועמד: סקירה כללית מוויקיפדיה, הצבעות והצעות חוק, כל פריט עם קישור למקורו."
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
          <>
            <ol style={{ listStyle: "none", padding: 0, margin: 0 }}>
              {visible.map((candidate) => (
                <CandidateRow
                  key={candidate.id}
                  candidate={candidate}
                  seatLine={party.isActive && seats > 0 && candidate.listPosition === seats ? seats : null}
                />
              ))}
            </ol>
            {rest.length > 0 && (
              <details style={{ marginTop: "12px" }}>
                <summary className="btn btn-secondary" style={{ display: "inline-flex", listStyle: "none" }}>
                  {`הצג את שאר המועמדים (${rest.length})`}
                </summary>
                <ol style={{ listStyle: "none", padding: 0, margin: "8px 0 0" }}>
                  {rest.map((candidate) => (
                    <CandidateRow key={candidate.id} candidate={candidate} seatLine={null} />
                  ))}
                </ol>
              </details>
            )}
          </>
        )}
      </Panel>
    </>
  );
}

/**
 * One place on the list. The candidate at the projected seat line carries a
 * marker under them: everyone above it gets in on today's projection.
 */
function CandidateRow({
  candidate,
  seatLine,
}: {
  candidate: { id: string; name: string; listPosition: number };
  seatLine: number | null;
}) {
  return (
    <li
      style={{
        display: "flex",
        alignItems: "center",
        gap: "12px",
        padding: "7px 0",
        borderBottom: seatLine
          ? "2px solid var(--color-text)"
          : "1px solid var(--color-divider)",
        position: "relative",
        marginBottom: seatLine ? "26px" : 0,
      }}
    >
      <span className="ltr-nums" style={{ ...muted, fontSize: "13px", minWidth: "1.5rem" }}>
        {candidate.listPosition}
      </span>
      <span style={{ fontSize: "15px" }}>
        <CandidateXray candidateId={candidate.id} candidateName={candidate.name} asLink />
      </span>
      {seatLine && (
        <span
          style={{
            position: "absolute",
            insetInlineStart: 0,
            top: "calc(100% + 5px)",
            fontSize: "12px",
            fontWeight: 600,
          }}
        >
          כאן עובר קו המנדטים לפי התחזית (<span className="ltr-nums">{seatLine}</span>)
        </span>
      )}
    </li>
  );
}
