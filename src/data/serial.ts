// Runs writes one at a time. Screens hold row snapshots that go stale between fast taps, so
// repositories re-read the latest row inside the queue and apply only the caller's patch.
let tail: Promise<unknown> = Promise.resolve();

export function serial<T>(task: () => Promise<T>): Promise<T> {
  const run = tail.then(task, task);
  tail = run.catch(() => undefined);
  return run;
}
