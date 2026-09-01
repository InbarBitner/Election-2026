import Link from "next/link";
import type { CSSProperties, ReactNode } from "react";

export function Card({
  children,
  style,
}: {
  children: ReactNode;
  style?: CSSProperties;
}) {
  return (
    <section
      style={{
        background: "var(--surface-raised)",
        border: "1px solid var(--border)",
        borderRadius: "0.6rem",
        padding: "1.1rem 1.2rem",
        ...style,
      }}
    >
      {children}
    </section>
  );
}

export function SectionTitle({
  children,
  hint,
}: {
  children: ReactNode;
  hint?: ReactNode;
}) {
  return (
    <div style={{ marginBottom: "0.9rem" }}>
      <h2 style={{ margin: 0, fontSize: "1.1rem" }}>{children}</h2>
      {hint && (
        <p
          style={{
            margin: "0.25rem 0 0",
            color: "var(--ink-muted)",
            fontSize: "0.82rem",
          }}
        >
          {hint}
        </p>
      )}
    </div>
  );
}

/**
 * Every figure on the site carries one of these. If a number cannot be traced
 * back to a published source, it should not be on the page at all.
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
      title={`${label}: ${name}`}
      style={{
        fontSize: "0.75rem",
        color: "var(--ink-muted)",
        textDecoration: "none",
        borderBottom: "1px dotted var(--border-strong)",
        whiteSpace: "nowrap",
      }}
    >
      {label}: {name} ↗
    </a>
  );
}

/** A party's identity colour, paired with its name so colour is never alone. */
export function PartySwatch({ color, size = 10 }: { color: string; size?: number }) {
  return (
    <span
      aria-hidden="true"
      style={{
        display: "inline-block",
        width: size,
        height: size,
        borderRadius: 2,
        background: color,
        // A 2px surface ring keeps adjacent swatches from touching.
        boxShadow: "0 0 0 2px var(--surface-raised)",
        flexShrink: 0,
      }}
    />
  );
}

export function TrendPill({ change }: { change: number }) {
  const flat = Math.abs(change) < 0.05;
  return (
    <span
      style={{
        fontSize: "0.78rem",
        color: flat ? "var(--ink-muted)" : "var(--ink-secondary)",
        whiteSpace: "nowrap",
      }}
    >
      {flat ? "ללא שינוי" : (
        <>
          {change > 0 ? "▲" : "▼"}{" "}
          <span className="ltr-nums">{Math.abs(change).toFixed(1)}</span>
        </>
      )}
    </span>
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
      style={{
        background: tone === "warning" ? "var(--warning-soft)" : "var(--surface-sunken)",
        color: tone === "warning" ? "var(--warning)" : "var(--ink-secondary)",
        border: "1px solid var(--border)",
        borderRadius: "0.5rem",
        padding: "0.7rem 0.9rem",
        fontSize: "0.85rem",
        margin: "0 0 1rem",
      }}
    >
      {children}
    </p>
  );
}

export function EmptyState({ children }: { children: ReactNode }) {
  return (
    <p
      style={{
        color: "var(--ink-muted)",
        fontSize: "0.9rem",
        padding: "1.5rem 0",
        textAlign: "center",
      }}
    >
      {children}
    </p>
  );
}

export function ButtonLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <Link
      href={href}
      style={{
        display: "inline-block",
        background: "var(--accent)",
        color: "#fff",
        padding: "0.5rem 1rem",
        borderRadius: "0.4rem",
        textDecoration: "none",
        fontSize: "0.9rem",
      }}
    >
      {children}
    </Link>
  );
}
