import { TrendDown, TrendUp } from "@phosphor-icons/react";
import type { CompanyAlert } from "../../../types/alert";
import { SourceMark } from "../shared/SourceMark";
import {
  DIRECTION_LABELS,
  TIER_LABELS,
  directionColor,
  timeAgo,
} from "./alertFormat";
import { useCompanyAlerts } from "./useAlerts";

const MAX_SHOWN = 2;

/**
 * "Alerts affecting <ticker>" for the market sidebar (spec UI option 2): the
 * last day's unusual market moves matched back to the searched company, with
 * why it was matched. Renders nothing when there are none, so the sidebar
 * stays about recommendations until something actually moved.
 */
export function CompanyAlerts({ ticker }: { ticker: string | null }) {
  const { alerts, status } = useCompanyAlerts(ticker);
  if (!ticker || status !== "ready" || alerts.length === 0) return null;

  return (
    <section
      aria-label={`Alerts affecting ${ticker}`}
      className="flex flex-col gap-1.5"
    >
      <span
        className="text-[10px] font-semibold uppercase tracking-wider"
        style={{ color: "var(--text-tertiary)" }}
      >
        Alerts affecting {ticker} · 24h
      </span>
      <ul className="flex flex-col gap-1.5">
        {alerts.slice(0, MAX_SHOWN).map((a) => (
          <Row key={a.id} alert={a} />
        ))}
      </ul>
      {alerts.length > MAX_SHOWN && (
        <p className="text-[10px]" style={{ color: "var(--text-tertiary)" }}>
          +{alerts.length - MAX_SHOWN} more in the alerts feed
        </p>
      )}
    </section>
  );
}

function Row({ alert }: { alert: CompanyAlert }) {
  const Trend = alert.direction === "yes_up" ? TrendUp : TrendDown;
  const title = alert.eventTitle ?? alert.title ?? alert.marketId;
  const why =
    alert.tier === 1
      ? TIER_LABELS[1]
      : alert.tier === 2
        ? `${TIER_LABELS[2]} via ${alert.matched.join(", ")}`
        : `${TIER_LABELS[3]}${alert.relevance !== null ? ` · ${Math.round(alert.relevance * 100)}%` : ""}`;
  return (
    <li
      className="flex flex-col gap-1 px-2.5 py-2"
      style={{
        background: "var(--bg)",
        border: "1px solid var(--border)",
        borderRadius: "var(--radius-control)",
      }}
    >
      <div className="flex items-start gap-2">
        <SourceMark
          source={alert.source === "kalshi" ? "kalshi" : "polymarket"}
        />
        <a
          href={alert.url ?? undefined}
          target="_blank"
          rel="noreferrer"
          className="line-clamp-2 text-xs font-semibold leading-snug hover:underline"
          style={{ color: "var(--text-primary)" }}
        >
          {title}
        </a>
      </div>
      <p
        className="flex items-center gap-2 pl-7 text-[10px]"
        style={{ color: "var(--text-tertiary)" }}
      >
        <span
          className="flex items-center gap-0.5 font-semibold"
          style={{ color: directionColor(alert.direction) }}
        >
          <Trend size={10} weight="bold" aria-hidden="true" />
          {DIRECTION_LABELS[alert.direction]}
        </span>
        <span className="truncate">{why}</span>
        <span className="ml-auto shrink-0 tabular-nums">
          {timeAgo(alert.createdAt)}
        </span>
      </p>
    </li>
  );
}
