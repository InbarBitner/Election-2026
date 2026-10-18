import { Callout, Panel, SectionTitle } from "@/components/ui";
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

  return (
    <>
      <h1 style={{ fontSize: "46px", margin: "0 0 6px", maxWidth: "20ch" }}>סקירת בחירות יומית</h1>
      <p className="text-muted" style={{ marginTop: 0, fontSize: "13px" }}>
        {formatDate(latest.date)} ·{" "}
        {latest.generator === "llm"
          ? "נוסחה במודל שפה מתוך עובדות שנשלפו מהנתונים"
          : "נוסחה אוטומטית מתוך הנתונים"}
      </p>

      <Callout>
        הסקירה נוצרת אוטומטית. זיהוי האירועים והמספרים נעשה בקוד דטרמיניסטי על
        נתוני מסד הנתונים; אם נעשה שימוש במודל שפה, תפקידו ניסוח בלבד והוא מקבל
        אך ורק את העובדות שזוהו. המספרים שבסקירה הם אותם מספרים שבדף הסקרים.
      </Callout>

      <Panel style={{ marginBottom: "24px" }}>
        <h2 style={{ marginTop: 0, fontSize: "34px", lineHeight: 1.1 }}>{latest.headline}</h2>
        <Markdown source={latest.bodyMarkdown} />
      </Panel>

      {archive.length > 0 && (
        <Panel>
          <SectionTitle>סקירות קודמות</SectionTitle>
          <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
            {archive.map((brief) => (
              <li
                key={brief.date}
                style={{ padding: "0.5rem 0", borderBottom: "1px solid var(--color-divider)" }}
              >
                <div style={{ fontSize: "0.78rem", color: "color-mix(in srgb, var(--color-text) 55%, transparent)" }}>
                  {formatDate(brief.date)}
                </div>
                <div style={{ fontSize: "0.9rem" }}>{brief.headline}</div>
              </li>
            ))}
          </ul>
        </Panel>
      )}
    </>
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
