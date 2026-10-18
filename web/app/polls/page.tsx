import { Suspense } from "react";
import PollsChartSection from "@/components/PollsChartSection";
import SeatProjectionTable from "@/components/SeatProjection";
import { Callout, Panel, SectionTitle, SourceBadge } from "@/components/ui";
import { formatDate } from "@/lib/format";
import { DEFAULT_WINDOW_DAYS } from "@/lib/pollAverage";
import { getPollSnapshot, getRecentPolls, rankedParties } from "@/lib/queries";

export const dynamic = "force-dynamic";

const ALLOWED_WINDOWS = [7, 14, 30];

export default async function PollsPage({
  searchParams,
}: {
  searchParams: Promise<{ window?: string }>;
}) {
  const params = await searchParams;
  const requested = Number(params.window);
  const windowDays = ALLOWED_WINDOWS.includes(requested)
    ? requested
    : DEFAULT_WINDOW_DAYS;

  const [snapshot, polls] = await Promise.all([
    getPollSnapshot(windowDays),
    getRecentPolls(40),
  ]);

  if (snapshot.pollCount === 0) {
    return (
      <>
        <h1>סקרים</h1>
        <Callout tone="warning">
          לא נטענו סקרים. הרץ <code>python -m pipeline.seed</code> לנתוני הדגמה, או
          הגדר מקור אמיתי ב-<code>data/sources/polls.json</code> והרץ{" "}
          <code>python -m pipeline.run_etl</code>.
        </Callout>
      </>
    );
  }

  const ranked = rankedParties(snapshot);
  const chartParties = ranked.map((party) => ({
    id: party.id,
    name: party.name,
    color: party.color,
    colorDark: party.colorDark,
    average: snapshot.latest.get(party.id)?.mean ?? 0,
  }));

  const partyById = new Map(snapshot.parties.map((p) => [p.id, p]));

  return (
    <>
      <h1 style={{ fontSize: "44px", margin: "0 0 6px" }}>סקרים ומגמות</h1>
      <p className="text-muted" style={{ marginTop: 0, fontSize: "13px" }}>
        <span className="ltr-nums">{snapshot.pollCount}</span> סקרים
        {snapshot.asOf && <> · עודכן ל-{formatDate(snapshot.asOf)}</>}
      </p>

      <Callout>
        הממוצע משוקלל לפי שורש גודל המדגם ודועך אקספוננציאלית עם גיל הסקר (מחצית
        משקל אחרי שבוע), ומכל בית סקרים נכלל סקר אחד ליום כדי שתדירות פרסום גבוהה
        לא תטה את התוצאה. <strong>ממוצע סקרים אינו תחזית תוצאות</strong> — לכל סקר
        טעות דגימה משלו, המוצגת בטבלה שלמטה.
      </Callout>

      <Panel style={{ marginBottom: "24px" }}>
        <SectionTitle hint="מגמת הממוצע הנע לאורך זמן. אפשר לשנות את חלון הממוצע ולבחור אילו מפלגות להציג.">
          מגמות
        </SectionTitle>
        <Suspense fallback={<p style={{ color: "color-mix(in srgb, var(--color-text) 55%, transparent)" }}>טוען גרף…</p>}>
          <PollsChartSection
            rows={snapshot.chartRows}
            parties={chartParties}
            windowDays={windowDays}
          />
        </Suspense>
      </Panel>

      <Panel style={{ marginBottom: "24px" }}>
        <SectionTitle hint="הקצאת 120 המנדטים לפי הממוצע הנוכחי.">
          תחזית מנדטים
        </SectionTitle>
        <SeatProjectionTable
          parties={snapshot.parties}
          projections={snapshot.projections}
          averages={snapshot.latest}
          changes={snapshot.changes}
          blocSeats={snapshot.blocSeats}
        />
        <SurplusAgreements snapshot={snapshot} partyById={partyById} />
      </Panel>

      <Panel>
        <SectionTitle hint="הסקרים הגולמיים שמהם מחושב הממוצע, מהחדש לישן.">
          הסקרים שנכללו
        </SectionTitle>
        <div className="scroll-x">
          <table className="table" style={{ minWidth: "44rem" }}>
            <thead>
              <tr>
                <th>בית סקרים</th>
                <th>מזמין</th>
                <th>תאריך סיום</th>
                <th>מדגם</th>
                <th>טעות דגימה</th>
                <th>שלוש הגדולות</th>
                <th>מקור</th>
              </tr>
            </thead>
            <tbody>
              {polls.map((poll) => {
                const top = [...poll.results]
                  .sort((a, b) => b.seats - a.seats)
                  .slice(0, 3);
                return (
                  <tr key={poll.id}>
                    <td>{poll.pollster}</td>
                    <td>{poll.sponsor}</td>
                    <td>{formatDate(poll.fieldDateEnd)}</td>
                    <td className="ltr-nums">
                      {poll.sampleSize}
                    </td>
                    <td className="ltr-nums">
                      ±{poll.marginOfError.toFixed(1)}%
                    </td>
                    <td>
                      {top
                        .map(
                          (result) =>
                            `${partyById.get(result.partyId)?.shortName ?? result.partyId} ${result.seats}`,
                        )
                        .join(" · ")}
                    </td>
                    <td>
                      <SourceBadge
                        url={poll.sourceUrl}
                        name={poll.sourceName}
                        label="פרסום"
                      />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Panel>
    </>
  );
}


/**
 * The agreements in force and what they change. A pair pools its leftover
 * votes, so it can win a seat neither would win alone — usually at the expense
 * of whichever list held the last remainder.
 */
function SurplusAgreements({
  snapshot,
  partyById,
}: {
  snapshot: Awaited<ReturnType<typeof getPollSnapshot>>;
  partyById: Map<string, { name: string }>;
}) {
  if (snapshot.agreements.length === 0) return null;
  const name = (id: string) => partyById.get(id)?.name ?? id;
  const without = new Map(snapshot.projectionsWithoutAgreements.map((p) => [p.partyId, p.seats]));
  const shifts = snapshot.projections
    .map((p) => ({ id: p.partyId, delta: p.seats - (without.get(p.partyId) ?? 0) }))
    .filter((s) => s.delta !== 0)
    .sort((a, b) => b.delta - a.delta);

  return (
    <div style={{ marginTop: "22px", fontSize: "13px" }}>
      <h3 style={{ fontSize: "16px", margin: "0 0 6px" }}>הסכמי עודפים</h3>
      <p className="text-muted" style={{ margin: "0 0 8px" }}>
        התחזית כוללת את הסכמי העודפים שנחתמו. הסכם חל רק כששתי הרשימות עוברות את אחוז החסימה.
      </p>
      <ul style={{ margin: "0 0 8px", paddingInlineStart: "1.2rem" }}>
        {snapshot.agreements.map((a) => (
          <li key={a.parties.join("+")}>
            {name(a.parties[0])} ו{name(a.parties[1])}{" "}
            <a href={a.sourceUrl} target="_blank" rel="noopener noreferrer" className="text-muted">
              ({a.sourceName})
            </a>
          </li>
        ))}
      </ul>
      <p style={{ margin: 0 }}>
        {shifts.length === 0 ? (
          "לפי הממוצע הנוכחי, ההסכמים לא משנים אף מנדט."
        ) : (
          <>
            מה ההסכמים משנים בתחזית:{" "}
            {shifts.map((s, i) => (
              <span key={s.id}>
                {i > 0 && ", "}
                {name(s.id)} <span className="ltr-nums">{s.delta > 0 ? `+${s.delta}` : s.delta}</span>
              </span>
            ))}
          </>
        )}
      </p>
    </div>
  );
}
