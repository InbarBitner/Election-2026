import CandidateXray from "@/components/CandidateXray";
import { Callout, PartySwatch, Panel, SectionTitle } from "@/components/ui";
import { prisma } from "@/lib/db";
import { formatDate } from "@/lib/format";
import { getPollSnapshot, getSeatEdges, type SeatEdge } from "@/lib/queries";

export const dynamic = "force-dynamic";

export default async function BriefPage() {
  const briefs = await prisma.dailyBrief.findMany({
    orderBy: { date: "desc" },
    take: 14,
  });

  if (briefs.length === 0) {
    return (
      <>
        <h1>סקירה יומית</h1>
        <Callout tone="warning">
          טרם נוצרה סקירה. הרץ{" "}
          <code>python -m pipeline.brief.generate --date today</code>.
        </Callout>
      </>
    );
  }

  const [latest, ...archive] = briefs;
  const edges = await getSeatEdges(await getPollSnapshot());

  return (
    <>
      <h1 style={{ margin: "0 0 4px" }}>סקירת בחירות יומית</h1>
      <p className="text-muted" style={{ marginTop: 0, marginBottom: "20px", fontSize: "14px" }}>
        {formatDate(latest.date)} ·{" "}
        {latest.generator === "llm"
          ? "נוסחה במודל שפה מתוך עובדות שנשלפו מהנתונים"
          : "נוסחה אוטומטית מתוך הנתונים"}
      </p>

      <Panel style={{ marginBottom: "24px" }}>
        <h2 style={{ marginTop: 0, fontSize: "34px", lineHeight: 1.1 }}>{latest.headline}</h2>
        <Markdown source={latest.bodyMarkdown} />
      </Panel>

      {edges.length > 0 && (
        <Panel style={{ marginBottom: "24px" }}>
          <SectionTitle hint="לפי תחזית המנדטים הנוכחית: מי מחזיק במנדט האחרון של כל מפלגה, ומי נכנס אם היא מקבלת עוד מנדט אחד. לחיצה על שם פותחת את רנטגן המועמד.">
            על הקו
          </SectionTitle>
          <SeatEdgesTable edges={edges} />
        </Panel>
      )}

      {archive.length > 0 && (
        <Panel>
          <SectionTitle>סקירות קודמות</SectionTitle>
          <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
            {archive.map((brief) => (
              <li
                key={brief.date}
                style={{ padding: "10px 0", borderBottom: "1px solid var(--color-divider)" }}
              >
                <details>
                  <summary style={{ cursor: "pointer" }}>
                    <span className="text-muted" style={{ fontSize: "13px" }}>
                      {formatDate(brief.date)}
                    </span>{" "}
                    · <span style={{ fontSize: "15px" }}>{brief.headline}</span>
                  </summary>
                  <div style={{ marginTop: "8px" }}>
                    <Markdown source={brief.bodyMarkdown} />
                  </div>
                </details>
              </li>
            ))}
          </ul>
        </Panel>
      )}

      <details style={{ marginTop: "20px", fontSize: "14px" }}>
        <summary style={{ cursor: "pointer", color: "var(--color-accent)" }}>איך נוצרת הסקירה</summary>
        <p style={{ margin: "10px 0 0", maxWidth: "70ch", color: "color-mix(in srgb, var(--color-text) 78%, transparent)" }}>
          הסקירה נוצרת אוטומטית בכל בוקר. זיהוי האירועים והמספרים נעשה בקוד
          דטרמיניסטי על נתוני מסד הנתונים; אם נעשה שימוש במודל שפה, תפקידו ניסוח
          בלבד והוא מקבל אך ורק את העובדות שזוהו. המספרים שבסקירה הם אותם מספרים
          שבדף הסקרים.
        </p>
      </details>
    </>
  );
}

function SeatEdgesTable({ edges }: { edges: SeatEdge[] }) {
  const muted = { color: "color-mix(in srgb, var(--color-text) 55%, transparent)" };
  const cell = (candidate: SeatEdge["lastIn"]) =>
    candidate ? (
      <span style={{ display: "inline-flex", gap: "6px", alignItems: "baseline" }}>
        <span className="ltr-nums" style={{ ...muted, fontSize: "12px" }}>
          {candidate.listPosition}
        </span>
        <CandidateXray candidateId={candidate.id} candidateName={candidate.name} asLink />
      </span>
    ) : (
      <span style={muted}>—</span>
    );

  return (
    <div className="scroll-x">
      <table className="table edges-table">
        <thead>
          <tr>
            <th>מפלגה</th>
            <th>מנדטים</th>
            <th>נכנס אחרון</th>
            <th>הבא בתור</th>
          </tr>
        </thead>
        <tbody>
          {edges.map((edge) => (
            <tr key={edge.partyId}>
              <td>
                <span style={{ display: "inline-flex", alignItems: "center", gap: "8px" }}>
                  <PartySwatch color={edge.color} />
                  {edge.name}
                </span>
              </td>
              <td className="ltr-nums">{edge.seats}</td>
              <td>
                <span className="mobile-label">נכנס אחרון: </span>
                {cell(edge.lastIn)}
              </td>
              <td>
                <span className="mobile-label">הבא בתור: </span>
                {cell(edge.nextUp)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/**
 * A deliberately tiny Markdown renderer.
 *
 * The brief only ever produces headings, bullets, bold and links, so a full
 * Markdown library — and the HTML sanitising it would then require — is not
 * worth the dependency. Everything is rendered as React elements, never as
 * dangerouslySetInnerHTML, so nothing in the text can inject markup.
 */
function Markdown({ source }: { source: string }) {
  const blocks: React.ReactNode[] = [];
  let list: string[] = [];

  function flushList(key: string) {
    if (list.length === 0) return;
    blocks.push(
      <ul key={key} style={{ paddingInlineStart: "1.2rem", margin: "6px 0" }}>
        {list.map((item, index) => (
          <li key={index} style={{ fontSize: "16px", lineHeight: 1.6, marginBottom: "2px" }}>
            <Inline text={item} />
          </li>
        ))}
      </ul>,
    );
    list = [];
  }

  source.split("\n").forEach((rawLine, index) => {
    const line = rawLine.trim();
    if (line.startsWith("- ")) {
      list.push(line.slice(2));
      return;
    }
    flushList(`list-${index}`);
    if (line.length === 0) return;
    if (line.startsWith("### ")) {
      blocks.push(
        <h3 key={index} style={{ fontSize: "18px", margin: "20px 0 6px" }}>
          {line.slice(4)}
        </h3>,
      );
    } else if (line.startsWith("## ")) {
      blocks.push(
        <h2 key={index} style={{ fontSize: "20px", margin: "22px 0 6px" }}>
          {line.slice(3)}
        </h2>,
      );
    } else {
      blocks.push(
        <p key={index} style={{ fontSize: "16px", lineHeight: 1.7, margin: "8px 0" }}>
          <Inline text={line} />
        </p>,
      );
    }
  });
  flushList("list-final");

  return <div style={{ maxWidth: "72ch" }}>{blocks}</div>;
}

/** Bold (**text**) and links ([label](url)) inside one line. */
function Inline({ text }: { text: string }) {
  const parts: React.ReactNode[] = [];
  const pattern = /\*\*(.+?)\*\*|\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  let key = 0;

  while ((match = pattern.exec(text)) !== null) {
    if (match.index > lastIndex) parts.push(text.slice(lastIndex, match.index));
    if (match[1] !== undefined) {
      parts.push(<strong key={key++}>{match[1]}</strong>);
    } else {
      parts.push(
        <a key={key++} href={match[3]} target="_blank" rel="noopener noreferrer">
          {match[2]}
        </a>,
      );
    }
    lastIndex = pattern.lastIndex;
  }
  if (lastIndex < text.length) parts.push(text.slice(lastIndex));
  return <>{parts}</>;
}
