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
      <h1 style={{ marginBottom: "0.3rem" }}>למי אני מתאים?</h1>
      <p style={{ color: "var(--ink-muted)", marginTop: 0, fontSize: "0.9rem" }}>
        <span className="ltr-nums">{questions.length}</span> היגדים בחמישה תחומים.
        אפשר לדלג על שאלות.
      </p>

      <Callout>
        התשובות נשמרות בדפדפן שלך בלבד ואינן נשמרות בשרת. חלק מההיגדים מנוסחים
        בכיוון ההפוך בכוונה, כדי שהסכמה גורפת לא תיצור תוצאה קיצונית מלאכותית.
      </Callout>

      <QuizWizard questions={questions} />
    </>
  );
}
