"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  BILL_STATUSES,
  CONNECTION_KINDS,
  VOTE_POSITIONS,
  formatDate,
} from "@/lib/format";

type XrayData = {
  candidate: {
    id: string;
    name: string;
    bio: string;
    listPosition: number;
    provenance: string;
    sourceUrl: string;
    sourceName: string;
    party: { name: string; slug: string; color: string };
  };
  summary: {
    voteCount: number;
    attendance: number | null;
    factionBreaks: number;
    billCount: number;
    leadSponsorCount: number;
    byTopic: { topic: string; for: number; against: number; abstain: number; absent: number }[];
  };
  votes: {
    id: string;
    billTitle: string;
    topic: string;
    date: string;
    position: string;
    againstFaction: boolean;
    sourceUrl: string;
    sourceName: string;
  }[];
  bills: {
    id: string;
    title: string;
    topic: string;
    status: string;
    date: string;
    isLeadSponsor: boolean;
    summary: string;
    sourceUrl: string;
    sourceName: string;
  }[];
  quotes: {
    id: string;
    text: string;
    context: string;
    topic: string;
    date: string;
    sourceUrl: string;
    sourceName: string;
  }[];
  connections: {
    id: string;
    kind: string;
    targetName: string;
    description: string;
    sourceUrl: string;
    sourceName: string;
  }[];
};

const TABS = [
  { id: "votes", label: "היסטוריית הצבעות" },
  { id: "bills", label: "הצעות חוק" },
  { id: "quotes", label: "התבטאויות" },
  { id: "connections", label: "קשרים פוליטיים" },
] as const;

type TabId = (typeof TABS)[number]["id"];

export default function CandidateXray({
  candidateId,
  candidateName,
}: {
  candidateId: string;
  candidateName: string;
}) {
  const [open, setOpen] = useState(false);
  const [data, setData] = useState<XrayData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<TabId>("votes");
  const dialogRef = useRef<HTMLDivElement>(null);
  const openerRef = useRef<HTMLButtonElement>(null);

  const load = useCallback(async () => {
    if (data || error) return;
    try {
      const response = await fetch(`/api/candidates/${candidateId}/xray`);
      if (!response.ok) throw new Error(String(response.status));
      setData(await response.json());
    } catch {
      setError("טעינת הנתונים נכשלה. נסו שוב מאוחר יותר.");
    }
  }, [candidateId, data, error]);

  useEffect(() => {
    if (!open) return;
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }
    document.addEventListener("keydown", onKey);
    dialogRef.current?.focus();
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);

  // Returning focus to the trigger keeps keyboard navigation coherent.
  useEffect(() => {
    if (!open) openerRef.current?.focus({ preventScroll: true });
  }, [open]);

  return (
    <>
      <button
        ref={openerRef}
        type="button"
        onClick={() => {
          setOpen(true);
          void load();
        }}
        aria-haspopup="dialog"
        style={{
          border: "1px solid var(--border-strong)",
          background: "transparent",
          color: "var(--accent)",
          borderRadius: "0.35rem",
          padding: "0.2rem 0.6rem",
          fontSize: "0.78rem",
          cursor: "pointer",
          font: "inherit",
          whiteSpace: "nowrap",
        }}
      >
        רנטגן מועמד
      </button>

      {open && (
        <div
          role="presentation"
          onClick={(event) => {
            if (event.target === event.currentTarget) setOpen(false);
          }}
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0,0,0,0.45)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: "1rem",
            zIndex: 50,
          }}
        >
          <div
            ref={dialogRef}
            role="dialog"
            aria-modal="true"
            aria-label={`רנטגן מועמד: ${candidateName}`}
            tabIndex={-1}
            style={{
              background: "var(--surface-raised)",
              border: "1px solid var(--border)",
              borderRadius: "0.7rem",
              maxWidth: "42rem",
              width: "100%",
              maxHeight: "85vh",
              display: "flex",
              flexDirection: "column",
              outline: "none",
            }}
          >
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "flex-start",
                gap: "1rem",
                padding: "1rem 1.2rem 0.7rem",
                borderBottom: "1px solid var(--border)",
              }}
            >
              <div>
                <h2 style={{ margin: 0, fontSize: "1.05rem" }}>{candidateName}</h2>
                {data && (
                  <p
                    style={{
                      margin: "0.15rem 0 0",
                      fontSize: "0.82rem",
                      color: "var(--ink-muted)",
                    }}
                  >
                    {data.candidate.party.name} · מקום{" "}
                    <span className="ltr-nums">{data.candidate.listPosition}</span>{" "}
                    ברשימה
                  </p>
                )}
              </div>
              <button
                type="button"
                onClick={() => setOpen(false)}
                aria-label="סגירה"
                style={{
                  border: "none",
                  background: "transparent",
                  fontSize: "1.3rem",
                  lineHeight: 1,
                  cursor: "pointer",
                  color: "var(--ink-muted)",
                }}
              >
                ×
              </button>
            </div>

            <div style={{ overflowY: "auto", padding: "0.9rem 1.2rem 1.2rem" }}>
              {error && <p style={{ color: "var(--warning)" }}>{error}</p>}
              {!data && !error && (
                <p style={{ color: "var(--ink-muted)" }}>טוען…</p>
              )}

              {data && (
                <>
                  {data.candidate.provenance === "seed" && (
                    <p
                      style={{
                        background: "var(--warning-soft)",
                        color: "var(--warning)",
                        border: "1px solid var(--border)",
                        borderRadius: "0.45rem",
                        padding: "0.6rem 0.8rem",
                        fontSize: "0.82rem",
                        margin: "0 0 0.9rem",
                      }}
                    >
                      זהו מועמד בדיוני. ההצבעות, הצעות החוק וההתבטאויות שלהלן נוצרו
                      לצורך הדגמת הפיצ׳ר בלבד ואינן מתייחסות לאדם אמיתי.
                    </p>
                  )}

                  <div
                    style={{
                      display: "flex",
                      flexWrap: "wrap",
                      gap: "0.5rem 1.5rem",
                      fontSize: "0.85rem",
                      marginBottom: "1rem",
                    }}
                  >
                    <Stat
                      label="נוכחות בהצבעות"
                      value={
                        data.summary.attendance === null
                          ? "—"
                          : `${Math.round(data.summary.attendance * 100)}%`
                      }
                    />
                    <Stat
                      label="הצבעות נגד קו הסיעה"
                      value={String(data.summary.factionBreaks)}
                    />
                    <Stat label="הצעות חוק" value={String(data.summary.billCount)} />
                    <Stat
                      label="מתוכן כיוזם/ת ראשי/ת"
                      value={String(data.summary.leadSponsorCount)}
                    />
                  </div>

                  <div
                    role="tablist"
                    aria-label="קטגוריות"
                    style={{
                      display: "flex",
                      gap: "0.3rem",
                      flexWrap: "wrap",
                      borderBottom: "1px solid var(--border)",
                      marginBottom: "0.9rem",
                    }}
                  >
                    {TABS.map((entry) => (
                      <button
                        key={entry.id}
                        type="button"
                        role="tab"
                        aria-selected={tab === entry.id}
                        onClick={() => setTab(entry.id)}
                        style={{
                          border: "none",
                          borderBottom: `2px solid ${
                            tab === entry.id ? "var(--accent)" : "transparent"
                          }`,
                          background: "transparent",
                          color:
                            tab === entry.id ? "var(--accent)" : "var(--ink-secondary)",
                          padding: "0.4rem 0.7rem",
                          fontSize: "0.85rem",
                          cursor: "pointer",
                          font: "inherit",
                        }}
                      >
                        {entry.label}
                      </button>
                    ))}
                  </div>

                  {tab === "votes" && <Votes data={data} />}
                  {tab === "bills" && <Bills data={data} />}
                  {tab === "quotes" && <Quotes data={data} />}
                  {tab === "connections" && <Connections data={data} />}
                </>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <span>
      <span style={{ color: "var(--ink-muted)" }}>{label}: </span>
      <strong className="ltr-nums">{value}</strong>
    </span>
  );
}

function Source({ url, name }: { url: string; name: string }) {
  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      style={{
        fontSize: "0.74rem",
        color: "var(--ink-muted)",
        textDecoration: "none",
        borderBottom: "1px dotted var(--border-strong)",
      }}
    >
      {name} ↗
    </a>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return (
    <p style={{ color: "var(--ink-muted)", fontSize: "0.88rem" }}>{children}</p>
  );
}

function Votes({ data }: { data: XrayData }) {
  if (data.votes.length === 0)
    return <Empty>לא נמצאו הצבעות מתועדות עבור מועמד/ת זה/זו.</Empty>;

  return (
    <div>
      {data.summary.byTopic.length > 0 && (
        <div className="scroll-x" style={{ marginBottom: "1rem" }}>
          <table style={{ borderCollapse: "collapse", fontSize: "0.82rem", minWidth: "26rem" }}>
            <caption
              style={{
                captionSide: "top",
                textAlign: "start",
                color: "var(--ink-muted)",
                paddingBottom: "0.4rem",
              }}
            >
              פילוח הצבעות לפי נושא
            </caption>
            <thead>
              <tr>
                <th style={th}>נושא</th>
                <th style={thNum}>בעד</th>
                <th style={thNum}>נגד</th>
                <th style={thNum}>נמנע</th>
                <th style={thNum}>נעדר</th>
              </tr>
            </thead>
            <tbody>
              {data.summary.byTopic.map((row) => (
                <tr key={row.topic}>
                  <td style={td}>{row.topic}</td>
                  <td style={tdNum} className="ltr-nums">{row.for}</td>
                  <td style={tdNum} className="ltr-nums">{row.against}</td>
                  <td style={tdNum} className="ltr-nums">{row.abstain}</td>
                  <td style={tdNum} className="ltr-nums">{row.absent}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
        {data.votes.map((vote) => (
          <li
            key={vote.id}
            style={{ padding: "0.5rem 0", borderBottom: "1px solid var(--border)" }}
          >
            <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap", alignItems: "baseline" }}>
              <strong style={{ fontSize: "0.88rem" }}>
                {VOTE_POSITIONS[vote.position] ?? vote.position}
              </strong>
              <span style={{ fontSize: "0.88rem" }}>{vote.billTitle}</span>
              {vote.againstFaction && (
                <span
                  style={{
                    fontSize: "0.72rem",
                    color: "var(--warning)",
                    border: "1px solid var(--warning)",
                    borderRadius: "1rem",
                    padding: "0 0.45rem",
                  }}
                >
                  נגד קו הסיעה
                </span>
              )}
            </div>
            <div
              style={{
                display: "flex",
                gap: "0.7rem",
                flexWrap: "wrap",
                fontSize: "0.76rem",
                color: "var(--ink-muted)",
                marginTop: "0.15rem",
              }}
            >
              <span>{vote.topic}</span>
              <span>{formatDate(vote.date)}</span>
              <Source url={vote.sourceUrl} name={vote.sourceName} />
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

function Bills({ data }: { data: XrayData }) {
  if (data.bills.length === 0)
    return <Empty>לא נמצאו הצעות חוק מתועדות עבור מועמד/ת זה/זו.</Empty>;
  return (
    <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
      {data.bills.map((bill) => (
        <li
          key={bill.id}
          style={{ padding: "0.55rem 0", borderBottom: "1px solid var(--border)" }}
        >
          <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap", alignItems: "baseline" }}>
            <strong style={{ fontSize: "0.88rem" }}>{bill.title}</strong>
            {bill.isLeadSponsor && (
              <span style={{ fontSize: "0.72rem", color: "var(--accent)" }}>יוזם/ת ראשי/ת</span>
            )}
          </div>
          {bill.summary && (
            <p style={{ margin: "0.2rem 0", fontSize: "0.83rem", color: "var(--ink-secondary)" }}>
              {bill.summary}
            </p>
          )}
          <div
            style={{
              display: "flex",
              gap: "0.7rem",
              flexWrap: "wrap",
              fontSize: "0.76rem",
              color: "var(--ink-muted)",
            }}
          >
            <span>{BILL_STATUSES[bill.status] ?? bill.status}</span>
            <span>{bill.topic}</span>
            <span>{formatDate(bill.date)}</span>
            <Source url={bill.sourceUrl} name={bill.sourceName} />
          </div>
        </li>
      ))}
    </ul>
  );
}

function Quotes({ data }: { data: XrayData }) {
  if (data.quotes.length === 0)
    return <Empty>לא נמצאו התבטאויות מתועדות עבור מועמד/ת זה/זו.</Empty>;
  return (
    <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
      {data.quotes.map((quote) => (
        <li key={quote.id} style={{ padding: "0.6rem 0", borderBottom: "1px solid var(--border)" }}>
          <blockquote
            style={{
              margin: 0,
              paddingInlineStart: "0.8rem",
              borderInlineStart: "3px solid var(--border-strong)",
              fontSize: "0.9rem",
            }}
          >
            {quote.text}
          </blockquote>
          <div
            style={{
              display: "flex",
              gap: "0.7rem",
              flexWrap: "wrap",
              fontSize: "0.76rem",
              color: "var(--ink-muted)",
              marginTop: "0.3rem",
            }}
          >
            {quote.context && <span>{quote.context}</span>}
            <span>{formatDate(quote.date)}</span>
            <Source url={quote.sourceUrl} name={quote.sourceName} />
          </div>
        </li>
      ))}
    </ul>
  );
}

function Connections({ data }: { data: XrayData }) {
  if (data.connections.length === 0)
    return <Empty>לא נמצאו קשרים פוליטיים מתועדים עבור מועמד/ת זה/זו.</Empty>;
  return (
    <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
      {data.connections.map((connection) => (
        <li
          key={connection.id}
          style={{ padding: "0.5rem 0", borderBottom: "1px solid var(--border)" }}
        >
          <div style={{ fontSize: "0.88rem" }}>
            <span style={{ color: "var(--ink-muted)" }}>
              {CONNECTION_KINDS[connection.kind] ?? connection.kind}:{" "}
            </span>
            <strong>{connection.targetName}</strong>
          </div>
          <div
            style={{
              display: "flex",
              gap: "0.7rem",
              flexWrap: "wrap",
              fontSize: "0.76rem",
              color: "var(--ink-muted)",
            }}
          >
            {connection.description && <span>{connection.description}</span>}
            <Source url={connection.sourceUrl} name={connection.sourceName} />
          </div>
        </li>
      ))}
    </ul>
  );
}

const th: React.CSSProperties = {
  textAlign: "start",
  padding: "0.3rem 0.6rem",
  borderBottom: "1px solid var(--border-strong)",
  color: "var(--ink-secondary)",
  fontWeight: 600,
  whiteSpace: "nowrap",
};

const td: React.CSSProperties = {
  textAlign: "start",
  padding: "0.28rem 0.6rem",
  borderBottom: "1px solid var(--border)",
  color: "var(--ink-secondary)",
};

// Counts are centred over their heading so the columns read as a grid rather
// than as four numbers drifting away from their labels.
const thNum: React.CSSProperties = { ...th, textAlign: "center", width: "4.5rem" };
const tdNum: React.CSSProperties = { ...td, textAlign: "center" };
