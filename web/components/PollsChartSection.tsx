"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useTransition } from "react";
import type { ChartRow } from "@/lib/pollAverage";
import PollTrendChart, { type ChartParty } from "./PollTrendChart";

/**
 * Connects the chart's window selector to the URL, so the averaging window is
 * shareable and the server recomputes the series rather than the client
 * holding three copies of the data.
 */
export default function PollsChartSection({
  rows,
  parties,
  windowDays,
}: {
  rows: ChartRow[];
  parties: ChartParty[];
  windowDays: number;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [pending, startTransition] = useTransition();

  function changeWindow(days: number) {
    const params = new URLSearchParams(searchParams.toString());
    params.set("window", String(days));
    startTransition(() => router.replace(`?${params.toString()}`, { scroll: false }));
  }

  return (
    <div style={{ opacity: pending ? 0.6 : 1, transition: "opacity 120ms" }}>
      <PollTrendChart
        rows={rows}
        parties={parties}
        windowDays={windowDays}
        onWindowChange={changeWindow}
      />
    </div>
  );
}
