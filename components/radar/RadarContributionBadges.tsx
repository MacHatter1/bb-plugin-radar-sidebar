import { experimental_Icon as HostIcon } from "@get-bb/plugin-sdk/app";
import type { OwnedRadarBadge } from "@/lib/contributions";
import { RADAR_MAX_BADGES } from "../../packages/contributions/src/index";

export function RadarContributionBadges({ badges }: { badges: readonly OwnedRadarBadge[] }) {
  if (badges.length === 0) return null;
  const overflow = badges.slice(RADAR_MAX_BADGES);
  return (
    <span className="radar-contribution-badges">
      {badges.slice(0, RADAR_MAX_BADGES).map((badge) => {
        const label = `${badge.pluginName}: ${badge.label}`;
        return (
          <span key={badge.key} className={`radar-contribution-badge radar-contribution-tone-${badge.tone ?? "neutral"}`}
            title={label} role="img" aria-label={label}>
            <HostIcon name={badge.icon ?? "Puzzle"} aria-hidden="true" />
            {badge.text ? <span>{badge.text}</span> : null}
          </span>
        );
      })}
      {overflow.length > 0 ? (
        <span className="radar-contribution-overflow" role="img"
          aria-label={overflow.map((badge) => `${badge.pluginName}: ${badge.label}`).join("; ")}
          title={overflow.map((badge) => `${badge.pluginName}: ${badge.label}`).join("\n")}>
          +{overflow.length}
        </span>
      ) : null}
    </span>
  );
}
