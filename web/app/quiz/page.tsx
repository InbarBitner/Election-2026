import QuizWizard from "@/components/QuizWizard";
import { Callout } from "@/components/ui";
import { getQuizQuestions } from "@/lib/queries";

export const dynamic = "force-dynamic";

export default async function QuizPage() {
  const questions = await getQuizQuestions();

  if (questions.length === 0) {
    return (
      <>
        <h1>למי אני מתאים?</h1>
        <Callout tone="warning">
          השאלון לא נטען. הרץ <code>python -m pipeline.seed</code>.
        </Callout>
      </>
    );
  }

  return (
    <>
      <h1 style={{ margin: "0 0 4px" }}>למי אני מתאים?</h1>
      <p className="text-muted" style={{ marginTop: 0, marginBottom: "20px", fontSize: "14px" }}>
        <span className="ltr-nums">{questions.length}</span> היגדים בחמישה תחומים · אפשר
        לדלג · התשובות נשמרות רק בדפדפן שלך
      </p>

      <QuizWizard questions={questions} />

      <details style={{ marginTop: "20px", fontSize: "14px" }}>
        <summary style={{ cursor: "pointer", color: "var(--color-accent)" }}>איך זה מחושב</summary>
        <div style={{ maxWidth: "70ch", color: "color-mix(in srgb, var(--color-text) 78%, transparent)" }}>
          <p style={{ margin: "10px 0 0" }}>
            ההתאמה משווה את תשובותיך, שאלה אחר שאלה, לעמדות המפלגה כפי שתויגו ממצעה
            המפורסם או, למפלגה שאין לה מצע, מהצעות החוק של חבריה. לכל עמדה מצוין המקור.
            שאלה שאין לנו בה מידע על המפלגה אינה נספרת, וציון שנשען על מעט שאלות מתקרב
            ל-50%, כדי שמפלגה לא תקבל התאמה גבוהה רק מפני שידוע עליה מעט.
          </p>
          <p style={{ margin: "10px 0 0" }}>
            חלק מההיגדים מנוסחים בכיוון ההפוך בכוונה, כדי שהסכמה גורפת לא תיצור תוצאה
            קיצונית מלאכותית. התשובות אינן נשלחות לשמירה בשרת: הן נשמרות בדפדפן שלך,
            והחישוב לא שומר דבר.
          </p>
          <p style={{ margin: "10px 0 0" }}>
            זהו כלי עזר להתמצאות, לא המלצה למי להצביע. הוא אינו מביא בחשבון שיקולים
            קואליציוניים, אמון אישי או סוגיות שלא נכללו בשאלון.
          </p>
        </div>
      </details>
    </>
  );
}
