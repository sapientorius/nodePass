<script lang="ts">
import { defineComponent } from "vue";
import { mapStores } from "pinia";
import {
  useMessage,
  NButton,
  NInput,
  NForm,
  NFormItem,
  NList,
  NListItem,
  NThing,
  NPopconfirm,
} from "naive-ui";
import { startRegistration } from "@simplewebauthn/browser";
import { api } from "../api";
import { useSession } from "../stores/session";
import { useAccounts } from "../stores/accounts";
import Icon from "../components/Icon.vue";
import PageAccent from "../components/PageAccent.vue";
import PasswordStrength from "../components/PasswordStrength.vue";
import NCard from "../components/PanelCard.vue";
export default defineComponent({
  setup() {
    return { message: useMessage() };
  },
  components: {
    NCard,
    NButton,
    NInput,
    NForm,
    NFormItem,
    NList,
    NListItem,
    NThing,
    NPopconfirm,
    Icon,
    PageAccent,
    PasswordStrength,
  },
  data: () => ({
    busy: false,
    factors: [] as any[],
    enrollment: null as any,
    code: "",
    current: "",
    next: "",
    codes: [] as string[],
  }),
  computed: { ...mapStores(useSession) },
  mounted() {
    void this.load();
  },
  beforeUnmount() {
    this.codes = [];
    this.enrollment = null;
    this.current = "";
    this.next = "";
    this.code = "";
  },
  methods: {
    async run(job: () => Promise<void>) {
      if (this.busy) return;
      this.busy = true;
      try {
        await job();
      } catch (error) {
        this.sessionStore.fail(error);
      } finally {
        this.busy = false;
      }
    },
    async load() {
      await this.run(async () => {
        this.factors = await api("auth/factors");
        this.sessionStore.passwordPolicy = await api("auth/policy");
      });
    },
    async passkey() {
      await this.run(async () => {
        const data = await api("auth/passkey/register-options", "POST", {}),
          response = await startRegistration({ optionsJSON: data.options });
        this.sessionStore.accept(
          await api("auth/passkey/register", "POST", {
            challenge: data.challenge,
            response,
          }),
        );
        this.message.success(this.$t("saved"), { duration: 3000 });
        this.factors = await api("auth/factors");
      });
    },
    async startTotp() {
      await this.run(async () => {
        this.enrollment = await api("auth/totp/start", "POST", {});
      });
    },
    async confirmTotp() {
      await this.run(async () => {
        this.sessionStore.accept(
          await api(
            this.enrollment ? "auth/totp/enroll" : "auth/totp/verify",
            "POST",
            {
              code: this.code,
              ...(this.enrollment
                ? { challenge: this.enrollment.challenge }
                : {}),
            },
          ),
        );
        this.code = "";
        if (this.enrollment)
          this.message.success(this.$t("saved"), { duration: 3000 });
        this.enrollment = null;
        this.factors = await api("auth/factors");
      });
    },
    async recovery() {
      await this.run(async () => {
        this.codes = (await api("auth/recovery", "POST", {})).codes;
        this.message.success(this.$t("saved"), { duration: 3000 });
      });
    },
    async remove(id: number) {
      await this.run(async () => {
        await api(`auth/factors/${id}`, "DELETE");
        this.sessionStore.viewer = null;
        useAccounts().clear();
        await this.sessionStore.load();
      });
    },
    async changePassword() {
      await this.run(async () => {
        await api("auth/password", "POST", {
          current: this.current,
          password: this.next,
        });
        this.message.success(this.$t("saved"), { duration: 3000 });
        this.current = "";
        this.next = "";
        this.sessionStore.viewer = null;
        useAccounts().clear();
        await this.sessionStore.load();
      });
    },
  },
});
</script>
<template>
  <section :aria-busy="busy">
    <div class="page-heading">
      <div>
        <PageAccent />
        <h1>{{ $t("personal") }}</h1>
      </div>
    </div>
    <div class="settings-grid">
      <n-card :title="$t('mfa')"
        ><n-list
          ><n-list-item v-for="factor in factors" :key="factor.id"
            ><n-thing :title="factor.name" :description="factor.kind"
              ><template #action
                ><n-popconfirm @positive-click="remove(factor.id)"
                  ><template #trigger
                    ><n-button secondary type="error" size="small">{{
                      $t("delete")
                    }}</n-button></template
                  >{{ $t("confirm") }}</n-popconfirm
                ></template
              ></n-thing
            ></n-list-item
          ></n-list
        >
        <div class="detail-actions">
          <n-button @click="passkey()"
            ><template #icon><Icon name="key" /></template>{{ $t("enroll") }} ·
            Passkey</n-button
          ><n-button
            v-if="!factors.some((f) => f.kind === 'totp')"
            @click="startTotp"
            >{{ $t("totp") }}</n-button
          >
        </div>
        <div v-if="enrollment" class="enrollment">
          <p>{{ $t("totpHelp") }}</p>
          <img
            :src="enrollment.qr"
            :alt="$t('totp')"
            width="200"
            height="200"
          /><code class="break-secret">{{ enrollment.secret }}</code
          ><n-form @submit.prevent="confirmTotp"
            ><n-form-item :label="$t('code')"
              ><n-input
                :input-props="{ 'aria-label': $t('code') }"
                v-model:value="code"
                autocomplete="one-time-code"
                :maxlength="6" /></n-form-item
            ><n-button type="primary" attr-type="submit">{{
              $t("confirm")
            }}</n-button></n-form
          >
        </div>
      </n-card>
      <n-card :title="$t('recoveryCodes')"
        ><p class="muted">{{ $t("recoveryHelp") }}</p>
        <n-button :loading="busy" @click="recovery">{{
          $t("generate")
        }}</n-button>
        <div v-if="codes.length" class="recovery-codes">
          <code v-for="value in codes" :key="value">{{ value }}</code>
        </div>
        <n-button v-if="codes.length" quaternary @click="codes = []">{{
          $t("close")
        }}</n-button></n-card
      >
      <n-card v-if="!sessionStore.viewer?.directory" :title="$t('newPassword')"
        ><n-form @submit.prevent="changePassword"
          ><n-form-item :label="$t('currentPassword')"
            ><n-input
              :input-props="{ 'aria-label': $t('currentPassword') }"
              v-model:value="current"
              type="password"
              autocomplete="current-password" /></n-form-item
          ><n-form-item :label="$t('newPassword')"
            ><n-input
              :input-props="{ 'aria-label': $t('newPassword') }"
              v-model:value="next"
              type="password"
              autocomplete="new-password"
              :maxlength="128" /></n-form-item
          ><PasswordStrength
            :value="next"
            v-bind="sessionStore.passwordPolicy"
          /><n-button type="primary" attr-type="submit" :loading="busy">{{
            $t("save")
          }}</n-button></n-form
        ></n-card
      >
    </div>
  </section>
</template>
<style scoped>
.detail-actions {
  flex-wrap: wrap;
}
</style>
