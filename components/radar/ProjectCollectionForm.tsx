import { useRef, useState } from "react";
import type { ProjectOrganisation, ProjectOrganisationChange } from "@/lib/projectOrganisation";

/** An inline editor in the project popover, so collection edits need no
 * app-wide modal or native-browser visibility workaround. */
export function ProjectCollectionForm({ projectId, organisation, save, onDone }: {
  projectId: string;
  organisation: ProjectOrganisation;
  save: (change: ProjectOrganisationChange) => Promise<boolean>;
  onDone: () => void;
}) {
  const [choice, setChoice] = useState(organisation.projectCollections[projectId] ?? "none");
  const [name, setName] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const submitting = useRef(false);
  return <form className="radar-project-collection-form" aria-label="Move project to collection" aria-busy={pending}
    onSubmit={async event => {
      event.preventDefault();
      if (submitting.current || (choice === "new" && !name.trim())) return;
      submitting.current = true;
      setPending(true);
      setError(null);
      const change: ProjectOrganisationChange = choice === "new"
        ? { kind: "create-collection", collectionId: crypto.randomUUID(), name: name.trim(), projectId }
        : { kind: "assign-collection", projectId, collectionId: choice === "none" ? null : choice };
      try {
        if (await save(change)) onDone();
        else setError("Couldn’t save the collection. Please try again.");
      } catch { setError("Couldn’t save the collection. Please try again."); }
      finally { submitting.current = false; setPending(false); }
    }}>
    <label>Collection<select aria-label="Collection" value={choice} disabled={pending} onChange={event => setChoice(event.target.value)}>
      <option value="none">No collection</option>
      {Object.entries(organisation.collections).map(([id, collection]) => <option key={id} value={id}>{collection.name}</option>)}
      <option value="new">New collection…</option>
    </select></label>
    {choice === "new" ? <label>Collection name<input autoFocus aria-label="Collection name" maxLength={64} required
      value={name} disabled={pending} onChange={event => setName(event.target.value)} /></label> : null}
    {error ? <p role="alert">{error}</p> : null}
    <div className="radar-project-card-actions">
      <button type="submit" disabled={pending || (choice === "new" && !name.trim())}>{pending ? "Saving…" : "Save collection"}</button>
      <button type="button" disabled={pending} onClick={onDone}>Cancel</button>
    </div>
  </form>;
}
