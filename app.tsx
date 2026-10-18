// bb-plugin-radar-sidebar — a thread list you can read at a glance, for BB.
//
// Replaces the sidebar thread list (activity-grouped threads, nested families,
// loud attention states). Pick it under Settings → Appearance. Navigation
// belongs to BB's own rail since 0.46. Forks with the optional navigation-rail
// section can also show Radar's compact project tiles below the destinations.
import { definePluginApp } from "@get-bb/plugin-sdk/app";
import { migrateLegacyPreferences } from "./components/storage";
import { RadarThreadList } from "./components/radar/RadarThreadList";
import { RadarSettings } from "./components/radar/RadarSettings";
import { registerProjectRail } from "./components/radar/registerProjectRail";
import "./app.css";

// Runs before any slot renders, so preferences read below the rename are
// already carried forward from the `codex-sidebar:` era.
migrateLegacyPreferences();

export default definePluginApp((app) => {
  registerProjectRail(app.slots);
  app.slots.experimental_threadList({
    id: "radar",
    title: "Radar",
    description:
      "Activity-grouped threads, nested families, and loud attention states.",
    component: RadarThreadList,
  });
  app.slots.settingsSection({
    id: "radar",
    title: "Radar Sidebar",
    description:
      "Pick what the thread list shows. Each card previews its choices.",
    component: RadarSettings,
  });
});
