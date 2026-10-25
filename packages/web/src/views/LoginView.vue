<script lang="ts">
import { defineComponent, defineAsyncComponent } from "vue";
import { mapStores } from "pinia";
import {
  NButton,
  NInput,
  NForm,
  NFormItem,
  NCheckbox,
  NSelect,
  NTabs,
  NTab,
  NAlert,
  type InputInst,
} from "naive-ui";
import {
  startAuthentication,
  startRegistration,
} from "@simplewebauthn/browser";
import { api, ApiError, type ApiFailure } from "../api";
import { setupErrorMessage, setupErrorContext } from "../setup-errors";
import { useSession } from "../stores/session";
import { languageOptions } from "../i18n";
import Icon from "../components/Icon.vue";
import { defaultPolicy } from "@nodepass/contracts";
import {
  setupIssues,
  type SetupField,
  type SetupMode,
} from "../setup-validation";
export default defineComponent({
  components: {
    NButton,
    NInput,
    NForm,
    NFormItem,
    NCheckbox,
    NSelect,
    NTabs,
    NTab,
    NAlert,
    Icon,
    PasswordStrength: defineAsyncComponent(
      () => import("../components/PasswordStrength.vue"),
    ),
  },
  data: () => ({
    login: "",
    password: "",
    name: "",
    setupToken: "",
    masterPassword: "",
    maintenance: false,
    mode: "fresh" as SetupMode,
    touched: {} as Partial<Record<SetupField, boolean>>,
    configuration: "",
    dump: "",
    busy: false,
    setupPhase: "",
    setupFailure: null as ApiFailure | null,
    closed: false,
    code: "",
    recoveryMode: false,
    enrollment: null as null | {
      secret: string;
      qr: string;
      challenge: string;
    },
    languageOptions,
  }),
  computed: {
    ...mapStores(useSession),
    pending() {
      return this.sessionStore.viewer?.phase;
    },
    isSetup() {
      return this.sessionStore.setupRequired;
    },
    setupErrors() {
      return setupIssues(this);
    },
    canInstall() {
      return !this.busy && Object.keys(this.setupErrors).length === 0;
    },
    setupLoginLabel(): string {
      return this.$t(this.mode === "migrate" ? "setupLegacyLogin" : "login");
    },
    setupPasswordLabel(): string {
      return this.$t(
        this.mode === "migrate" ? "setupLegacyPassword" : "password",
      );
    },
    setupFailureMessage(): string {
      return this.setupFailure
        ? setupErrorMessage(this.setupFailure, String(this.$i18n.locale))
        : "";
    },
    setupFailureContext(): string {
      return this.setupFailure
        ? setupErrorContext(this.setupFailure, String(this.$i18n.locale))
        : "";
    },
  },
  mounted() {
    if (this.sessionStore.legacy) this.mode = "migrate";
  },
  beforeUnmount() {
    this.closed = true;
    this.password = "";
    this.masterPassword = "";
    this.setupToken = "";
    this.dump = "";
    this.configuration = "";
    this.enrollment = null;
    this.code = "";
  },
  methods: {
    setupFeedback(field: SetupField): string | undefined {
      const issue = this.setupErrors[field];
      if (!issue || (!this.touched[field] && !this[field])) return undefined;
      return this.$t(issue.key, {
        max: issue.max ?? 0,
        minLength: defaultPolicy.minLength,
        minScore: defaultPolicy.minScore,
      });
    },
    setupFieldProps(field: SetupField, label: string) {
      const feedback = this.setupFeedback(field);
      return {
        label,
        required: true,
        feedback,
        validationStatus: feedback ? ("error" as const) : undefined,
      };
    },
    setupInputProps(field: SetupField, label: string) {
      const autocomplete: Record<SetupField, string> = {
        setupToken: "off",
        name: "name",
        login: "username",
        password: this.mode === "fresh" ? "new-password" : "current-password",
        masterPassword: "off",
        maintenance: "off",
      };
      const descriptions = [];
      if (this.setupFeedback(field))
        descriptions.push(`setup-${field}-feedback`);
      if (
        this.mode === "migrate" &&
        (field === "login" || field === "password")
      )
        descriptions.push("setup-legacy-credentials-help");
      return {
        "aria-label": label,
        autocomplete: autocomplete[field],
        "aria-required": true,
        "aria-invalid": !!this.setupFeedback(field),
        "aria-describedby": descriptions.length
          ? descriptions.join(" ")
          : undefined,
      };
    },
    setSetupMode(mode: string | number) {
      if (!this.busy && (mode === "fresh" || mode === "migrate"))
        this.mode = mode;
    },
    setupTabProps(mode: SetupMode) {
      return {
        id: `setup-tab-${mode}`,
        role: "tab",
        "aria-selected": this.mode === mode,
        "aria-controls": "setup-form",
        tabindex: this.mode === mode ? 0 : -1,
        onKeydown: (event: KeyboardEvent) => {
          if (this.busy) return;
          let next: SetupMode;
          if (event.key === "Home") next = "fresh";
          else if (event.key === "End") next = "migrate";
          else if (["ArrowLeft", "ArrowRight"].includes(event.key))
            next = mode === "fresh" ? "migrate" : "fresh";
          else if (["Enter", " "].includes(event.key)) next = mode;
          else return;
          event.preventDefault();
          this.setSetupMode(next);
          void this.$nextTick(() =>
            document.getElementById(`setup-tab-${next}`)?.focus(),
          );
        },
      };
    },
    async setupJob(
      path: string,
      data: unknown,
      headers: Record<string, string>,
    ) {
      const queued = await api(path, "POST", data, headers);
      while (!this.closed) {
        const job = await api(
          `setup/jobs/${queued.job}`,
          "GET",
          undefined,
          headers,
        );
        this.setupPhase = job.step;
        if (job.state === "complete") {
          this.setupPhase = "";
          return job.result;
        }
        if (job.state === "failed") throw new ApiError(job.error);
        await new Promise((resolve) => setTimeout(resolve, 1000));
      }
      throw new Error(this.$t("error"));
    },
    async run(job: () => Promise<void>) {
      this.busy = true;
      this.sessionStore.error = "";
      try {
        await job();
      } catch (e) {
        if (this.isSetup)
          this.setupFailure =
            e instanceof ApiError
              ? e.failure
              : { message: e instanceof Error ? e.message : this.$t("error") };
        else this.sessionStore.fail(e);
      } finally {
        this.busy = false;
      }
    },
    async signIn() {
      await this.run(async () => {
        this.sessionStore.accept(
          await api("auth/login", "POST", {
            login: this.login,
            password: this.password,
          }),
        );
        this.password = "";
      });
    },
    async backToLogin() {
      await this.run(async () => {
        await this.sessionStore.logout();
        this.password = "";
        this.code = "";
        this.recoveryMode = false;
        this.enrollment = null;
        await this.$nextTick();
        (this.$refs.loginInput as InputInst | undefined)?.focus();
      });
    },
    async sso() {
      await this.run(async () => {
        this.sessionStore.accept(await api("auth/sso", "POST", {}));
      });
    },
    async passkey(register = false) {
      await this.run(async () => {
        const data = await api(
          `auth/passkey/${register ? "register" : "login"}-options`,
          "POST",
          {},
        );
        const response = register
          ? await startRegistration({ optionsJSON: data.options })
          : await startAuthentication({ optionsJSON: data.options });
        this.sessionStore.accept(
          await api(`auth/passkey/${register ? "register" : "login"}`, "POST", {
            challenge: data.challenge,
            response,
          }),
        );
      });
    },
    async beginTotp() {
      await this.run(async () => {
        this.enrollment = await api("auth/totp/start", "POST", {});
      });
    },
    async finishTotp() {
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
        this.enrollment = null;
      });
    },
    async install() {
      if (!this.canInstall) return;
      this.setupFailure = null;
      this.setupPhase = "";
      await this.run(async () => {
        const headers = { "x-setup-token": this.setupToken };
        if (this.mode === "fresh")
          await api(
            "setup/fresh",
            "POST",
            { login: this.login, name: this.name, password: this.password },
            headers,
          );
        else {
          if (this.dump) {
            await this.setupJob(
              "setup/import",
              {
                dump: this.dump,
                ...(this.configuration
                  ? { configuration: this.configuration }
                  : {}),
              },
              headers,
            );
            this.dump = "";
            this.sessionStore.legacy = true;
          }
          await api(
            "setup/preflight",
            "POST",
            {
              ...(this.configuration
                ? { configuration: this.configuration }
                : {}),
            },
            headers,
          );
          await this.setupJob(
            "setup/migrate",
            {
              login: this.login,
              password: this.password,
              masterPassword: this.masterPassword,
              maintenance: this.maintenance,
              ...(this.configuration
                ? { configuration: this.configuration }
                : {}),
            },
            headers,
          );
        }
        this.masterPassword = "";
        this.dump = "";
        this.configuration = "";
        this.setupToken = "";
        this.sessionStore.setupRequired = false;
        this.sessionStore.accept(
          await api("auth/login", "POST", {
            login: this.login,
            password: this.password,
          }),
        );
        this.password = "";
      });
    },
    async readFile(event: Event, kind: "configuration" | "dump") {
      const file = (event.target as HTMLInputElement).files?.[0];
      this[kind] = "";
      if (!file) return;
      if (file.size > (kind === "configuration" ? 1000000 : 64 * 1024 ** 2)) {
        this.setupFailure = {
          code: kind === "configuration" ? "CONFIG_XML" : "DUMP_SIZE",
          message:
            kind === "configuration"
              ? "The configuration exceeds the 1 MB upload limit."
              : "The SQL dump exceeds the 64 MiB upload limit.",
        };
        return;
      }
      try {
        this[kind] = await file.text();
        this.setupFailure = null;
      } catch {
        this.setupFailure = {
          code: "FILE_READ",
          message: "The file could not be read. Select the file again.",
        };
      }
    },
  },
});
</script>
<template>
  <div class="auth-layout">
    <section class="auth-story">
      <router-link to="/" class="brand"
        ><img src="/logo.svg" width="42" height="42" alt="" /><span
          >node<span class="brand-weight">Pass</span></span
        ></router-link
      >
      <div class="story-content">
        <div class="story-eyebrow">
          <span class="status-dot" /> Password Manager
        </div>
        <div class="vault-art" aria-hidden="true">
          <div class="orbit orbit-one" />
          <div class="orbit orbit-two" />
          <div class="art-node node-one" />
          <div class="art-node node-two" />
          <div class="art-node node-three" />
          <div class="art-vault"><Icon name="shield" :size="92" /></div>
        </div>
        <p>nodePass</p>
      </div>
    </section>
    <section class="auth-main">
      <div class="auth-controls">
        <n-select
          filterable
          :input-props="{ 'aria-label': $t('language') }"
          :value="$i18n.locale"
          :options="languageOptions"
          size="small"
          style="width: 150px"
          :aria-label="$t('language')"
          @update:value="$i18n.locale = $event"
        /><n-button
          quaternary
          circle
          :aria-label="$t('theme')"
          @click="sessionStore.toggleTheme"
          ><Icon :name="sessionStore.theme === 'light' ? 'moon' : 'sun'"
        /></n-button>
      </div>
      <div class="auth-card">
        <div class="section-icon">
          <Icon
            :name="isSetup ? 'vault' : pending ? 'shield' : 'key'"
            :size="25"
          />
        </div>
        <h1>
          {{ isSetup ? $t("setup") : pending ? $t("mfa") : $t("welcome") }}
        </h1>
        <p class="muted auth-description">
          {{
            isSetup
              ? $t("setupHelp")
              : pending
                ? $t(pending === "enroll" ? "enroll" : "confirm")
                : $t("loginHelp")
          }}
        </p>
        <template v-if="isSetup"
          ><n-tabs
            :value="mode"
            type="line"
            justify-content="space-evenly"
            role="tablist"
            :aria-label="$t('setup')"
            @update:value="setSetupMode"
            ><n-tab
              name="fresh"
              :disabled="busy"
              v-bind="setupTabProps('fresh')"
              ><template #default>{{ $t("fresh") }}</template></n-tab
            ><n-tab
              name="migrate"
              :disabled="busy"
              v-bind="setupTabProps('migrate')"
              ><template #default>{{ $t("migrate") }}</template></n-tab
            ></n-tabs
          ><n-form
            id="setup-form"
            role="tabpanel"
            :aria-labelledby="`setup-tab-${mode}`"
            :disabled="busy"
            @submit.prevent="install"
            ><n-alert
              v-if="mode === 'migrate'"
              type="info"
              :show-icon="false"
              class="setup-compatibility"
              >{{ $t("setupCompatibilityNotice") }}</n-alert
            ><n-form-item
              v-bind="setupFieldProps('setupToken', $t('setupToken'))"
              ><n-input
                :input-props="setupInputProps('setupToken', $t('setupToken'))"
                v-model:value="setupToken"
                type="password"
                @blur="touched.setupToken = true"
              />
              <template #feedback
                ><span id="setup-setupToken-feedback">{{
                  setupFeedback("setupToken")
                }}</span></template
              ></n-form-item
            ><n-form-item
              v-if="mode === 'fresh'"
              v-bind="setupFieldProps('name', $t('name'))"
              ><n-input
                :input-props="setupInputProps('name', $t('name'))"
                v-model:value="name"
                @blur="touched.name = true"
              />
              <template #feedback
                ><span id="setup-name-feedback">{{
                  setupFeedback("name")
                }}</span></template
              ></n-form-item
            ><n-form-item v-bind="setupFieldProps('login', setupLoginLabel)"
              ><n-input
                :input-props="setupInputProps('login', setupLoginLabel)"
                v-model:value="login"
                @blur="touched.login = true"
              />
              <template #feedback
                ><span id="setup-login-feedback">{{
                  setupFeedback("login")
                }}</span></template
              ></n-form-item
            ><n-form-item
              v-bind="setupFieldProps('password', setupPasswordLabel)"
              ><n-input
                :input-props="setupInputProps('password', setupPasswordLabel)"
                v-model:value="password"
                type="password"
                show-password-on="click"
                @blur="touched.password = true"
              />
              <template #feedback
                ><span id="setup-password-feedback">{{
                  setupFeedback("password")
                }}</span></template
              ></n-form-item
            ><PasswordStrength v-if="mode === 'fresh'" :value="password" />
            <p
              v-if="mode === 'migrate'"
              id="setup-legacy-credentials-help"
              class="muted setup-credentials-help"
            >
              {{ $t("setupLegacyCredentialsHelp") }}
            </p>
            <template v-if="mode === 'migrate'"
              ><n-form-item
                v-bind="setupFieldProps('masterPassword', $t('masterPassword'))"
                ><n-input
                  :input-props="
                    setupInputProps('masterPassword', $t('masterPassword'))
                  "
                  v-model:value="masterPassword"
                  type="password"
                  @blur="touched.masterPassword = true"
                />
                <template #feedback
                  ><span id="setup-masterPassword-feedback">{{
                    setupFeedback("masterPassword")
                  }}</span></template
                ></n-form-item
              ><n-alert
                v-if="sessionStore.legacy"
                type="info"
                :show-icon="false"
                class="setup-imported"
                >{{ $t("setupLegacyImportedHelp") }}</n-alert
              ><label class="file-label"
                >config.xml<input
                  type="file"
                  accept=".xml"
                  :disabled="busy"
                  @change="readFile($event, 'configuration')" /></label
              ><label v-if="!sessionStore.legacy" class="file-label"
                >{{ $t("import") }} · SQL<input
                  type="file"
                  accept=".sql"
                  :disabled="busy"
                  @change="readFile($event, 'dump')" /></label
              ><n-checkbox
                v-model:checked="maintenance"
                class="setup-maintenance"
                :aria-label="$t('maintenance')"
                aria-describedby="setup-maintenance-help"
                >{{ $t("maintenance") }}</n-checkbox
              >
              <p
                id="setup-maintenance-help"
                class="muted setup-maintenance-help"
              >
                {{ $t("setupMaintenanceHelp") }}
              </p></template
            >
            <n-alert
              v-if="setupFailure"
              type="error"
              :title="$t('setupFailureTitle')"
              role="alert"
              class="setup-failure"
            >
              <p>{{ setupFailureMessage }}</p>
              <p v-if="setupFailureContext">{{ setupFailureContext }}</p>
              <p v-if="setupFailure.code">
                <code>{{ setupFailure.code }}</code
                ><span v-if="setupFailure.step">
                  · {{ $t("setupFailurePhase") }}: {{ setupFailure.step }}</span
                >
              </p>
              <p v-if="setupFailure.reference">
                {{
                  $t("setupFailureReference", {
                    reference: setupFailure.reference,
                  })
                }}
              </p>
            </n-alert>
            <p v-if="busy && setupPhase" role="status" aria-live="polite">
              {{ $te(setupPhase) ? $t(setupPhase) : setupPhase }}
            </p>
            <n-button
              type="primary"
              block
              size="large"
              attr-type="submit"
              :loading="busy"
              :disabled="!canInstall"
              :aria-label="$t(mode === 'fresh' ? 'fresh' : 'migrate')"
              :aria-busy="busy"
              >{{ $t(mode === "fresh" ? "fresh" : "migrate")
              }}<template #icon
                ><Icon name="arrow" /></template></n-button></n-form
        ></template>
        <template v-else-if="pending"
          ><template v-if="pending === 'enroll'"
            ><n-button
              type="primary"
              block
              size="large"
              :loading="busy"
              @click="passkey(true)"
              ><Icon name="key" /> {{ $t("passkey") }}</n-button
            ><n-button
              v-if="!enrollment"
              block
              size="large"
              style="margin-top: 12px"
              :loading="busy"
              @click="beginTotp"
              >{{ $t("totp") }}</n-button
            >
            <div v-if="enrollment" class="enrollment">
              <img
                :src="enrollment.qr"
                :alt="$t('totp')"
                width="200"
                height="200"
              /><code>{{ enrollment.secret }}</code>
            </div></template
          ><n-form
            v-if="pending === 'verify' || enrollment"
            @submit.prevent="finishTotp"
            ><n-button
              v-if="pending === 'verify'"
              quaternary
              style="margin-bottom: 12px"
              @click="
                recoveryMode = !recoveryMode;
                code = '';
              "
              >{{ $t(recoveryMode ? "totp" : "recoveryCodes") }}</n-button
            ><n-form-item :label="$t(recoveryMode ? 'recoveryCodes' : 'code')"
              ><n-input
                v-model:value="code"
                :maxlength="recoveryMode ? 100 : 6"
                autocomplete="one-time-code"
                :input-props="{
                  inputmode: recoveryMode ? 'text' : 'numeric',
                  'aria-label': $t(recoveryMode ? 'recoveryCodes' : 'code'),
                }" /></n-form-item
            ><n-button
              type="primary"
              block
              size="large"
              attr-type="submit"
              :loading="busy"
              >{{ $t("confirm") }}</n-button
            ></n-form
          ><n-button
            block
            size="large"
            attr-type="button"
            style="margin-top: 12px"
            :disabled="busy"
            :loading="busy"
            @click="backToLogin"
            >{{ $t("backToLogin") }}</n-button
          ></template
        >
        <template v-else
          ><n-form @submit.prevent="signIn"
            ><n-form-item :label="$t('login')"
              ><n-input
                ref="loginInput"
                :input-props="{ 'aria-label': $t('login') }"
                v-model:value="login"
                size="large"
                autocomplete="username"
                :placeholder="$t('login')" /></n-form-item
            ><n-form-item :label="$t('password')"
              ><n-input
                :input-props="{ 'aria-label': $t('password') }"
                v-model:value="password"
                type="password"
                size="large"
                autocomplete="current-password"
                show-password-on="click"
                :placeholder="$t('password')" /></n-form-item
            ><n-button
              type="primary"
              block
              size="large"
              attr-type="submit"
              :loading="busy"
              >{{ $t("signIn")
              }}<template #icon
                ><Icon name="arrow" :size="18" /></template></n-button
          ></n-form>
          <div class="auth-divider"><span>nodePass</span></div>
          <n-button block size="large" :loading="busy" @click="passkey(false)"
            ><template #icon><Icon name="key" /></template
            >{{ $t("passkey") }}</n-button
          ><n-button
            v-if="sessionStore.sso"
            block
            size="large"
            style="margin-top: 12px"
            :loading="busy"
            @click="sso"
            >SSO</n-button
          ></template
        >
      </div>
    </section>
  </div>
</template>
