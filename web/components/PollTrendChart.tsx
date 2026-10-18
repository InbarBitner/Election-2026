"use client";

import { useMemo, useState } from "react";
import {
  Area,
  CartesianGrid,
  ComposedChart,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { formatShortDate } from "@/lib/format";
import { bandKey, type ChartRow } from "@/lib/pollAverage";

export type ChartParty = {
  id: string;
  name: string;
  color: string;
  colorDark: string;
  average: number;
};

type Props = {
  rows: ChartRow[];
  parties: ChartParty[];
  windowDays: number;
  onWindowChange?: (days: number) => void;
  windowOptions?: number[];
};

/**
 * The number of lines a reader can actually follow at once. Beyond this the
 * chart stops being a chart, so parties are selected rather than cycled
 * through generated colours.
 */
const MAX_SERIES = 6;
const WINDOW_OPTIONS = [7, 14, 30];

export default function PollTrendChart({
  rows,
  parties,
  windowDays,
  onWindowChange,
  windowOptions = WINDOW_OPTIONS,
}: Props) {
  const [selected, setSelected] = useState<string[]>(() =>
    parties.slice(0, MAX_SERIES).map((p) => p.id),
  );
  const [showTable, setShowTable] = useState(false);

  const isDark =
    typeof window !== "undefined" &&
    window.matchMedia?.("(prefers-color-scheme: dark)").matches;

  const shown = useMemo(
    () => parties.filter((p) => selected.includes(p.id)),
    [parties, selected],
  );

  function toggle(id: string) {
    setSelected((current) => {
      if (current.includes(id)) {
        // Never leave the chart with nothing on it.
        return current.length === 1 ? current : current.filter((x) => x !== id);
      }
      if (current.length >= MAX_SERIES) return current;
      return [...current, id];
    });
  }

  const colorOf = (party: ChartParty) => (isDark ? party.colorDark : party.color);
  const atLimit = selected.length >= MAX_SERIES;

  return (
    <div>
      {/* Filters sit in one row above the chart. */}
      <div
        style={{
          display: "flex",
          flexWrap: "wrap",
          gap: "0.5rem",
          alignItems: "center",
          marginBottom: "0.9rem",
        }}
      >
        <span className="text-muted" style={{ fontSize: "12px" }}>
          חלון הממוצע:
        </span>
        <span className="seg">
          {windowOptions.map((days) => (
            <button
              key={days}
              type="button"
              className="seg-opt"
              onClick={() => onWindowChange?.(days)}
              aria-pressed={days === windowDays}
            >
              {days} ימים
            </button>
          ))}
        </span>
        <button
          type="button"
          className="btn btn-secondary"
          onClick={() => setShowTable((v) => !v)}
          style={{ marginInlineStart: "auto" }}
        >
          {showTable ? "הצג גרף" : "הצג טבלה"}
        </button>
      </div>

      {showTable ? (
        <div className="scroll-x">
          <table className="table" style={{ minWidth: "34rem" }}>
            <caption
              className="text-muted"
              style={{ captionSide: "top", textAlign: "start", paddingBottom: "8px", fontSize: "12px" }}
            >
              ממוצע נע במנדטים, לפי תאריך. בסוגריים טווח אי-הוודאות.
            </caption>
            <thead>
              <tr>
                <th>תאריך</th>
                {shown.map((party) => (
                  <th key={party.id}>
                    {party.name}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.slice(-30).map((row) => (
                <tr key={String(row.date)}>
                  <td>{String(row.date)}</td>
                  {shown.map((party) => (
                    <td key={party.id} className="ltr-nums">
                      {typeof row[party.id] === "number" ? (
                        <>
                          {(row[party.id] as number).toFixed(1)}
                          {Array.isArray(row[bandKey(party.id)]) && (
                            <span className="text-muted">
                              {" "}
                              ({(row[bandKey(party.id)] as [number, number])[0].toFixed(1)}–
                              {(row[bandKey(party.id)] as [number, number])[1].toFixed(1)})
                            </span>
                          )}
                        </>
                      ) : (
                        "—"
                      )}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div style={{ width: "100%", height: 340 }}>
          <ResponsiveContainer>
            <ComposedChart data={rows} margin={{ top: 8, right: 8, bottom: 4, left: 8 }}>
              <CartesianGrid stroke="var(--chart-grid)" vertical={false} />
              {/*
                The time axis deliberately stays left-to-right even though the
                page is RTL: a time series reading oldest-left is the universal
                convention, Israeli media included, and mirroring it makes the
                trend harder to read rather than easier.
              */}
              <XAxis
                dataKey="date"
                tickFormatter={(value: string) => formatShortDate(value)}
                stroke="var(--color-divider)"
                tickLine={false}
                minTickGap={40}
              />
              <YAxis
                stroke="var(--color-divider)"
                tickLine={false}
                axisLine={false}
                width={34}
                domain={[0, "auto"]}
                orientation="right"
              />
              <Tooltip
                contentStyle={{
                  background: "var(--color-bg)",
                  border: "1px solid var(--color-divider)",
                  borderRadius: "var(--radius-md)",
                  direction: "rtl",
                  fontSize: "13px",
                  color: "var(--color-text)",
                }}
                labelFormatter={(label) => `נכון ל-${String(label)}`}
                formatter={(value, name, item) => {
                  // The band is drawn, not listed: its own row would repeat the
                  // range that already sits beside the mean.
                  const row = (item?.payload ?? {}) as Record<string, unknown>;
                  const id = String(item?.dataKey ?? "");
                  const band = row[bandKey(id)];
                  const range = Array.isArray(band)
                    ? ` (${Number(band[0]).toFixed(1)}–${Number(band[1]).toFixed(1)})`
                    : "";
                  return [`${Number(value).toFixed(1)} מנדטים${range}`, String(name)];
                }}
              />
              {/*
                The uncertainty band, drawn first so the lines sit on top of it.
                It is deliberately recessive — the reader should register width,
                not a second set of shapes — and it carries no legend entry,
                since it belongs to the series whose colour it already shares.
              */}
              {shown.map((party) => (
                <Area
                  key={`${party.id}-band`}
                  dataKey={bandKey(party.id)}
                  fill={colorOf(party)}
                  fillOpacity={0.13}
                  stroke="none"
                  legendType="none"
                  tooltipType="none"
                  activeDot={false}
                  isAnimationActive={false}
                />
              ))}
              {shown.map((party) => (
                <Line
                  key={party.id}
                  type="monotone"
                  dataKey={party.id}
                  name={party.name}
                  stroke={colorOf(party)}
                  strokeWidth={2}
                  dot={false}
                  activeDot={{ r: 4, strokeWidth: 2, stroke: "var(--color-bg)" }}
                  isAnimationActive={false}
                />
              ))}
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      )}

      {/* The legend doubles as the series picker, and is always present. */}
      <div
        style={{
          display: "flex",
          flexWrap: "wrap",
          gap: "0.4rem",
          marginTop: "0.9rem",
        }}
      >
        {parties.map((party) => {
          const on = selected.includes(party.id);
          const disabled = !on && atLimit;
          return (
            <button
              key={party.id}
              type="button"
              onClick={() => toggle(party.id)}
              aria-pressed={on}
              disabled={disabled}
              title={
                disabled ? `ניתן להציג עד ${MAX_SERIES} מפלגות בו-זמנית` : undefined
              }
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: "0.4rem",
                border: "1px solid var(--color-divider)",
                background: on
                  ? "color-mix(in srgb, var(--color-text) 7%, transparent)"
                  : "transparent",
                opacity: disabled ? 0.45 : 1,
                borderRadius: "var(--radius-md)",
                padding: "5px 10px",
                fontSize: "13px",
                color: "inherit",
                cursor: disabled ? "not-allowed" : "pointer",
                font: "inherit",
              }}
            >
              <span
                aria-hidden="true"
                style={{
                  width: 9,
                  height: 9,
                  background: colorOf(party),
                  opacity: on ? 1 : 0.3,
                }}
              />
              {party.name}
              <span className="num ltr-nums text-muted">
                {party.average.toFixed(1)}
              </span>
            </button>
          );
        })}
      </div>
      <p className="text-muted" style={{ fontSize: "11px", marginTop: "10px" }}>
        ניתן להציג עד {MAX_SERIES} מפלגות בו-זמנית — מעבר לכך הגרף מפסיק להיות קריא.
        לחיצה על שם מפלגה מוסיפה או מסירה אותה.
      </p>
    </div>
  );
}

