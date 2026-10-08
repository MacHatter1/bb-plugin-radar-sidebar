import {
  type ExperimentalSidebarNavigationProps,
} from "@get-bb/plugin-sdk/app";
import { RadarRailNavigation } from "./RadarRailNavigation";
import { RadarStandardNavigation } from "./RadarStandardNavigation";
import { useSettingValues } from "./settingsStore";

/** Keep the published slot and normal layout stable for existing installs. */
export function RadarNavigation(props: ExperimentalSidebarNavigationProps) {
  const { railNav } = useSettingValues();
  return railNav ? (
    <RadarRailNavigation {...props} />
  ) : (
    <RadarStandardNavigation {...props} />
  );
}
