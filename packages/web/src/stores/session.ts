import { defineStore } from "pinia";
import type { Viewer } from "@nodepass/contracts";
import { api, setCsrf } from "../api";
import { ActionCancelled, cancelConfirmation } from "../confirmation";
export const useSession = defineStore("session", {
  state: () => ({
    viewer: null as (Viewer & { phase: string }) | null,
    setupRequired: false,
    legacy: false,
    sso: false,
    version: "",
    passwordPolicy: { minLength: 15, minScore: 3 },
    booting: true,
    error: "",
    theme: (localStorage.getItem("nodepass-theme") === "dark"
      ? "dark"
      : "light") as "light" | "dark",
  }),
  actions: {
    accept(viewer: Viewer & { phase: string }) {
      this.viewer = viewer;
      setCsrf(viewer.csrf);
      if (viewer.theme) this.theme = viewer.theme;
    },
    async load() {
      try {
        const status = await api<{
          version: string;
          setupRequired: boolean;
          legacy: boolean;
          sso: boolean;
        }>("status");
        this.version = status.version;
        this.setupRequired = status.setupRequired;
        this.legacy = status.legacy;
        this.sso = status.sso;
        if (!status.setupRequired) {
          try {
            this.accept(await api("auth/session"));
            if (this.viewer?.phase === "ready")
              this.passwordPolicy = await api("auth/policy");
          } catch {
            this.viewer = null;
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
      this.viewer = null;
      setCsrf("");
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
