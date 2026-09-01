import { Callout, Card, SectionTitle } from "@/components/ui";
import { prisma } from "@/lib/db";
import { formatDate } from "@/lib/format";

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
  const facts = safeParse(latest.factsJson);

  return (
    <>
      <h1 style={{ marginBottom: "0.3rem" }}>סקירת בחירות יומית</h1>
      <p style={{ color: "var(--ink-muted)", marginTop: 0, fontSize: "0.9rem" }}>
        {formatDate(latest.date)} ·{" "}
        {latest.generator === "llm"
          ? "נוסחה במודל שפה מתוך עובדות שנשלפו מהנתונים"
          : "נוסחה אוטומטית מתוך הנתונים"}
      </p>

      <Callout>
        הסקירה נוצרת אוטומטית. זיהוי האירועים והמספרים נעשה בקוד דטרמיניסטי על
        נתוני מסד הנתונים; אם נעשה שימוש במודל שפה, תפקידו ניסוח בלבד והוא מקבל
        אך ורק את העובדות שזוהו — הן מוצגות במלואן בתחתית העמוד.
      </Callout>

      <Card style={{ marginBottom: "1.4rem" }}>
        <h2 style={{ marginTop: 0, fontSize: "1.2rem" }}>{latest.headline}</h2>
        <Markdown source={latest.bodyMarkdown} />
      </Card>

      {facts && (
        <Card style={{ marginBottom: "1.4rem" }}>
          <SectionTitle hint="בדיוק המידע שעמד בבסיס הסקירה שלמעלה — לבדיקה עצמאית של כל טענה בה.">
            העובדות שמהן נוצרה הסקירה
          </SectionTitle>
          <details>
            <summary style={{ cursor: "pointer", fontSize: "0.87rem" }}>
              הצגת הנתונים הגולמיים
            </summary>
            <pre
              dir="ltr"
              className="scroll-x"
              style={{
                background: "var(--surface-sunken)",
                border: "1px solid var(--border)",
                borderRadius: "0.4rem",
                padding: "0.8rem",
                fontSize: "0.75rem",
                marginTop: "0.6rem",
              }}
            >
              {JSON.stringify(facts, null, 2)}
            </pre>
          </details>
        </Card>
      )}

      {archive.length > 0 && (
        <Card>
          <SectionTitle>סקירות קודמות</SectionTitle>
          <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
            {archive.map((brief) => (
              <li
                key={brief.date}
                style={{ padding: "0.5rem 0", borderBottom: "1px solid var(--border)" }}
              >
                <div style={{ fontSize: "0.78rem", color: "var(--ink-muted)" }}>
                  {formatDate(brief.date)}
                </div>
                <div style={{ fontSize: "0.9rem" }}>{brief.headline}</div>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </>
  );
}

function safeParse(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
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
      <ul key={key} style={{ paddingInlineStart: "1.2rem", margin: "0.4rem 0" }}>
        {list.map((item, index) => (
          <li key={index} style={{ fontSize: "0.9rem", marginBottom: "0.2rem" }}>
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
        <h3 key={index} style={{ fontSize: "0.98rem", margin: "1rem 0 0.3rem" }}>
          {line.slice(4)}
        </h3>,
      );
    } else if (line.startsWith("## ")) {
      blocks.push(
        <h2 key={index} style={{ fontSize: "1.05rem", margin: "1.1rem 0 0.3rem" }}>
          {line.slice(3)}
        </h2>,
      );
    } else {
      blocks.push(
        <p key={index} style={{ fontSize: "0.92rem", margin: "0.5rem 0" }}>
          <Inline text={line} />
        </p>,
      );
    }
  });
  flushList("list-final");

  return <>{blocks}</>;
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
