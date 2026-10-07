// Minimal change notification so screens reload after local edits or a sync pull.
type Listener = () => void;
const listeners = new Set<Listener>();

export function onDataChanged(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function emitDataChanged(): void {
  listeners.forEach((l) => l());
}
