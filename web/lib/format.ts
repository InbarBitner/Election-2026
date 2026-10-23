/** Hebrew formatting helpers shared across the pages. */

export const BLOC_NAMES: Record<string, string> = {
  right: "הקואליציה",
  center: "גוש השינוי",
  arab: "המפלגות הערביות",
};

export const AXIS_NAMES: Record<string, string> = {
  security: "ביטחון ומדיני",
  economy: "כלכלה",
  religion: "דת ומדינה",
  governance: "משילות ומשפט",
  society: "חברה וזהות",
};

export const VOTE_POSITIONS: Record<string, string> = {
  for: "בעד",
  against: "נגד",
  abstain: "נמנע",
  absent: "נעדר",
};

export const BILL_STATUSES: Record<string, string> = {
  proposed: "הונחה על שולחן הכנסת",
  preliminary: "עברה בקריאה טרומית",
  "first-reading": "עברה בקריאה ראשונה",
  passed: "התקבלה",
  rejected: "נדחתה",
};

export const CONNECTION_KINDS: Record<string, string> = {
  "former-party": "מפלגה קודמת",
  committee: "ועדה",
  "co-sponsor": "שותפות לחקיקה",
  mentor: "קשר אישי",
  coalition: "שותפות קואליציונית",
};

export const EVENT_KINDS: Record<string, string> = {
  merger: "איחוד רשימות",
  split: "פיצול",
  coalition: "מהלך קואליציוני",
  poll_swing: "שינוי בסקרים",
  quote: "התבטאות",
  threshold: "אחוז החסימה",
};

/** One decimal, and a real minus sign rather than a hyphen. */
export function seats(value: number): string {
  return value.toFixed(1).replace("-", "−");
}

/** Signed change, for trend indicators. */
export function delta(value: number): string {
  if (Math.abs(value) < 0.05) return "ללא שינוי";
  const arrow = value > 0 ? "▲" : "▼";
  return `${arrow} ${Math.abs(value).toFixed(1)}`;
}

export function formatDate(value: Date | string): string {
  const date = typeof value === "string" ? new Date(value) : value;
  return new Intl.DateTimeFormat("he-IL", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(date);
}

export function formatShortDate(value: Date | string): string {
  const date = typeof value === "string" ? new Date(value) : value;
  return new Intl.DateTimeFormat("he-IL", {
    day: "numeric",
    month: "numeric",
    timeZone: "UTC",
  }).format(date);
}

/** Days remaining until election day, 27 October 2026. */
export const ELECTION_DATE = new Date("2026-10-27T00:00:00Z");

export function daysUntilElection(now: Date = new Date()): number {
  return Math.ceil((ELECTION_DATE.getTime() - now.getTime()) / 86_400_000);
}
