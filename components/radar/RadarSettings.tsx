import { useId, useState, type CSSProperties } from "react";
import { cn } from "@/lib/utils";
import {
  SETTINGS,
  SETTING_GROUPS,
  SETTING_HINTS,
  SETTING_REQUIRES,
  type SettingKey,
} from "@/lib/settings";
import { ProjectBadges, type RailProject } from "./RadarRailNavigation";
import { monogram, projectHue } from "./railScope";
import { useSetSetting, useSettingValues } from "./settingsStore";

/** The plugin's settings as BB's Settings page shows them: grouped into cards,
 * each with a small live picture of what its switches change. A choice shows
 * at once and is kept on the server, so every device shares it. */
function useRadarSettings() {
  const values = useSettingValues({ refresh: true });
  const save = useSetSetting();
  const [failed, setFailed] = useState<SettingKey | null>(null);
  return {
    flag: (key: SettingKey): boolean => values[key] === true,
    text: (key: SettingKey): string => String(values[key]),
    failed,
    set: (key: SettingKey, value: boolean | string) => {
      setFailed(null);
      void save(key, value as never).then((saved) => {
        if (!saved) setFailed(key);
      });
    },
  };
}

type Settings = ReturnType<typeof useRadarSettings>;

function Switch({
  checked,
  disabled,
  labelledBy,
  describedBy,
  onChange,
}: {
  checked: boolean;
  disabled: boolean;
  labelledBy: string;
  describedBy: string;
  onChange: (next: boolean) => void;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-labelledby={labelledBy}
      aria-describedby={describedBy}
      disabled={disabled}
      className={cn("radar-switch", checked && "radar-switch-on")}
      onClick={() => onChange(!checked)}
    >
      <span className="radar-switch-thumb" aria-hidden="true" />
    </button>
  );
}

function SettingRow({
  settingKey,
  settings,
}: {
  settingKey: SettingKey;
  settings: Settings;
}) {
  const id = useId();
  const descriptor = SETTINGS[settingKey];
  const requires = SETTING_REQUIRES[settingKey];
  const disabled = requires !== undefined && !settings.flag(requires);
  const labelId = `${id}-label`;
  const hintId = `${id}-hint`;

  return (
    <div className={cn("radar-setting", disabled && "radar-setting-disabled")}>
      <div className="radar-setting-text" title={descriptor.description}>
        <span className="radar-setting-label" id={labelId}>
          {descriptor.label}
        </span>
        <span className="radar-setting-hint" id={hintId}>
          {SETTING_HINTS[settingKey]}
        </span>
        {disabled && requires ? (
          <span className="radar-setting-needs">
            Turn on {SETTINGS[requires].label} first
          </span>
        ) : null}
      </div>
      <div className="radar-setting-control">
        {descriptor.type === "boolean" ? (
          <Switch
            checked={settings.flag(settingKey)}
            disabled={disabled}
            labelledBy={labelId}
            describedBy={hintId}
            onChange={(next) => settings.set(settingKey, next)}
          />
        ) : descriptor.type === "select" ? (
          <select
            className="radar-select"
            value={settings.text(settingKey)}
            disabled={disabled}
            aria-labelledby={labelId}
            aria-describedby={hintId}
            onChange={(event) =>
              settings.set(settingKey, event.target.value)
            }
          >
            {descriptor.options.map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </select>
        ) : null}
      </div>
    </div>
  );
}

/* ---- Live pictures: the plugin's own classes, fed the current choices. ---- */

const RAIL_SAMPLE: (Omit<RailProject, "latest" | "live" | "threads"> & {
  id: string;
})[] = [
  { id: "p-api", name: "api-server", waiting: 1, active: 0, unread: 0 },
  { id: "p-app", name: "bb-appimage", waiting: 0, active: 2, unread: 3 },
  { id: "p-docs", name: "docs-site", waiting: 0, active: 0, unread: 12 },
];

function RailPreview({ settings }: { settings: Settings }) {
  const railNav = settings.flag("railNav");
  const wide = settings.flag("wideRail");
  const badges = settings.flag("projectBadges");

  if (!railNav) {
    return (
      <div className="radar-settings-above" aria-hidden="true">
        <div className="radar-settings-above-nav">
          <span />
          <span />
          <span />
          <span />
        </div>
        <i />
        <i />
        <i />
        <em>Navigation sits above the list</em>
      </div>
    );
  }

  // With badges on, the project that needs you floats to the top.
  const tiles = badges
    ? RAIL_SAMPLE
    : [RAIL_SAMPLE[1]!, RAIL_SAMPLE[2]!, RAIL_SAMPLE[0]!];
  return (
    <div className="radar-settings-railrow" aria-hidden="true">
    <div
      className={cn(
        "radar-double-navigation radar-settings-rail",
        wide && "radar-double-navigation-wide",
      )}
      style={{ "--radar-rail-width": wide ? "176px" : "60px" } as CSSProperties}
    >
      <nav className="radar-double-rail">
        <div className="radar-rail-projects">
          {tiles.map((project) => (
            <button
              key={project.id}
              type="button"
              tabIndex={-1}
              className="radar-nav-icon-button radar-rail-project"
              style={
                { "--radar-project-hue": projectHue(project.id) } as CSSProperties
              }
            >
              <span className="radar-rail-monogram">
                {monogram(project.name)}
              </span>
              <span className="radar-rail-label">{project.name}</span>
              {badges ? (
                <ProjectBadges
                  project={{ ...project, threads: 1, live: 0, latest: 0 }}
                />
              ) : null}
            </button>
          ))}
        </div>
      </nav>
    </div>
    <div className="radar-settings-lines">
      <i />
      <i />
      <i />
    </div>
    </div>
  );
}

function SampleRow({
  title,
  subtitle,
  time,
  className,
  collapsed = false,
  compact,
  unread = false,
  status,
}: {
  title: string;
  subtitle: string;
  time: string;
  className?: string;
  collapsed?: boolean;
  compact: boolean;
  unread?: boolean;
  status?: "attention";
}) {
  return (
    <div
      className={cn(
        "radar-row radar-row-root",
        compact && "radar-row-compact",
        collapsed && "radar-row-collapsed",
        className,
      )}
    >
      <div className="radar-row-main">
        <span className="radar-row-text">
          <span className="radar-row-title">
            <span className="radar-row-title-text">
              <span className="radar-thread-title">{title}</span>
            </span>
            <span className="radar-row-meta">
              <span
                className="radar-row-project"
                style={{ "--radar-project-hue": 250 } as CSSProperties}
              >
                web
              </span>
              <span className="radar-row-time">{time}</span>
            </span>
          </span>
          <span
            className={cn(
              "radar-row-extra",
              collapsed && "radar-row-extra-collapsed",
            )}
          >
            <span className="radar-row-extra-inner">
              <span className="radar-row-subtitle">{subtitle}</span>
            </span>
          </span>
        </span>
        <span className="radar-row-badges">
          {unread ? <span className="radar-unread" /> : null}
          {status === "attention" ? (
            <span className="radar-dot radar-dot-attention radar-dot-pulse" />
          ) : null}
        </span>
      </div>
    </div>
  );
}

function RowsPreview({ settings }: { settings: Settings }) {
  const compact = settings.text("defaultDensity") === "compact";
  return (
    <div
      className={cn(
        "radar-list radar-settings-list",
        compact && "radar-density-compact",
        settings.flag("twoLineTitles") && "radar-title-wrap",
      )}
      data-radar-loud-unread={settings.flag("loudUnread") ? "on" : "off"}
      data-radar-motion="off"
      aria-hidden="true"
    >
      <SampleRow
        title="Fix the login redirect loop on Safari and add a regression test for the callback"
        subtitle="Finished · 12 tests passed"
        time="2m"
        compact={compact}
        unread
        className="radar-row-unread"
      />
      <SampleRow
        title="Tidy the README screenshots"
        subtitle="Idle · nothing waiting"
        time="3h"
        compact={compact}
        collapsed={settings.flag("adaptiveCollapse")}
      />
    </div>
  );
}

function AttentionPreview({ settings }: { settings: Settings }) {
  const compact = settings.text("defaultDensity") === "compact";
  return (
    <div
      className="radar-list radar-settings-list"
      data-radar-loud-unread="on"
      data-radar-motion={settings.flag("motion") ? "on" : "off"}
      aria-hidden="true"
    >
      <SampleRow
        title="Approve the database migration?"
        subtitle="Waiting for your answer"
        time="now"
        compact={compact}
        status="attention"
        className="radar-row-needs-user radar-row-pulse-amber"
      />
    </div>
  );
}

function SwipePreview({ settings }: { settings: Settings }) {
  const on = settings.flag("swipeActions");
  return (
    <div
      className={cn("radar-settings-swipe", !on && "radar-settings-swipe-off")}
      aria-hidden="true"
    >
      <span className="radar-settings-swipe-chip radar-settings-swipe-left">
        {settings.text("swipeLeft")}
      </span>
      <span className="radar-settings-swipe-row">
        <i />
        <i />
      </span>
      <span className="radar-settings-swipe-chip radar-settings-swipe-right">
        {settings.text("swipeRight")}
      </span>
    </div>
  );
}

const PREVIEWS = {
  rail: RailPreview,
  rows: RowsPreview,
  attention: AttentionPreview,
  swipe: SwipePreview,
} as const;

export function RadarSettings() {
  const settings = useRadarSettings();
  return (
    <div className="radar-settings">
      {SETTING_GROUPS.map((group) => {
        const Preview = PREVIEWS[group.id];
        return (
          <section
            key={group.id}
            className="radar-settings-card"
            aria-label={group.title}
          >
            <header className="radar-settings-card-head">
              <h3>{group.title}</h3>
              <p>{group.description}</p>
            </header>
            <div className="radar-settings-preview">
              <Preview settings={settings} />
            </div>
            <div className="radar-settings-rows">
              {group.keys.map((key) => (
                <SettingRow key={key} settingKey={key} settings={settings} />
              ))}
            </div>
          </section>
        );
      })}
      {settings.failed ? (
        <p className="radar-settings-error" role="alert">
          Couldn’t save {SETTINGS[settings.failed].label}. Try again.
        </p>
      ) : null}
    </div>
  );
}
