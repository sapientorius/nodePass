<script lang="ts">
import { defineComponent } from "vue";
import {
  NAlert,
  NButton,
  NForm,
  NFormItem,
  NInput,
  NRadio,
  NRadioGroup,
  NSpin,
  type InputInst,
} from "naive-ui";
import {
  startAuthentication,
  WebAuthnAbortService,
} from "@simplewebauthn/browser";
import type {
  ConfirmationMethod,
  ConfirmationMethods,
} from "@nodepass/contracts";
import { api, ApiError } from "../api";
import { ActionCancelled } from "../confirmation";

export default defineComponent({
  components: {
    NAlert,
    NButton,
    NForm,
    NFormItem,
    NInput,
    NRadio,
    NRadioGroup,
    NSpin,
  },
  props: {
    cancellable: Boolean,
    endpoint: { type: String, default: "auth/confirm" },
  },
  emits: ["confirmed", "cancel"],
  data: () => ({
    methods: [] as ConfirmationMethod[],
    method: "password" as ConfirmationMethod,
    value: "",
    loading: true,
    busy: false,
    error: "",
    revision: 0,
    passkeyActive: false,
  }),
  computed: {
    fieldLabel(): string {
      return this.$t(
        this.method === "password"
          ? "password"
          : this.method === "recovery"
            ? "recoveryCodes"
            : "code",
      );
    },
  },
  mounted() {
    void this.load();
  },
  beforeUnmount() {
    this.revision++;
    this.value = "";
    if (this.passkeyActive) WebAuthnAbortService.cancelCeremony();
  },
  methods: {
    label(method: ConfirmationMethod): string {
      return this.$t(
        {
          password: "password",
          totp: "totp",
          recovery: "recoveryCodes",
          passkey: "confirmPasskeyMethod",
        }[method],
      );
    },
    async focusInput() {
      await this.$nextTick();
      if (this.method === "passkey")
        (this.$el as HTMLElement)
          .querySelector<HTMLButtonElement>('button[type="submit"]')
          ?.focus();
      else (this.$refs.credential as InputInst | undefined)?.focus();
    },
    select(method: ConfirmationMethod) {
      this.method = method;
      this.value = "";
      this.error = "";
    },
    async load() {
      const revision = ++this.revision;
      this.loading = true;
      this.error = "";
      try {
        const { methods } = await api<ConfirmationMethods>("auth/confirm");
        if (revision !== this.revision) return;
        this.methods = methods;
        this.method = methods.includes("totp")
          ? "totp"
          : (methods[0] ?? "password");
        if (!methods.length) this.error = this.$t("confirmUnavailable");
      } catch (error) {
        if (revision !== this.revision || error instanceof ActionCancelled)
          return;
        this.error = this.$t("confirmLoadError");
      } finally {
        if (revision === this.revision) {
          this.loading = false;
          void this.focusInput();
        }
      }
    },
    async submit() {
      if (
        this.busy ||
        this.loading ||
        !this.methods.length ||
        (this.method !== "passkey" && !this.value)
      )
        return;
      const revision = this.revision;
      this.busy = true;
      this.error = "";
      try {
        let result: { authorization?: string };
        const endpoint = this.endpoint;
        if (this.method === "passkey") {
          const data = await api("auth/confirm/passkey-options", "POST", {});
          if (revision !== this.revision) return;
          this.passkeyActive = true;
          const response = await startAuthentication({
            optionsJSON: data.options,
          });
          this.passkeyActive = false;
          if (revision !== this.revision) return;
          result = await api(endpoint, "POST", {
            challenge: data.challenge,
            response,
          });
        } else {
          result = await api(
            endpoint,
            "POST",
            this.method === "password"
              ? { password: this.value }
              : { code: this.value },
          );
        }
        if (revision !== this.revision) return;
        this.value = "";
        this.$emit("confirmed", result.authorization);
      } catch (error) {
        if (revision !== this.revision || error instanceof ActionCancelled)
          return;
        this.value = "";
        this.error = this.$t(
          error instanceof ApiError && error.status === 429
            ? "confirmRateLimit"
            : this.method === "passkey"
              ? "confirmPasskeyError"
              : "confirmInvalid",
        );
        void this.focusInput();
      } finally {
        if (revision === this.revision) {
          this.busy = false;
          this.passkeyActive = false;
        }
      }
    },
  },
});
</script>
<template>
  <n-form
    class="confirmation-form"
    :aria-busy="loading || busy"
    @submit.prevent="submit"
  >
    <p class="muted">{{ $t("confirmActionHelp") }}</p>
    <n-spin v-if="loading" size="small" :aria-label="$t('loading')" />
    <n-form-item
      v-if="methods.length > 1"
      :label="$t('confirmMethod')"
      :show-feedback="false"
    >
      <n-radio-group
        class="confirmation-methods"
        name="confirmation-method"
        role="radiogroup"
        :value="method"
        :aria-label="$t('confirmMethod')"
        :disabled="busy"
        @update:value="select"
      >
        <n-radio v-for="item in methods" :key="item" :value="item">{{
          label(item)
        }}</n-radio>
      </n-radio-group>
    </n-form-item>
    <n-form-item
      v-if="!loading && methods.length && method !== 'passkey'"
      :label="fieldLabel"
    >
      <n-input
        ref="credential"
        v-model:value="value"
        :type="method === 'password' ? 'password' : 'text'"
        :disabled="busy"
        :maxlength="method === 'password' ? 4096 : 100"
        :autocomplete="
          method === 'password' ? 'current-password' : 'one-time-code'
        "
        :input-props="{
          'aria-label': fieldLabel,
          inputmode: method === 'totp' ? 'numeric' : 'text',
          autocapitalize: 'none',
          spellcheck: false,
        }"
      />
    </n-form-item>
    <n-alert
      v-if="error"
      type="error"
      role="alert"
      class="confirmation-error"
      >{{ error }}</n-alert
    >
    <div class="detail-actions confirmation-actions">
      <n-button
        v-if="!loading && methods.length"
        type="primary"
        attr-type="submit"
        :loading="busy"
        :disabled="busy || (method !== 'passkey' && !value)"
        >{{ $t(method === "passkey" ? "confirmPasskey" : "confirm") }}</n-button
      >
      <n-button v-if="!loading && !methods.length" @click="load">{{
        $t("confirmRetry")
      }}</n-button>
      <n-button v-if="cancellable" @click="$emit('cancel')">{{
        $t("cancel")
      }}</n-button>
    </div>
  </n-form>
</template>
<style scoped>
.confirmation-methods,
.confirmation-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px 16px;
}
.confirmation-methods :deep(.n-radio__label),
.confirmation-actions :deep(.n-button__content) {
  white-space: normal;
}
.confirmation-actions :deep(.n-button) {
  height: auto;
  min-height: 36px;
  padding: 8px 12px;
  max-width: 100%;
}
.confirmation-error {
  margin-bottom: 16px;
}
.confirmation-form p {
  line-height: 1.6;
}
</style>
