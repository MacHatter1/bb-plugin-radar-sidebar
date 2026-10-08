import { Component, type ComponentType, type ReactNode } from "react";

/** Each placement fails independently; a broken plugin cannot take down navigation. */
export class SidebarAccessory extends Component<{
  Accessory: ComponentType;
  fallback?: ReactNode;
}, { failed: boolean; source: ComponentType }> {
  state = { failed: false, source: this.props.Accessory };

  static getDerivedStateFromProps(props: SidebarAccessory["props"], state: SidebarAccessory["state"]) {
    return props.Accessory !== state.source ? { failed: false, source: props.Accessory } : null;
  }

  static getDerivedStateFromError() {
    return { failed: true };
  }

  render() {
    const { Accessory, fallback = null } = this.props;
    return this.state.failed ? fallback : <Accessory />;
  }
}
