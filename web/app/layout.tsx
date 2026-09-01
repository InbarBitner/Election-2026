import type { Metadata } from "next";
import Link from "next/link";
import "./globals.css";
import { prisma } from "@/lib/db";
import { daysUntilElection } from "@/lib/format";

export const metadata: Metadata = {
  title: "בחירות 2026 — אגרגטור סקרים ואינדקס מפלגות",
  description:
    "ממוצע נע של סקרי הבחירות לכנסת, אינדקס מפלגות ומועמדים, רנטגן מועמד, שאלון התאמה וסקירה יומית.",
};

const NAV = [
  { href: "/", label: "ראשי" },
  { href: "/polls", label: "סקרים" },
  { href: "/parties", label: "מפלגות ומועמדים" },
  { href: "/quiz", label: "למי אני מתאים?" },
  { href: "/brief", label: "סקירה יומית" },
];

/**
 * Whether any of the data on screen is seeded demo data. This is checked once,
 * in the layout, so the banner cannot be forgotten on an individual page.
 */
async function hasSeedData(): Promise<boolean> {
  try {
    const seeded = await prisma.party.findFirst({ where: { provenance: "seed" } });
    return seeded !== null;
  } catch {
    // Before the first `prisma db push` there is no table to query.
    return false;
  }
}

export default async function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const showDemoBanner = await hasSeedData();
  const days = daysUntilElection();

  return (
    <html lang="he" dir="rtl">
      <body>
        {showDemoBanner && (
          <div
            role="status"
            style={{
              background: "var(--warning-soft)",
              color: "var(--warning)",
              borderBottom: "1px solid var(--border)",
              padding: "0.5rem 1rem",
              fontSize: "0.85rem",
              textAlign: "center",
            }}
          >
            <strong>נתוני הדגמה.</strong> הסקרים והמועמדים המוצגים כאן נוצרו לצורך
            הדגמה ואינם אמיתיים. הרצת צינור ה-ETL תחליף אותם בנתונים מקוריים ומתועדים.
          </div>
        )}

        <header
          style={{
            borderBottom: "1px solid var(--border)",
            background: "var(--surface-raised)",
          }}
        >
          <div
            style={{
              maxWidth: "68rem",
              margin: "0 auto",
              padding: "0.9rem 1rem",
              display: "flex",
              flexWrap: "wrap",
              gap: "0.75rem 1.5rem",
              alignItems: "baseline",
            }}
          >
            <Link
              href="/"
              style={{ fontWeight: 700, fontSize: "1.05rem", textDecoration: "none" }}
            >
              בחירות 2026
            </Link>
            <nav
              aria-label="ניווט ראשי"
              style={{ display: "flex", gap: "1rem", flexWrap: "wrap", flex: 1 }}
            >
              {NAV.map((item) => (
                <Link
                  key={item.href}
                  href={item.href}
                  style={{
                    color: "var(--ink-secondary)",
                    textDecoration: "none",
                    fontSize: "0.92rem",
                  }}
                >
                  {item.label}
                </Link>
              ))}
            </nav>
            {days > 0 && (
              <span style={{ color: "var(--ink-muted)", fontSize: "0.85rem" }}>
                <span className="ltr-nums">{days}</span> ימים לבחירות
              </span>
            )}
          </div>
        </header>

        <main style={{ maxWidth: "68rem", margin: "0 auto", padding: "1.5rem 1rem 3rem" }}>
          {children}
        </main>

        <footer
          style={{
            borderTop: "1px solid var(--border)",
            padding: "1.5rem 1rem",
            color: "var(--ink-muted)",
            fontSize: "0.82rem",
          }}
        >
          <div style={{ maxWidth: "68rem", margin: "0 auto" }}>
            <p style={{ margin: "0 0 0.5rem" }}>
              ממוצע סקרים אינו תחזית תוצאות. כל נתון באתר מקושר למקורו, וסדר הצגת
              המפלגות נקבע לפי ממוצע הסקרים או לפי א״ב — לא ידנית.
            </p>
            <p style={{ margin: 0 }}>
              פרויקט קוד פתוח ·{" "}
              <a href="https://github.com/InbarBitner/Election-2026">GitHub</a>
            </p>
          </div>
        </footer>
      </body>
    </html>
  );
}
