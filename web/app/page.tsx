import Link from "next/link";
import SeatProjectionTable from "@/components/SeatProjection";
import { ButtonLink, Callout, Kicker, Panel, SectionTitle } from "@/components/ui";
import { daysUntilElection, formatDate } from "@/lib/format";
import { getLatestBrief, getPollSnapshot } from "@/lib/queries";

export const dynamic = "force-dynamic";

/**
 * The front page reads like the top of a news site: today's story first, then
 * the seat projection, and a way into the tools. Everything else has its own
 * page in the navigation.
 */
export default async function HomePage() {
  const [snapshot, brief] = await Promise.all([getPollSnapshot(), getLatestBrief()]);

  if (snapshot.pollCount === 0) {
    return (
      <>
        <h1>מצפן 2026</h1>
        <Callout tone="warning">
          אין עדיין נתונים במסד. הרץ <code>python -m pipeline.seed</code> כדי לטעון
          נתוני הדגמה, או <code>python -m pipeline.run_etl</code> כדי לשאוב נתונים
          אמיתיים ממקורות מוגדרים.
        </Callout>
      </>
    );
  }

  const days = daysUntilElection();

  return (
    <>
      <section style={{ marginBottom: "28px", maxWidth: "62ch" }}>
        <Kicker>
          בחירות לכנסת ה־26 · 27 באוקטובר 2026
          {days > 0 && (
            <>
              {" "}· עוד <span className="ltr-nums">{days}</span> {days === 1 ? "יום" : "ימים"}
            </>
          )}
        </Kicker>
        {brief ? (
          <>
            <h1 style={{ margin: "6px 0 10px" }}>{brief.headline}</h1>
            <p
              style={{
                fontSize: "17px",
                color: "color-mix(in srgb, var(--color-text) 78%, transparent)",
                margin: "0 0 8px",
              }}
            >
              {firstParagraph(brief.bodyMarkdown)}
            </p>
            <p className="text-muted" style={{ fontSize: "13px", margin: 0 }}>
              <Link href="/brief">לסקירה המלאה ←</Link> · {formatDate(brief.date)}
            </p>
          </>
        ) : (
          <h1 style={{ margin: "6px 0 10px" }}>ממוצע הסקרים לבחירות 2026</h1>
        )}
      </section>

      <Panel style={{ marginBottom: "24px" }}>
        <SectionTitle
          hint="ממוצע הסקרים, אחרי אחוז החסימה והסכמי העודפים. אינו תחזית תוצאות."
          aside={
            <>
              <span className="ltr-nums">{snapshot.pollCount}</span> סקרים
              {snapshot.asOf && <> · עודכן ל-{formatDate(snapshot.asOf)}</>}
            </>
          }
        >
          כמה מנדטים לכל מפלגה
        </SectionTitle>

        <SeatProjectionTable
          parties={snapshot.parties}
          projections={snapshot.projections}
          averages={snapshot.latest}
          changes={snapshot.changes}
          blocSeats={snapshot.blocSeats}
        />

        <p style={{ marginTop: "16px", marginBottom: 0, fontSize: "14px" }}>
          <Link href="/polls">למגמות ולסקרים עצמם ←</Link>
        </p>
      </Panel>

      <div style={{ display: "flex", gap: "10px", flexWrap: "wrap" }}>
        <ButtonLink href="/quiz">למי אני מתאים?</ButtonLink>
        <ButtonLink href="/coalitions" variant="secondary">
          בונה קואליציות
        </ButtonLink>
      </div>
    </>
  );
}

function firstParagraph(markdown: string): string {
  const paragraph = markdown
    .split("\n")
    .map((line) => line.trim())
    // The opening line of every brief is the same boilerplate about the
    // window and the poll count, so the first *distinctive* paragraph is the
    // one worth showing.
    .filter((line) => line.length > 0 && !line.startsWith("#") && !line.startsWith("-"))
    .find((line) => !line.startsWith("סקירה ליום"));
  const plain = (paragraph ?? "").replace(/\*\*/g, "");
  return plain.length > 220 ? `${plain.slice(0, 220)}…` : plain;
}
