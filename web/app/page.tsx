import Link from "next/link";
import SeatProjectionTable from "@/components/SeatProjection";
import { ButtonLink, Callout, Card, EmptyState, SectionTitle } from "@/components/ui";
import { formatDate } from "@/lib/format";
import { getLatestBrief, getPollSnapshot, rankedParties } from "@/lib/queries";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  const [snapshot, brief] = await Promise.all([getPollSnapshot(), getLatestBrief()]);
  const ranked = rankedParties(snapshot);

  if (snapshot.pollCount === 0) {
    return (
      <>
        <h1>בחירות 2026</h1>
        <Callout tone="warning">
          אין עדיין נתונים במסד. הרץ <code>python -m pipeline.seed</code> כדי לטעון
          נתוני הדגמה, או <code>python -m pipeline.run_etl</code> כדי לשאוב נתונים
          אמיתיים ממקורות מוגדרים.
        </Callout>
      </>
    );
  }

  return (
    <>
      <h1 style={{ marginBottom: "0.3rem" }}>מצב המערכה</h1>
      <p style={{ color: "var(--ink-muted)", marginTop: 0, fontSize: "0.9rem" }}>
        ממוצע נע של <span className="ltr-nums">{snapshot.windowDays}</span> ימים מתוך{" "}
        <span className="ltr-nums">{snapshot.pollCount}</span> סקרים
        {snapshot.asOf && <> · עודכן ל-{formatDate(snapshot.asOf)}</>}
      </p>

      <div
        style={{
          display: "grid",
          gap: "1.2rem",
          gridTemplateColumns: "repeat(auto-fit, minmax(19rem, 1fr))",
          alignItems: "start",
        }}
      >
        <Card style={{ gridColumn: "1 / -1" }}>
          <SectionTitle hint="הקצאת 120 המנדטים לפי ממוצע הסקרים, אחוז חסימה של 3.25% ושיטת בדר-עופר. אינה תחזית תוצאות.">
            תחזית מנדטים
          </SectionTitle>
          <SeatProjectionTable
            parties={snapshot.parties}
            projections={snapshot.projections}
            averages={snapshot.latest}
            changes={snapshot.changes}
            blocSeats={snapshot.blocSeats}
          />
          <p style={{ marginTop: "1rem", marginBottom: 0 }}>
            <Link href="/polls" style={{ fontSize: "0.88rem" }}>
              לגרף המגמות ולרשימת הסקרים ←
            </Link>
          </p>
        </Card>

        <Card>
          <SectionTitle hint="נוצרת אוטומטית מנתוני היום שנאספו בצינור ה-ETL.">
            הסקירה היומית
          </SectionTitle>
          {brief ? (
            <>
              <h3 style={{ fontSize: "1rem", margin: "0 0 0.4rem" }}>{brief.headline}</h3>
              <p
                style={{
                  fontSize: "0.87rem",
                  color: "var(--ink-secondary)",
                  margin: "0 0 0.8rem",
                }}
              >
                {firstParagraph(brief.bodyMarkdown)}
              </p>
              <div
                style={{
                  display: "flex",
                  gap: "0.8rem",
                  alignItems: "center",
                  flexWrap: "wrap",
                }}
              >
                <Link href="/brief" style={{ fontSize: "0.88rem" }}>
                  לסקירה המלאה ←
                </Link>
                <span style={{ fontSize: "0.76rem", color: "var(--ink-muted)" }}>
                  {formatDate(brief.date)} ·{" "}
                  {brief.generator === "llm" ? "נוסחה במודל שפה" : "נוסחה אוטומטית"}
                </span>
              </div>
            </>
          ) : (
            <EmptyState>
              טרם נוצרה סקירה. הרץ <code>python -m pipeline.brief.generate</code>.
            </EmptyState>
          )}
        </Card>

        <Card>
          <SectionTitle hint="שאלון עמדות קצר שמשווה את תשובותיך למצעי המפלגות.">
            למי אני מתאים?
          </SectionTitle>
          <p style={{ fontSize: "0.88rem", color: "var(--ink-secondary)" }}>
            עונים על עד 25 היגדים בחמישה תחומים, ומקבלים אחוזי התאמה לכל מפלגה ולכל
            גוש — יחד עם הסבר אילו נושאים הכריעו את התוצאה. התשובות נשמרות בדפדפן
            שלך בלבד.
          </p>
          <ButtonLink href="/quiz">למילוי השאלון</ButtonLink>
        </Card>

        <Card style={{ gridColumn: "1 / -1" }}>
          <SectionTitle hint="לחיצה על מפלגה פותחת את מצעה, רשימת מועמדיה ופיצ׳ר רנטגן מועמד.">
            מפלגות
          </SectionTitle>
          <ul
            style={{
              listStyle: "none",
              padding: 0,
              margin: 0,
              display: "grid",
              gap: "0.5rem",
              gridTemplateColumns: "repeat(auto-fill, minmax(13rem, 1fr))",
            }}
          >
            {ranked.map((party) => (
              <li key={party.id}>
                <Link
                  href={`/parties/${party.slug}`}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: "0.5rem",
                    padding: "0.45rem 0.6rem",
                    border: "1px solid var(--border)",
                    borderRadius: "0.4rem",
                    textDecoration: "none",
                    fontSize: "0.87rem",
                  }}
                >
                  <span
                    aria-hidden="true"
                    style={{
                      width: 9,
                      height: 9,
                      borderRadius: 2,
                      background: party.color,
                      flexShrink: 0,
                    }}
                  />
                  <span
                    style={{
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {party.name}
                  </span>
                  <span
                    className="ltr-nums"
                    style={{ marginInlineStart: "auto", color: "var(--ink-muted)" }}
                  >
                    {(snapshot.latest.get(party.id)?.mean ?? 0).toFixed(1)}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </Card>
      </div>
    </>
  );
}

function firstParagraph(markdown: string): string {
  const paragraph = markdown
    .split("\n")
    .map((line) => line.trim())
    .find((line) => line.length > 0 && !line.startsWith("#") && !line.startsWith("-"));
  const plain = (paragraph ?? "").replace(/\*\*/g, "");
  return plain.length > 220 ? `${plain.slice(0, 220)}…` : plain;
}
