import type { PluginAppSlots } from "@get-bb/plugin-sdk/app";
import { RadarProjectRail } from "./RadarProjectRail";

/** The fork's optional slot isn't in the published SDK yet. Detect the
 * public registration at setup time; importing removed hooks would prevent
 * every Radar slot from loading on older BB clients. */
export function registerProjectRail(slots: PluginAppSlots): boolean {
  const register: unknown = Reflect.get(slots, "experimental_navRailSection");
  if (typeof register !== "function") return false;
  register.call(slots, {
    id: "projects",
    title: "Radar projects",
    component: RadarProjectRail,
  });
  return true;
}
