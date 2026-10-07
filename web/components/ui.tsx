import Link from "next/link";
import type { CSSProperties, ReactNode } from "react";

/**
 * Shared pieces of the "Industry" design system, as used by this application.
 *
 * The system's signature is the blueprint panel: a square, transparent box with
 * a hairline border and registration marks just outside its corners, as on a
 * technical drawing. `Panel` is that; `Card` is its quieter sibling for items
 * inside a list, where four sets of corner marks per row would be noise.
 */

/** The four registration marks. Purely decorative, hidden from assistive tech. */
export function Corners() {
  return (
    <>
      <i className="corner tl" aria-hidden="true" />
      <i className="corner tr" aria-hidden="true" />
      <i className="corner bl" aria-hidden="true" />
      <i className="corner br" aria-hidden="true" />
    </>
  );
}

export function Panel({
  children,
  style,
  as: Tag = "section",
}: {
  children: ReactNode;
  style?: CSSProperties;
  as?: "section" | "div" | "article";
}) {
  return (
    <Tag className="blueprint" style={{ padding: "26px 28px", ...style }}>
      <Corners />
      {children}
    </Tag>
  );
}

export function Card({
  children,
  style,
}: {
  children: ReactNode;
  style?: CSSProperties;
}) {
  return (
    <section className="card" style={style}>
      {children}
    </section>
  );
}

/** Small uppercase label above a heading — the system's kicker. */
export function Kicker({ children }: { children: ReactNode }) {
  return (
    <div
      className="text-muted"
      style={{
        fontSize: "10px",
        letterSpacing: "0.14em",
        textTransform: "uppercase",
        marginBottom: "8px",
      }}
    >
      {children}
    </div>
  );
}

export function SectionTitle({
  children,
  hint,
  aside,
}: {
  children: ReactNode;
  hint?: ReactNode;
  aside?: ReactNode;
}) {
  return (
    <div
      style={{
        display: "flex",
        justifyContent: "space-between",
        alignItems: "baseline",
        gap: "1rem",
        flexWrap: "wrap",
        marginBottom: "18px",
      }}
    >
      <div>
        <h2 style={{ margin: 0, fontSize: "28px" }}>{children}</h2>
        {hint && (
          <p
            className="text-muted"
            style={{ margin: "6px 0 0", fontSize: "12px", maxWidth: "70ch" }}
          >
            {hint}
          </p>
        )}
      </div>
      {aside && <div className="text-muted" style={{ fontSize: "12px" }}>{aside}</div>}
    </div>
  );
}

/**
 * Every figure on the site carries one of these. A number a reader cannot
 * trace back to a published source has no business being on the page.
 */
export function SourceBadge({
  url,
  name,
  label = "מקור",
}: {
  url: string;
  name: string;
  label?: string;
}) {
  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      className="text-muted"
      title={`${label}: ${name}`}
      style={{
        fontSize: "11px",
        textDecoration: "none",
        borderBottom: "1px dotted currentColor",
        whiteSpace: "nowrap",
      }}
    >
      {label}: {name} ↗
    </a>
  );
}

/** A party's identity colour, always paired with its name so colour is never alone. */
export function PartySwatch({ color, size = 10 }: { color: string; size?: number }) {
  return (
    <span
      aria-hidden="true"
      style={{
        display: "inline-block",
        width: size,
        height: size,
        background: color,
        flexShrink: 0,
      }}
    />
  );
}

export function TrendPill({ change }: { change: number }) {
  const flat = Math.abs(change) < 0.05;
  if (flat) {
    return (
      <span className="text-muted" style={{ fontSize: "12px", whiteSpace: "nowrap" }}>
        ללא שינוי
      </span>
    );
  }
  return (
    <span style={{ fontSize: "12px", whiteSpace: "nowrap" }}>
      {change > 0 ? "▲" : "▼"}{" "}
      <span className="ltr-nums">{Math.abs(change).toFixed(1)}</span>
    </span>
  );
}

/** A large condensed figure with a label under it — the system's stat block. */
export function Stat({
  value,
  label,
  size = 40,
}: {
  value: ReactNode;
  label: ReactNode;
  size?: number;
}) {
  return (
    <div>
      <div
        className="num ltr-nums"
        style={{ fontSize: `${size}px`, lineHeight: 1, fontWeight: 600 }}
      >
        {value}
      </div>
      <div
        className="text-muted"
        style={{ fontSize: "10px", letterSpacing: "0.1em", marginTop: "6px" }}
      >
        {label}
      </div>
    </div>
  );
}

export function Callout({
  children,
  tone = "neutral",
}: {
  children: ReactNode;
  tone?: "neutral" | "warning";
}) {
  return (
    <p
      className={tone === "warning" ? "tag-warning" : undefined}
      style={{
        border: tone === "warning" ? undefined : "1px solid var(--color-divider)",
        borderInlineStart:
          tone === "warning" ? undefined : "3px solid var(--color-accent)",
        padding: "12px 16px",
        fontSize: "13px",
        lineHeight: 1.6,
        margin: "0 0 24px",
        display: "block",
        color: tone === "warning" ? undefined : "color-mix(in srgb, var(--color-text) 75%, transparent)",
      }}
    >
      {children}
    </p>
  );
}

export function EmptyState({ children }: { children: ReactNode }) {
  return (
    <p className="text-muted" style={{ fontSize: "14px", padding: "24px 0", textAlign: "center" }}>
      {children}
    </p>
  );
}

export function ButtonLink({
  href,
  children,
  variant = "primary",
  withCorners = false,
}: {
  href: string;
  children: ReactNode;
  variant?: "primary" | "secondary";
  withCorners?: boolean;
}) {
  return (
    <Link
      href={href}
      className={`btn btn-${variant}${withCorners ? " blueprint" : ""}`}
      style={{ padding: "11px 22px", fontSize: "15px" }}
    >
      {withCorners && <Corners />}
      {children}
    </Link>
  );
}
