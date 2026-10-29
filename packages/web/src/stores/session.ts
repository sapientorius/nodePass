import { defineStore } from "pinia";
import type { Viewer } from "@nodepass/contracts";
import { api, ApiError, setCsrf } from "../api";
import { ActionCancelled, cancelConfirmation } from "../confirmation";
import { useAccounts } from "./accounts";

const refreshes = new WeakMap<
  object,
  { epoch: number; promise: Promise<boolean> }
>();
export const useSession = defineStore("session", {
  state: () => ({
    viewer: null as (Viewer & { phase: string }) | null,
    setupRequired: false,
    maintenance: false,
    legacy: false,
    sso: false,
    version: "",
    passwordPolicy: { minLength: 15, minScore: 3 },
    booting: true,
    error: "",
    epoch: 0,
    accessEpoch: 0,
    accessNotice: false,
    theme: (localStorage.getItem("nodepass-theme") === "dark"
      ? "dark"
      : "light") as "light" | "dark",
  }),
  actions: {
    accept(viewer: Viewer & { phase: string }) {
      const previous = this.viewer;
      this.epoch++;
      if (
        previous &&
        (previous.id !== viewer.id ||
          previous.phase !== viewer.phase ||
          previous.accessRevision !== viewer.accessRevision)
      ) {
        cancelConfirmation();
        useAccounts().invalidate();
        this.accessEpoch++;
        this.accessNotice =
          previous.id === viewer.id &&
          viewer.phase === "ready" &&
          previous.accessRevision !== viewer.accessRevision;
      }
      this.viewer = viewer;
      setCsrf(viewer.csrf);
      if (viewer.theme) this.theme = viewer.theme;
    },
    clear() {
      this.epoch++;
      this.accessEpoch++;
      cancelConfirmation();
      this.viewer = null;
      this.accessNotice = false;
      setCsrf("");
      useAccounts().clear();
    },
    refresh(force = false): Promise<boolean> {
      if (!this.viewer) return Promise.resolve(false);
      // A save must not reuse a snapshot requested before the mutation committed.
      if (force) this.epoch++;
      const epoch = this.epoch;
      const pending = refreshes.get(this);
      if (pending?.epoch === epoch) return pending.promise;
      const promise = (async () => {
        try {
          const viewer = await api<Viewer & { phase: string }>("auth/session");
          if (this.epoch !== epoch) return false;
          this.accept(viewer);
          return viewer.phase === "ready";
        } catch (error) {
          if (this.epoch === epoch) {
            if (error instanceof ApiError && error.status === 401) this.clear();
            else this.fail(error);
          }
          return false;
        } finally {
          if (refreshes.get(this)?.epoch === epoch) refreshes.delete(this);
        }
      })();
      refreshes.set(this, { epoch, promise });
      return promise;
    },
    async load() {
      try {
        const status = await api<{
          version: string;
          setupRequired: boolean;
          maintenance?: boolean;
          legacy: boolean;
          sso: boolean;
        }>("status");
        this.version = status.version;
        this.setupRequired = status.setupRequired;
        this.maintenance = status.maintenance === true;
        this.legacy = status.legacy;
        this.sso = status.sso;
        if (!status.setupRequired && !this.maintenance) {
          try {
            this.accept(await api("auth/session"));
            if (this.viewer?.phase === "ready")
              this.passwordPolicy = await api("auth/policy");
          } catch (error) {
            if (error instanceof ApiError && error.status === 401) this.clear();
            else this.fail(error);
          }
        }
      } catch (error) {
        this.error = String(error instanceof Error ? error.message : error);
      } finally {
        this.booting = false;
      }
    },
    async logout() {
      cancelConfirmation();
      await api("auth/logout", "POST", {});
      this.clear();
    },
    toggleTheme() {
      this.theme = this.theme === "light" ? "dark" : "light";
      localStorage.setItem("nodepass-theme", this.theme);
      if (this.viewer?.phase === "ready")
        void api("preferences", "PATCH", { theme: this.theme }).catch((error) =>
          this.fail(error),
        );
    },
    fail(error: unknown) {
      if (error instanceof ActionCancelled) return;
      this.error = error instanceof Error ? error.message : String(error);
    },
  },
});
