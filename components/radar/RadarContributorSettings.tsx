import { useId, useState } from "react";
import { useContributions } from "./useContributions";
import { useSetContributorEnabled } from "./settingsStore";
import type { RadarContributor } from "@/lib/contributions";

function ContributorRow({ contributor }: { contributor: RadarContributor }) {
  const id = useId();
  const save = useSetContributorEnabled();
  const [failed, setFailed] = useState(false);
  return (
    <div className="radar-setting">
      <div className="radar-setting-text">
        <span className="radar-setting-label" id={id}>{contributor.name}</span>
        <span className="radar-setting-hint">{contributor.pluginId}</span>
        {failed ? <span className="radar-settings-error" role="alert">Couldn’t save this contributor. Try again.</span> : null}
      </div>
      <div className="radar-setting-control">
        <button type="button" role="switch" aria-checked={contributor.enabled} aria-labelledby={id}
          className={`radar-switch${contributor.enabled ? " radar-switch-on" : ""}`}
          onClick={() => {
            setFailed(false);
            void save(contributor.pluginId, !contributor.enabled).then((saved) => setFailed(!saved));
          }}>
          <span className="radar-switch-thumb" aria-hidden="true" />
        </button>
      </div>
    </div>
  );
}

export function RadarContributorSettings({ disabled }: { disabled: Readonly<Record<string, boolean>> }) {
  const { status, contributors, client } = useContributions([], disabled);
  return (
    <section className="radar-settings-card" aria-label="Plugin contributions">
      <header className="radar-settings-card-head">
        <h3>Plugin contributions</h3>
        <p>Thread badges and menu actions from other plugins. Turning one off here keeps the plugin itself enabled.</p>
      </header>
      <div className="radar-settings-rows">
        {contributors.map((contributor) => <ContributorRow key={contributor.pluginId} contributor={contributor} />)}
        {contributors.length === 0 ? (
          <p className="radar-setting-hint" role="status">
            {status === "loading" ? "Looking for contributors…"
              : status === "unavailable" ? "Contribution discovery is unavailable. Your usual sidebar still works."
              : "No enabled BB plugins currently publish Radar v1 contributions."}
          </p>
        ) : null}
        <button type="button" className="radar-contributor-refresh" onClick={client.reconcile} aria-label="Refresh plugin contributions">
          Refresh
        </button>
      </div>
    </section>
  );
}
