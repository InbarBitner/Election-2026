import Link from "next/link";
import Countdown from "@/components/Countdown";
import SeatProjectionTable from "@/components/SeatProjection";
import {
  ButtonLink,
  Callout,
  EmptyState,
  Kicker,
  Panel,
  PartySwatch,
  SectionTitle,
} from "@/components/ui";
import { formatDate } from "@/lib/format";
import { getLatestBrief, getPollSnapshot, rankedParties } from "@/lib/queries";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  const [snapshot, brief] = await Promise.all([getPollSnapshot(), getLatestBrief()]);
  const ranked = rankedParties(snapshot);

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

  return (
    <>
      {/* Hero — the design's opening statement, with the countdown beside it. */}
      <section
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(20rem, 1fr))",
          gap: "40px",
          alignItems: "start",
          marginBottom: "48px",
        }}
      >
        <div>
          <Kicker>בחירות לכנסת ה־26 · 27 באוקטובר 2026</Kicker>
          <h1
            style={{
              fontSize: "clamp(40px, 6vw, 64px)",
              lineHeight: 1.02,
              margin: "0 0 18px",
              maxWidth: "14ch",
            }}
          >
            הנתונים לפני הדעות.
          </h1>
          <p
            style={{
              fontSize: "17px",
              lineHeight: 1.6,
              maxWidth: "46ch",
              color: "color-mix(in srgb, var(--color-text) 75%, transparent)",
            }}
          >
            אגרגטור סקרים, אינדקס מפלגות ומנוע התאמה — במקום אחד. כל מספר כאן מגיע
            מסקר מפורסם, עם מקור, תאריך וטווח טעות.
          </p>
          <div style={{ display: "flex", gap: "10px", marginTop: "26px", flexWrap: "wrap" }}>
            <ButtonLink href="/quiz" withCorners>
              מצאו את ההתאמה שלכם
            </ButtonLink>
            <ButtonLink href="/polls" variant="secondary">
              לגרפים המלאים
            </ButtonLink>
          </div>
        </div>

        <Countdown />
      </section>

      <Panel style={{ marginBottom: "44px" }}>
        <SectionTitle
          hint="הקצאת 120 המנדטים לפי ממוצע הסקרים, אחוז חסימה של 3.25% ושיטת בדר-עופר. אינה תחזית תוצאות."
          aside={
            <>
              ממוצע נע של <span className="ltr-nums">{snapshot.windowDays}</span> ימים ·{" "}
              <span className="ltr-nums">{snapshot.pollCount}</span> סקרים
              {snapshot.asOf && <> · עודכן ל-{formatDate(snapshot.asOf)}</>}
            </>
          }
        >
          ממוצע הסקרים — מנדטים
        </SectionTitle>

        <SeatProjectionTable
          parties={snapshot.parties}
          projections={snapshot.projections}
          averages={snapshot.latest}
          changes={snapshot.changes}
          blocSeats={snapshot.blocSeats}
        />

        <p style={{ marginTop: "20px", marginBottom: 0, fontSize: "14px" }}>
          <Link href="/polls">לגרף המגמות ולרשימת הסקרים ←</Link>
        </p>
      </Panel>

      <div
        style={{
          display: "grid",
          gap: "24px",
          gridTemplateColumns: "repeat(auto-fit, minmax(20rem, 1fr))",
          marginBottom: "44px",
        }}
      >
        <Panel>
          <SectionTitle hint="נוצרת אוטומטית מנתוני היום שנאספו בצינור ה-ETL.">
            הסקירה היומית
          </SectionTitle>
          {brief ? (
            <>
              <h3 style={{ fontSize: "20px", margin: "0 0 8px" }}>{brief.headline}</h3>
              <p
                style={{
                  fontSize: "14px",
                  color: "color-mix(in srgb, var(--color-text) 75%, transparent)",
                  margin: "0 0 16px",
                }}
              >
                {firstParagraph(brief.bodyMarkdown)}
              </p>
              <div
                style={{
                  display: "flex",
                  gap: "12px",
                  alignItems: "baseline",
                  flexWrap: "wrap",
                  fontSize: "14px",
                }}
              >
                <Link href="/brief">לסקירה המלאה ←</Link>
                <span className="text-muted" style={{ fontSize: "11px" }}>
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
        </Panel>

        <Panel>
          <SectionTitle hint="שאלון עמדות קצר שמשווה את תשובותיך למצעי המפלגות.">
            למי אני מתאים?
          </SectionTitle>
          <p
            style={{
              fontSize: "14px",
              color: "color-mix(in srgb, var(--color-text) 75%, transparent)",
            }}
          >
            עונים על עד 25 היגדים בחמישה תחומים, ומקבלים אחוזי התאמה לכל מפלגה ולכל
            גוש — יחד עם הסבר אילו נושאים הכריעו את התוצאה. התשובות נשמרות בדפדפן
            שלך בלבד.
          </p>
          <div>
            <ButtonLink href="/quiz" variant="secondary">
              למילוי השאלון
            </ButtonLink>
          </div>
        </Panel>
      </div>

      <Panel>
        <SectionTitle hint="לחיצה על מפלגה פותחת את מצעה ואת עמדותיה לפי תחום.">
          מפלגות
        </SectionTitle>
        <ul
          style={{
            listStyle: "none",
            padding: 0,
            margin: 0,
            display: "grid",
            gap: "1px",
            gridTemplateColumns: "repeat(auto-fill, minmax(14rem, 1fr))",
          }}
        >
          {/*
            The hairline grid is drawn with an outline on each cell rather than
            by showing a coloured parent through 1px gaps: with an odd number of
            lists the last row is incomplete, and the gap trick paints those
            empty cells as a solid block.
          */}
          {ranked.map((party) => (
            <li
              key={party.id}
              style={{ outline: "1px solid var(--color-divider)" }}
            >
              <Link
                href={`/parties/${party.slug}`}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "10px",
                  padding: "12px 14px",
                  textDecoration: "none",
                  color: "inherit",
                  fontSize: "14px",
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
                <span
                  className="num ltr-nums text-muted"
                  style={{ marginInlineStart: "auto", fontSize: "16px" }}
                >
                  {(snapshot.latest.get(party.id)?.mean ?? 0).toFixed(1)}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      </Panel>
    </>
  );
}

function firstParagraph(markdown: string): string {
  const paragraph = markdown
    .split("\n")
    .map((line) => line.trim())
    .find((line) => line.length > 0 && !line.startsWith("#") && !line.startsWith("-"));
  const plain = (paragraph ?? "").replace(/\*\*/g, "");
  return plain.length > 200 ? `${plain.slice(0, 200)}…` : plain;
}
