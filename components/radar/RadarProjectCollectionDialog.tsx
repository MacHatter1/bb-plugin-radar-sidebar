import { useState, type RefObject } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { ProjectOrganisation, ProjectOrganisationChange } from "@/lib/projectOrganisation";
import { useNativeBrowserModal } from "./useNativeBrowserModal";

export type CollectionDialogTarget = { kind: "move"; projectId: string } | { kind: "rename"; collectionId: string };
export function RadarProjectCollectionDialog({ target, organisation, save, onClose, triggerRef }: {
  target: CollectionDialogTarget;
  organisation: ProjectOrganisation;
  save: (change: ProjectOrganisationChange) => Promise<boolean>;
  onClose: () => void;
  triggerRef: RefObject<HTMLElement | null>;
}) {
  const [choice, setChoice] = useState(target.kind === "move" ? organisation.projectCollections[target.projectId] ?? "none" : "rename");
  const [name, setName] = useState(target.kind === "rename" ? organisation.collections[target.collectionId]?.name ?? "" : "");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const ready = useNativeBrowserModal();
  const naming = target.kind === "rename" || choice === "new";
  return <Dialog.Root open={ready} onOpenChange={open => { if (!open && !pending) onClose(); }}>
    <Dialog.Portal>
      <Dialog.Overlay className="radar-collection-overlay" />
      <Dialog.Content className="radar-collection-dialog" aria-modal="true" onKeyDown={event => event.stopPropagation()}
        onCloseAutoFocus={event => { event.preventDefault(); triggerRef.current?.focus(); }}>
        <Dialog.Title>{target.kind === "rename" ? "Rename collection" : "Move project to collection"}</Dialog.Title>
        <Dialog.Description>Collections group projects in the rail. Pinned projects stay visible above collections.</Dialog.Description>
        <form aria-busy={pending} onSubmit={async event => {
          event.preventDefault();
          if (pending || (naming && !name.trim())) return;
          setPending(true);
          setError(null);
          const change: ProjectOrganisationChange = target.kind === "rename"
            ? { kind: "rename-collection", collectionId: target.collectionId, name }
            : choice === "new"
              ? { kind: "create-collection", collectionId: crypto.randomUUID(), name, projectId: target.projectId }
              : { kind: "assign-collection", projectId: target.projectId, collectionId: choice === "none" ? null : choice };
          if (await save(change)) onClose();
          else { setError("Couldn’t save the collection. Please try again."); setPending(false); }
        }}>
          {target.kind === "move" ? <label>Collection
            <select aria-label="Collection" value={choice} disabled={pending} onChange={event => setChoice(event.target.value)}>
              <option value="none">No collection</option>
              {Object.entries(organisation.collections).map(([id, collection]) => <option key={id} value={id}>{collection.name}</option>)}
              <option value="new">New collection…</option>
            </select>
          </label> : null}
          {naming ? <label>Collection name<Input aria-label="Collection name" maxLength={64} required value={name} disabled={pending} onChange={event => setName(event.target.value)} /></label> : null}
          {error ? <p role="alert">{error}</p> : null}
          <div className="radar-collection-dialog-actions">
            <Button variant="ghost" type="button" disabled={pending} onClick={onClose}>Cancel</Button>
            <Button type="submit" disabled={pending || (naming && !name.trim())}>{pending ? "Saving…" : "Save collection"}</Button>
          </div>
        </form>
      </Dialog.Content>
    </Dialog.Portal>
  </Dialog.Root>;
}
