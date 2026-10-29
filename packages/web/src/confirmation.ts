import { shallowReactive } from "vue";

export class ActionCancelled extends Error {
  constructor() {
    super("Action cancelled");
  }
}

export const confirmation = shallowReactive({ open: false, revision: 0 });
let contextRevision = 0;
let confirmedRevision = 0;
let pending:
  | {
      promise: Promise<void>;
      resolve: () => void;
      reject: (error: Error) => void;
    }
  | undefined;

export function actionRevision(): number {
  return contextRevision;
}
export function confirmationRevision(): number {
  return confirmedRevision;
}

export function assertAction(revision: number): void {
  if (revision !== contextRevision) throw new ActionCancelled();
}

export function confirmAction(): Promise<void> {
  if (!pending) {
    let resolve!: () => void;
    let reject!: (error: Error) => void;
    const promise = new Promise<void>((done, fail) => {
      resolve = done;
      reject = fail;
    });
    pending = { promise, resolve, reject };
    confirmation.revision++;
    confirmation.open = true;
  }
  return pending.promise;
}

export function finishConfirmation(revision: number): void {
  if (!pending || revision !== confirmation.revision) return;
  const completed = pending;
  pending = undefined;
  confirmation.open = false;
  confirmedRevision++;
  completed.resolve();
}

export function cancelConfirmation(): void {
  contextRevision++;
  confirmation.revision++;
  confirmation.open = false;
  const cancelled = pending;
  pending = undefined;
  cancelled?.reject(new ActionCancelled());
}
