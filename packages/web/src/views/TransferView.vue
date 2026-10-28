<script lang="ts">
import { defineComponent } from "vue";
import {
  useMessage,
  NCard,
  NButton,
  NForm,
  NFormItem,
  NSelect,
  NInput,
  NCheckbox,
  NAlert,
  NTabs,
  NTabPane,
  NList,
  NListItem,
} from "naive-ui";
import { api, download } from "../api";
import { useSession } from "../stores/session";
import { tabProps } from "../tab-props";
export default defineComponent({
  setup() {
    return { message: useMessage() };
  },
  components: {
    NCard,
    NButton,
    NForm,
    NFormItem,
    NSelect,
    NInput,
    NCheckbox,
    NAlert,
    NTabs,
    NTabPane,
    NList,
    NListItem,
  },
  data: () => ({
    busy: false,
    tab: "import",
    format: "syspass",
    source: "",
    password: "",
    cleartext: false,
    preview: null as any,
    categories: [] as any[],
    clients: [] as any[],
    groups: [] as any[],
    categoryId: null as number | null,
    clientId: null as number | null,
    userGroupId: null as number | null,
    result: null as number | null,
  }),
  mounted() {
    void this.run(async () => {
      [this.categories, this.clients, this.groups] = await Promise.all([
        api("categories"),
        api("clients"),
        api("groups"),
      ]);
      this.categoryId = this.categories[0]?.id;
      this.clientId = this.clients[0]?.id;
      this.userGroupId = this.groups[0]?.id;
    });
  },
  beforeUnmount() {
    this.source = "";
    this.password = "";
    this.preview = null;
  },
  methods: {
    tabProps,
    options(rows: any[]) {
      return rows.map((r) => ({ label: r.name, value: r.id }));
    },
    async run(job: () => Promise<void>) {
      this.busy = true;
      try {
        await job();
      } catch (error) {
        useSession().fail(error);
      } finally {
        this.busy = false;
      }
    },
    async read(event: Event) {
      const file = (event.target as HTMLInputElement).files?.[0];
      if (!file) return;
      if (file.size > 10 * 1024 ** 2) {
        useSession().fail(this.$t("error"));
        return;
      }
      this.source = await file.text();
      this.preview = null;
      this.result = null;
    },
    async inspect() {
      if (this.busy) return;
      this.result = null;
      await this.run(async () => {
        this.preview = await api("import/preview", "POST", {
          format: this.format,
          source: this.source,
          password: this.password,
        });
        this.source = "";
        this.password = "";
      });
    },
    async commit() {
      if (this.busy) return;
      this.result = null;
      await this.run(async () => {
        this.result = (
          await api("import/commit", "POST", {
            challenge: this.preview.challenge,
            categoryId: this.categoryId,
            clientId: this.clientId,
            userGroupId: this.userGroupId,
          })
        ).count;
        this.message.success(this.$t("saved"), { duration: 3000 });
        this.preview = null;
      });
    },
    async exportFile() {
      if (this.busy) return;
      await this.run(async () => {
        await download("export", {
          format: this.format,
          password: this.password,
          cleartext: this.cleartext,
        });
        this.password = "";
      });
    },
  },
});
</script>
<template>
  <n-card :aria-busy="busy" class="settings-card"
    ><n-tabs
      v-model:value="tab"
      type="line"
      animated
      @update:value="
        preview = null;
        password = '';
        source = '';
        result = null;
      "
    >
      <n-tab-pane
        name="import"
        :tab="$t('import')"
        :tab-props="tabProps($t('import'), tab === 'import')"
        ><n-form @submit.prevent="preview ? commit() : inspect()"
          ><n-form-item :label="$t('format')"
            ><n-select
              filterable
              :input-props="{ 'aria-label': $t('format') }"
              v-model:value="format"
              :options="[
                { label: 'sysPass XML', value: 'syspass' },
                { label: 'KeePass XML', value: 'keepass' },
                { label: 'CSV', value: 'csv' },
              ]" /></n-form-item
          ><label class="file-label"
            >{{ $t("upload")
            }}<input type="file" accept=".csv,.xml" @change="read" /></label
          ><n-form-item
            v-if="format === 'syspass' && !preview"
            :label="$t('password')"
            ><n-input
              :input-props="{ 'aria-label': $t('password') }"
              v-model:value="password"
              type="password"
              autocomplete="off" /></n-form-item
          ><template v-if="preview"
            ><n-alert type="info" :title="$t('preview')"
              >{{ preview.count }} · {{ $t("accounts") }}</n-alert
            ><n-list
              ><n-list-item
                v-for="(name, index) in preview.names"
                :key="index"
                >{{ name }}</n-list-item
              ></n-list
            >
            <div class="form-grid">
              <n-form-item :label="$t('category')"
                ><n-select
                  filterable
                  :input-props="{ 'aria-label': $t('category') }"
                  v-model:value="categoryId"
                  :options="options(categories)" /></n-form-item
              ><n-form-item :label="$t('client')"
                ><n-select
                  filterable
                  :input-props="{ 'aria-label': $t('client') }"
                  v-model:value="clientId"
                  :options="options(clients)"
              /></n-form-item>
            </div>
            <n-form-item :label="$t('group')"
              ><n-select
                filterable
                :input-props="{ 'aria-label': $t('group') }"
                v-model:value="userGroupId"
                :options="options(groups)" /></n-form-item></template
          ><n-button
            type="primary"
            attr-type="submit"
            :disabled="!source && !preview"
            :loading="busy"
            >{{ $t(preview ? "import" : "preview") }}</n-button
          ><n-alert
            v-if="result !== null"
            type="success"
            style="margin-top: 16px"
            >{{ $t("saved") }} · {{ result }}</n-alert
          ></n-form
        ></n-tab-pane
      >
      <n-tab-pane
        name="export"
        :tab="$t('export')"
        :tab-props="tabProps($t('export'), tab === 'export')"
        ><n-form @submit.prevent="exportFile"
          ><n-form-item :label="$t('format')"
            ><n-select
              filterable
              :input-props="{ 'aria-label': $t('format') }"
              v-model:value="format"
              :options="[
                { label: 'sysPass XML', value: 'syspass' },
                { label: 'KeePass XML', value: 'keepass' },
                { label: 'CSV', value: 'csv' },
              ]" /></n-form-item
          ><n-form-item v-if="format === 'syspass'" :label="$t('password')"
            ><n-input
              :input-props="{ 'aria-label': $t('password') }"
              v-model:value="password"
              type="password"
              autocomplete="new-password" /></n-form-item
          ><n-checkbox
            v-else
            v-model:checked="cleartext"
            style="margin-bottom: 20px"
            >{{ $t("plaintextWarning") }}</n-checkbox
          ><n-button
            type="primary"
            attr-type="submit"
            :loading="busy"
            :disabled="format !== 'syspass' && !cleartext"
            >{{ $t("download") }}</n-button
          ></n-form
        ></n-tab-pane
      >
    </n-tabs></n-card
  >
</template>
