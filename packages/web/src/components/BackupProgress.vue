<script lang="ts">
import { defineComponent } from "vue";
import { NAlert, NButton, NSpin } from "naive-ui";
import NCard from "./PanelCard.vue";
import { useSession } from "../stores/session";
import {
  backupProgress,
  backupStepKey,
  forgetRestore,
  loadRestoreTicket,
  pollRestore,
} from "../backup-progress";
export default defineComponent({
  components: { NAlert, NButton, NCard, NSpin },
  data: () => ({
    backupProgress,
    timer: undefined as ReturnType<typeof setInterval> | undefined,
    polling: false,
  }),
  computed: {
    maintenance(): boolean {
      return useSession().maintenance;
    },
    visible(): boolean {
      return (
        this.maintenance ||
        this.backupProgress.status?.state === "running" ||
        this.backupProgress.status?.state === "complete" ||
        (this.backupProgress.status?.state === "failed" &&
          this.backupProgress.status.step !== "cancelled")
      );
    },
  },
  mounted() {
    loadRestoreTicket();
    if (backupProgress.ticket?.language)
      this.$i18n.locale = backupProgress.ticket.language;
    void this.poll();
    this.timer = setInterval(() => void this.poll(), 2000);
  },
  beforeUnmount() {
    clearInterval(this.timer);
  },
  methods: {
    backupStepKey,
    async poll() {
      if (this.polling) return;
      this.polling = true;
      try {
        await pollRestore();
        if (
          this.maintenance ||
          this.backupProgress.status?.state === "running"
        ) {
          const response = await fetch("/api/v1/status", {
            credentials: "omit",
            cache: "no-store",
          });
          if (response.ok) {
            const status = await response.json();
            if (status.maintenance === true) useSession().maintenance = true;
            else if (status.maintenance === false && useSession().maintenance) {
              useSession().maintenance = false;
              useSession().clear();
              await useSession().load();
            }
          }
        }
      } finally {
        this.polling = false;
      }
    },
    dismiss() {
      const invalidated =
        this.backupProgress.status?.state === "complete" ||
        ["rolledBack", "recovery"].includes(
          this.backupProgress.status?.error ?? "",
        );
      forgetRestore();
      if (invalidated) {
        useSession().clear();
        void useSession().load();
      }
    },
  },
});
</script>
<template>
  <n-card
    v-if="visible"
    class="backup-global"
    :title="$t('backupRestore')"
    role="status"
    aria-live="polite"
  >
    <n-spin
      v-if="maintenance || backupProgress.status?.state === 'running'"
      size="small"
    />
    <p>{{ $t(backupStepKey(backupProgress.status?.step ?? "maintenance")) }}</p>
    <n-alert v-if="backupProgress.status?.error === 'recovery'" type="error">{{
      $t("backupRecovery")
    }}</n-alert>
    <p v-else-if="backupProgress.status?.state === 'complete'">
      {{ $t("backupLogin") }}
    </p>
    <n-alert v-if="backupProgress.unavailable" type="warning">{{
      $t("backupStatusUnavailable")
    }}</n-alert>
    <n-button
      v-if="
        !maintenance &&
        ['complete', 'failed'].includes(backupProgress.status?.state ?? '')
      "
      @click="dismiss"
      >{{ $t("close") }}</n-button
    >
  </n-card>
</template>
<style scoped>
.backup-global {
  width: min(720px, calc(100% - 32px));
  margin: 24px auto;
}
</style>
