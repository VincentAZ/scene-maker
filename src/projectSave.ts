import { type Scene } from "../shared/scene";
const content = (s: Scene) => JSON.stringify({ ...s, revision: 0 });
// One writer per editor session; every caller awaits the same drain. Edits made
// during an in-flight save are persisted with the returned revision before flush resolves.
export class ProjectSaveQueue {
  private pending: Promise<void> | null = null;
  constructor(
    private getCurrent: () => Scene,
    private accept: (saved: Scene) => void,
    private write: (snapshot: Scene) => Promise<Scene>,
  ) {}
  flush(): Promise<void> {
    if (!this.pending)
      this.pending = this.drain().finally(() => {
        this.pending = null;
      });
    return this.pending;
  }
  private async drain() {
    for (;;) {
      const snapshot = structuredClone(this.getCurrent());
      const saved = await this.write(snapshot);
      const current = this.getCurrent();
      if (current.id !== snapshot.id)
        throw Error("The active project changed before saving finished.");
      if (saved.id !== snapshot.id || saved.revision <= snapshot.revision)
        throw Error("The studio returned an invalid save acknowledgement.");
      this.accept({ ...current, revision: saved.revision });
      if (content(snapshot) === content(current)) return;
    }
  }
}
