import {
  useSettings,
  type ExperimentalSidebarNavigationProps,
} from "@get-bb/plugin-sdk/app";
import { RadarRailNavigation } from "./RadarRailNavigation";
import { RadarStandardNavigation } from "./RadarStandardNavigation";

/** Keep the published slot and normal layout stable for existing installs. */
export function RadarNavigation(props: ExperimentalSidebarNavigationProps) {
  const { values } = useSettings();
  return values?.railNav === true ? (
    <RadarRailNavigation {...props} />
  ) : (
    <RadarStandardNavigation {...props} />
  );
}
