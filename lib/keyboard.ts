/** Composition owns its keys, including Safari's IME-confirmation keyCode 229. */
export function isComposingKey(event: Pick<KeyboardEvent, "isComposing" | "keyCode">): boolean {
  return event.isComposing || event.keyCode === 229;
}
