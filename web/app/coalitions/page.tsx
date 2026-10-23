import CoalitionBuilder, { type CoalitionParty } from "@/components/CoalitionBuilder";
import { Callout, Panel, SectionTitle } from "@/components/ui";
import {
  BLOC_CORRELATION,
  SD_FLOOR,
  SIMULATIONS,
  partySpread,
  simulate,
  thresholdProbability,
} from "@/lib/coalitionSim";
import { formatDate } from "@/lib/format";
import { getPollSnapshot, rankedParties } from "@/lib/queries";

export const dynamic = "force-dynamic";

export default async function CoalitionsPage() {
  const snapshot = await getPollSnapshot();

  if (snapshot.pollCount === 0 || !snapshot.asOf) {
    return (
      <>
        <h1>בונה קואליציות</h1>
        <Callout tone="warning">
          לא נטענו סקרים. הרץ <code>python -m pipeline.seed</code> לנתוני הדגמה, או{" "}
          <code>python -m pipeline.run_etl</code> לסקרים אמיתיים.
        </Callout>
      </>
    );
  }

  const ranked = rankedParties(snapshot);
  const means = new Map(ranked.map((p) => [p.id, snapshot.latest.get(p.id)?.mean ?? 0]));
  const spread = partySpread(snapshot.rawPolls, means, {
    asOf: new Date(snapshot.asOf),
    houseEffects: snapshot.leans,
  });
  // Seeded, so the odds do not shift on every reload; they change only when
  // the polls do.
  const draws = simulate(
    ranked.map((p) => ({ id: p.id, bloc: p.bloc, mean: means.get(p.id)!, sd: spread.get(p.id)! })),
    { agreements: snapshot.agreements.map((a) => a.parties) },
  );
  const passChance = thresholdProbability(draws, ranked.length);

  const projection = new Map(snapshot.projections.map((p) => [p.partyId, p]));
  const parties: CoalitionParty[] = ranked.map((party, i) => ({
    id: party.id,
    name: party.name,
    bloc: party.bloc,
    color: party.color,
    seats: projection.get(party.id)?.seats ?? 0,
    average: means.get(party.id)!,
    passedThreshold: projection.get(party.id)?.passedThreshold ?? false,
    spread: spread.get(party.id)!,
    passChance: passChance[i],
  }));

  return (
    <>
      <h1 style={{ margin: "0 0 4px" }}>בונה קואליציות</h1>
      <p className="text-muted" style={{ marginTop: 0, marginBottom: "20px", fontSize: "14px" }}>
        סמן מפלגות &quot;בפנים&quot; או &quot;בחוץ&quot; · חשבון בלבד, לא הערכה אם המפלגות ישבו
        יחד · <strong>ממוצע סקרים אינו תחזית תוצאות</strong>
        {snapshot.asOf && <> · עודכן ל-{formatDate(snapshot.asOf)}</>}
      </p>

      <Panel style={{ marginBottom: "24px" }}>
        <SectionTitle hint="המנדטים הם התחזית שבדף הסקרים: אחרי אחוז החסימה וחלוקה בשיטת בדר-עופר.">
          הקואליציה שלך
        </SectionTitle>
        <CoalitionBuilder
          parties={parties}
          draws={Buffer.from(draws).toString("base64")}
        />
      </Panel>

      <details style={{ marginTop: "20px", fontSize: "14px" }}>
        <summary style={{ cursor: "pointer", color: "var(--color-accent)" }}>איך מחושב הסיכוי</summary>
        <div style={{ maxWidth: "75ch", color: "color-mix(in srgb, var(--color-text) 78%, transparent)" }}>
          <p style={{ margin: "10px 0 0" }}>
            הדף מריץ <span className="ltr-nums">{SIMULATIONS.toLocaleString("he-IL")}</span>{" "}
            בחירות מדומות. בכל אחת, המנדטים של כל מפלגה מוגרלים סביב ממוצע הסקרים שלה,
            ואז עוברים את אותה חלוקה שבדף הסקרים — אחוז חסימה ובדר-עופר. הסיכוי של
            קואליציה הוא החלק מהבחירות המדומות שבהן יש לה 61 לפחות. שלוש הנחות קובעות את
            התוצאה, וכדאי להכיר אותן:
          </p>
          <ul>
            <li>
              <strong>כמה מפלגה זזה:</strong> סטיית התקן של הסקרים מ-14 הימים האחרונים סביב
              הממוצע, אחרי הסרת הנטייה הקבועה של כל בית סקרים. בלי ההסרה, בית סקרים שנותן
              למפלגה תמיד יותר היה נראה כאי-ודאות.
            </li>
            <li>
              <strong>רצפה של {SD_FLOOR} מנדט:</strong> אף מפלגה לא נחשבת ודאית יותר מזה.
              למפלגות שעל סף אחוז החסימה, ההנחה הזו קובעת במידה רבה את הסיכוי שלהן לעבור.
            </li>
            <li>
              <strong>מתאם בתוך גוש ({BLOC_CORRELATION}):</strong> כשהסקרים טועים, הם טועים
              בדרך כלל לכמה מפלגות של אותו מחנה יחד. חלק מהסטייה של כל מפלגה משותף לגוש
              שלה. זו הנחה, לא מדידה — כמה עשרות סקרים לא מספיקים כדי למדוד אותה.
            </li>
          </ul>
          <p style={{ marginBottom: 0 }}>
            ההנחות נבחרו ב-<code>research/09_coalition_montecarlo.ipynb</code>. גם עם כל
            אלה, הסיכוי מבוסס על הסקרים בלבד: טעות שכל הסקרים חולקים — למשל בהערכת שיעור
            ההצבעה — אינה נמדדת כאן.
          </p>
        </div>
      </details>
    </>
  );
}
