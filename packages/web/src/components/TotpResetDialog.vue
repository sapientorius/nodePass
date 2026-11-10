<script lang="ts">
import { defineComponent, type PropType } from "vue";
import { NAlert, NButton, useMessage } from "naive-ui";
import NModal from "./AccessibleModal.vue";
import { api } from "../api";
import { ActionCancelled, cancelConfirmation } from "../confirmation";
import { useSession } from "../stores/session";

export default defineComponent({
  components: { NAlert, NButton, NModal },
  props: {
    target: {
      type: Object as PropType<{ id: number; name: string; login: string }>,
      required: true,
    },
  },
  emits: ["close", "reset"],
  setup: () => ({ message: useMessage() }),
  data: () => ({ busy: false, error: false, active: true }),
  beforeUnmount() {
    this.active = false;
    if (this.busy) cancelConfirmation();
  },
  methods: {
    close() {
      if (!this.busy) this.$emit("close");
    },
    async reset() {
      if (this.busy || !useSession().viewer?.isAppAdmin) return;
      this.busy = true;
      this.error = false;
      try {
        await api(`users/${this.target.id}/totp-reset`, "POST", {});
        if (!this.active || !useSession().viewer?.isAppAdmin) return;
        this.message.success(this.$t("totpResetSuccess"));
        this.$emit("reset");
      } catch (error) {
        if (this.active && !(error instanceof ActionCancelled))
          this.error = true;
      } finally {
        if (this.active) this.busy = false;
      }
    },
  },
});
</script>
<template>
  <n-modal
    :show="true"
    :title="$t('totpReset')"
    class="account-modal totp-reset-modal"
    :mask-closable="!busy"
    :close-on-esc="!busy"
    @update:show="close"
  >
    <p>
      <strong>{{ target.name }} ({{ target.login }})</strong>
    </p>
    <p>{{ $t("totpResetHelp") }}</p>
    <n-alert v-if="error" type="error" role="alert">{{ $t("error") }}</n-alert>
    <div class="totp-reset-actions">
      <n-button
        type="error"
        :aria-label="$t('totpReset')"
        :loading="busy"
        :disabled="busy"
        @click="reset"
        >{{ $t("totpReset") }}</n-button
      >
      <n-button :disabled="busy" @click="close">{{ $t("cancel") }}</n-button>
    </div>
  </n-modal>
</template>
<style scoped>
p {
  overflow-wrap: anywhere;
  line-height: 1.6;
}
.totp-reset-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
  margin-top: 20px;
}
.totp-reset-actions :deep(.n-button) {
  max-width: 100%;
  height: auto;
  min-height: 36px;
  padding: 8px 12px;
}
.totp-reset-actions :deep(.n-button__content) {
  white-space: normal;
  overflow-wrap: anywhere;
}
</style>
