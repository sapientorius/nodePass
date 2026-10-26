<script lang="ts">
import { defineComponent } from "vue";
import {
  useMessage,
  NCard,
  NSelect,
  NForm,
  NFormItem,
  NInput,
  NSwitch,
  NButton,
  NTag,
} from "naive-ui";
import { api } from "../api";
import { useSession } from "../stores/session";
const definitions: Record<
  string,
  { key: string; label: string; type?: string }[]
> = {
  smtp: [
    { key: "enabled", label: "enabled", type: "switch" },
    { key: "host", label: "SMTP host" },
    { key: "port", label: "Port", type: "number" },
    { key: "secure", label: "TLS", type: "switch" },
    { key: "from", label: "email" },
    { key: "recipients", label: "notifications" },
    { key: "user", label: "login" },
    { key: "password", label: "password", type: "secret" },
  ],
  syslog: [
    { key: "enabled", label: "enabled", type: "switch" },
    { key: "host", label: "Syslog host" },
    { key: "port", label: "Port", type: "number" },
  ],
  wiki: [
    { key: "enabled", label: "enabled", type: "switch" },
    { key: "url", label: "HTTPS XML-RPC endpoint" },
    { key: "user", label: "login" },
    { key: "password", label: "password", type: "secret" },
  ],
  directory: [
    { key: "ldapEnabled", label: "enabled", type: "stringSwitch" },
    { key: "ldapServer", label: "LDAP URL (ldaps://)" },
    { key: "ldapTlsEnabled", label: "STARTTLS", type: "stringSwitch" },
    { key: "ldapAds", label: "Active Directory", type: "stringSwitch" },
    { key: "ldapBase", label: "Base DN" },
    { key: "ldapGroup", label: "Group DN" },
    { key: "ldapBindUser", label: "Bind DN" },
    { key: "ldapBindPass", label: "password", type: "secret" },
    { key: "ldapDefaultGroup", label: "group", type: "group" },
    { key: "ldapDefaultProfile", label: "profiles", type: "profile" },
  ],
  sso: [
    { key: "enabled", label: "enabled", type: "switch" },
    { key: "secret", label: "secret", type: "secret" },
    { key: "allowedLogins", label: "users" },
    { key: "autoProvision", label: "create", type: "switch" },
    { key: "defaultGroup", label: "group", type: "group" },
    { key: "defaultProfile", label: "profiles", type: "profile" },
  ],
};
import NInputNumber from "../components/NumberField.vue";
export default defineComponent({
  setup() {
    return { message: useMessage() };
  },
  components: {
    NCard,
    NSelect,
    NForm,
    NFormItem,
    NInput,
    NInputNumber,
    NSwitch,
    NButton,
    NTag,
  },
  data: () => ({
    provider: "smtp",
    form: {} as any,
    busy: false,
    saved: false,
    groups: [] as any[],
    profiles: [] as any[],
  }),
  computed: {
    fields() {
      return definitions[this.provider]!;
    },
  },
  watch: {
    provider() {
      void this.load();
    },
  },
  mounted() {
    void this.load();
  },
  beforeUnmount() {
    this.form = {};
  },
  methods: {
    async run(job: () => Promise<void>) {
      this.busy = true;
      try {
        await job();
      } catch (e) {
        useSession().fail(e);
      } finally {
        this.busy = false;
      }
    },
    async load() {
      this.saved = false;
      this.form = {};
      await this.run(async () => {
        [this.form, this.groups, this.profiles] = await Promise.all([
          api(`integrations/${this.provider}`),
          api("groups"),
          api("profiles"),
        ]);
        for (const field of this.fields) {
          if (field.type === "switch")
            this.form[field.key] = !!this.form[field.key];
          if (field.type === "number")
            this.form[field.key] =
              Number(this.form[field.key]) ||
              (this.provider === "smtp" ? 587 : 514);
          if (field.type === "secret") this.form[field.key] = "";
        }
      });
    },
    label(value: string) {
      return this.$te(value) ? this.$t(value) : value;
    },
    options(rows: any[]) {
      return rows.map((r) => ({ label: r.name, value: String(r.id) }));
    },
    async save() {
      this.saved = false;
      await this.run(async () => {
        const data: any = {};
        for (const field of this.fields) {
          if (field.type === "secret" && !this.form[field.key]) continue;
          data[field.key] = this.form[field.key];
        }
        await api(`integrations/${this.provider}`, "PATCH", data);
        this.message.success(this.$t("saved"), { duration: 3000 });
        for (const field of this.fields.filter((f) => f.type === "secret"))
          this.form[field.key] = "";
        this.saved = true;
      });
    },
    async test() {
      this.saved = false;
      await this.run(async () => {
        await api("integrations/smtp/test", "POST", {});
        this.saved = true;
      });
    },
  },
});
</script>
<template>
  <n-card :aria-busy="busy" class="settings-card"
    ><n-form @submit.prevent="save"
      ><n-form-item :label="$t('provider')"
        ><n-select
          filterable
          :input-props="{ 'aria-label': $t('provider') }"
          v-model:value="provider"
          :options="[
            { label: 'SMTP', value: 'smtp' },
            { label: 'Syslog', value: 'syslog' },
            { label: 'DokuWiki', value: 'wiki' },
            { label: 'LDAP / Active Directory', value: 'directory' },
            { label: 'Reverse Proxy / SSO', value: 'sso' },
          ]" /></n-form-item
      ><n-form-item
        v-for="field in fields"
        :key="provider + field.key"
        :label="label(field.label)"
        ><n-switch
          :aria-label="label(field.label)"
          v-if="field.type === 'switch'"
          v-model:value="form[field.key]" /><n-switch
          :aria-label="label(field.label)"
          v-else-if="field.type === 'stringSwitch'"
          :value="form[field.key] === '1'"
          @update:value="form[field.key] = $event ? '1' : '0'" /><n-input-number
          :input-props="{ 'aria-label': label(field.label) }"
          v-else-if="field.type === 'number'"
          v-model:value="form[field.key]"
          :min="1"
          :max="65535" /><n-select
          filterable
          :input-props="{ 'aria-label': label(field.label) }"
          v-else-if="['group', 'profile'].includes(field.type || '')"
          v-model:value="form[field.key]"
          :options="
            options(field.type === 'group' ? groups : profiles)
          " /><n-input
          :input-props="{ 'aria-label': label(field.label) }"
          v-else
          v-model:value="form[field.key]"
          :type="field.type === 'secret' ? 'password' : 'text'"
          :placeholder="
            field.type === 'secret' && form[field.key + 'Configured']
              ? '••••••••'
              : ''
          "
          autocomplete="off"
          :maxlength="4000"
      /></n-form-item>
      <div class="detail-actions">
        <n-button type="primary" attr-type="submit" :loading="busy">{{
          $t("save")
        }}</n-button
        ><n-button v-if="provider === 'smtp'" :loading="busy" @click="test"
          >SMTP · {{ $t("confirm") }}</n-button
        ><n-tag v-if="saved" type="success">{{ $t("saved") }}</n-tag>
      </div></n-form
    ></n-card
  >
</template>
