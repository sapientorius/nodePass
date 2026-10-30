import { shallowReactive } from "vue";
import {
  languages,
  type Language,
  type RestoreStatus,
  type RestoreTicket,
} from "@nodepass/contracts";

const storageKey = "nodepass-restore-status";
export const backupProgress = shallowReactive({
  ticket: null as {
    id: string;
    statusToken: string;
    language?: Language;
  } | null,
  status: null as RestoreStatus | null,
  unavailable: false,
});
export function rememberRestore(
  ticket: RestoreTicket,
  language?: Language,
): void {
  const saved = { id: ticket.id, statusToken: ticket.statusToken, language };
  backupProgress.ticket = saved;
  backupProgress.status = ticket;
  // This token grants status access only. Keys, credentials and restore grants are never stored.
  sessionStorage.setItem(storageKey, JSON.stringify(saved));
}
export function forgetRestore(): void {
  sessionStorage.removeItem(storageKey);
  backupProgress.ticket = null;
  backupProgress.status = null;
  backupProgress.unavailable = false;
}
export function loadRestoreTicket(): void {
  try {
    const value = JSON.parse(sessionStorage.getItem(storageKey) ?? "null");
    if (
      value &&
      /^[A-Za-z0-9_-]{43}$/.test(value.id) &&
      /^[A-Za-z0-9_-]{43}$/.test(value.statusToken)
    )
      backupProgress.ticket = {
        id: value.id,
        statusToken: value.statusToken,
        language: languages.includes(value.language)
          ? value.language
          : undefined,
      };
  } catch {
    forgetRestore();
  }
}
let polling = false;
export async function pollRestore(): Promise<void> {
  const ticket = backupProgress.ticket;
  if (!ticket || polling) return;
  polling = true;
  try {
    const response = await fetch(
      `/api/v1/backup-restores/${ticket.id}/status`,
      {
        credentials: "omit",
        cache: "no-store",
        headers: { "x-backup-job-token": ticket.statusToken },
      },
    );
    if (backupProgress.ticket !== ticket) return;
    if (response.status === 404) {
      forgetRestore();
      return;
    }
    if (!response.ok) throw new Error("Unavailable");
    const status = (await response.json()) as RestoreStatus;
    if (backupProgress.ticket !== ticket) return;
    backupProgress.status = status;
    backupProgress.unavailable = false;
  } catch {
    if (backupProgress.ticket === ticket) backupProgress.unavailable = true;
  } finally {
    polling = false;
  }
}
export function backupStepKey(step: string): string {
  return (
    (
      {
        upload: "backupUploading",
        checking: "backupChecking",
        ready: "backupReady",
        creating: "backupCreating",
        maintenance: "backupMaintenance",
        safety: "backupSafetyStep",
        replacing: "backupReplacing",
        verifying: "backupVerifying",
        complete: "backupComplete",
        cancelled: "backupCancelled",
        expired: "backupExpired",
        rolledBack: "backupRolledBack",
        recovery: "backupRecovery",
      } as Record<string, string>
    )[step] ?? "backupFailed"
  );
}
