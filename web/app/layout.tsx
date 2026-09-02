import type { Metadata } from "next";
import { Barlow, Barlow_Condensed, Heebo } from "next/font/google";
import Link from "next/link";
import "./globals.css";
import { prisma } from "@/lib/db";

// Self-hosted at build time rather than fetched from Google at run time: no
// third-party request from the reader's browser, and no flash of fallback text.
// Heebo carries the Hebrew; Barlow and Barlow Condensed carry Latin and the
// numerals, which is where the design's character lives.
const barlow = Barlow({
  subsets: ["latin"],
  weight: ["400", "500", "700"],
  variable: "--font-barlow",
  display: "swap",
});
const barlowCondensed = Barlow_Condensed({
  subsets: ["latin"],
  weight: ["400", "600"],
  variable: "--font-barlow-condensed",
  display: "swap",
});
const heebo = Heebo({
  subsets: ["hebrew", "latin"],
  weight: ["300", "400", "500", "700"],
  variable: "--font-heebo",
  display: "swap",
});

export const metadata: Metadata = {
  title: "מצפן 2026 — אגרגטור סקרים ואינדקס מפלגות",
  description:
    "הנתונים לפני הדעות. ממוצע נע של סקרי הבחירות לכנסת, אינדקס מפלגות ומועמדים, רנטגן מועמד, שאלון התאמה וסקירה יומית.",
};

const NAV = [
  { href: "/", label: "ראשי" },
  { href: "/polls", label: "סקרים" },
  { href: "/parties", label: "מפלגות ומועמדים" },
  { href: "/quiz", label: "למי אני מתאים?" },
  { href: "/brief", label: "סקירה יומית" },
];

/**
 * Whether any of the data on screen is seeded demo data. Checked once here, in
 * the layout, so the badge cannot be forgotten on an individual page.
 */
async function hasSeedData(): Promise<boolean> {
  try {
    return (await prisma.party.findFirst({ where: { provenance: "seed" } })) !== null;
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
  const showDemoBadge = await hasSeedData();

  return (
    <html
      lang="he"
      dir="rtl"
      className={`${barlow.variable} ${barlowCondensed.variable} ${heebo.variable}`}
    >
      <body>
        <header
          className="nav"
          style={{
            position: "sticky",
            top: 0,
            zIndex: 40,
            background: "color-mix(in srgb, var(--color-bg) 92%, transparent)",
            backdropFilter: "blur(6px)",
            borderBottom: "1px solid var(--color-divider)",
            flexWrap: "wrap",
          }}
        >
          <Link
            href="/"
            className="nav-brand"
            style={{ display: "flex", alignItems: "baseline", gap: "10px" }}
          >
            <span>מצפן 2026</span>
            <span
              className="text-muted"
              style={{
                fontFamily: "var(--font-body)",
                fontSize: "11px",
                letterSpacing: "0.12em",
                textTransform: "uppercase",
              }}
            >
              Knesset Poll Compass
            </span>
          </Link>

          <nav
            aria-label="ניווט ראשי"
            style={{ display: "flex", gap: "22px", alignItems: "center", flexWrap: "wrap" }}
          >
            {NAV.map((item) => (
              <Link key={item.href} href={item.href}>
                {item.label}
              </Link>
            ))}
          </nav>

          {showDemoBadge && (
            <span
              className="tag tag-outline"
              style={{ fontSize: "10px", letterSpacing: "0.06em", marginInlineStart: "auto" }}
              title="הסקרים והמועמדים המוצגים נוצרו לצורך הדגמה ואינם אמיתיים"
            >
              נתוני הדגמה
            </span>
          )}
        </header>

        {showDemoBadge && (
          <div
            role="status"
            className="tag-warning"
            style={{
              padding: "0.5rem 1rem",
              fontSize: "0.82rem",
              textAlign: "center",
              borderInline: 0,
              borderTop: 0,
            }}
          >
            <strong>נתוני הדגמה.</strong> הסקרים והמועמדים המוצגים כאן נוצרו לצורך
            הדגמה ואינם אמיתיים. הרצת צינור ה-ETL תחליף אותם בנתונים מקוריים ומתועדים.
          </div>
        )}

        <main style={{ maxWidth: "1180px", margin: "0 auto", padding: "36px 40px 80px" }}>
          {children}
        </main>

        <footer
          style={{
            borderTop: "1px solid var(--color-divider)",
            padding: "24px 40px",
            fontSize: "12px",
          }}
        >
          <div
            className="text-muted"
            style={{ maxWidth: "1180px", margin: "0 auto" }}
          >
            <p style={{ margin: "0 0 6px" }}>
              ממוצע סקרים אינו תחזית תוצאות. כל נתון באתר מקושר למקורו, וסדר הצגת
              המפלגות נקבע לפי ממוצע הסקרים או לפי א״ב — לא ידנית.
            </p>
            <p style={{ margin: 0 }}>
              מצפן 2026 · פרויקט קוד פתוח ·{" "}
              <a href="https://github.com/InbarBitner/Election-2026">GitHub</a>
            </p>
          </div>
        </footer>
      </body>
    </html>
  );
}
