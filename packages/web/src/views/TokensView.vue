<script lang="ts">
import { defineComponent } from "vue";
import {
  NButton,
  NForm,
  NFormItem,
  NSelect,
  NInput,
  NDatePicker,
  NList,
  NListItem,
  NThing,
  NPopconfirm,
  NAlert,
} from "naive-ui";
import { api } from "../api";
import { useSession } from "../stores/session";
import NCard from "../components/PanelCard.vue";
import AccessibleModal from "../components/AccessibleModal.vue";
import CustomFieldEditor from "../components/CustomFieldEditor.vue";
export default defineComponent({
  components: {
    AccessibleModal,
    CustomFieldEditor,
    NCard,
    NButton,
    NForm,
    NFormItem,
    NSelect,
    NInput,
    NDatePicker,
    NList,
    NListItem,
    NThing,
    NPopconfirm,
    NAlert,
  },
  data: () => ({
    rows: [] as any[],
    methods: [] as string[],
    scopes: [] as any[],
    users: [] as any[],
    userId: useSession().viewer!.id,
    password: "",
    expiresAt: Date.now() + 90 * 86400000,
    created: "",
    busy: false,
    selectedFieldToken: 0,
  }),
  computed: { session: () => useSession() },
  mounted() {
    void this.load();
  },
  beforeUnmount() {
    this.created = "";
    this.password = "";
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
      await this.run(async () => {
        [this.rows, this.scopes, this.users] = await Promise.all([
          api("tokens"),
          api("token-scopes"),
          api("users"),
        ]);
      });
    },
    async create() {
      await this.run(async () => {
        const data = await api("tokens", "POST", {
          userId: this.userId,
          methods: this.methods,
          password: this.password,
          expiresAt: this.expiresAt,
        });
        this.created = data.token;
        this.password = "";
        this.rows = await api("tokens");
      });
    },
    async remove(id: number) {
      await this.run(async () => {
        await api(`tokens/${id}`, "DELETE");
        this.rows = await api("tokens");
      });
    },
  },
});
</script>
<template>
  <div class="settings-grid">
    <n-card :aria-busy="busy" :title="$t('tokens')"
      ><n-list
        ><n-list-item v-for="row in rows" :key="row.id"
          ><n-thing
            :title="row.method"
            :description="`${row.userId} · ${row.expiresAt ? new Date(row.expiresAt).toLocaleString() : 'sysPass'}`"
            ><template #action
              ><n-button
                size="small"
                quaternary
                @click="selectedFieldToken = row.id"
                >{{ $t("fields") }}</n-button
              ><n-popconfirm @positive-click="remove(row.id)"
                ><template #trigger
                  ><n-button type="error" secondary size="small">{{
                    $t("delete")
                  }}</n-button></template
                >{{ $t("confirm") }}</n-popconfirm
              ></template
            ></n-thing
          ></n-list-item
        ></n-list
      ></n-card
    ><n-card :title="$t('add')"
      ><n-form @submit.prevent="create"
        ><n-form-item :label="$t('users')"
          ><n-select
            filterable
            :input-props="{ 'aria-label': $t('users') }"
            v-model:value="userId"
            :options="
              users.map((u) => ({ label: u.name, value: u.id }))
            " /></n-form-item
        ><n-form-item :label="$t('permissions')"
          ><n-select
            filterable
            :input-props="{ 'aria-label': $t('permissions') }"
            v-model:value="methods"
            multiple
            :options="scopes" /></n-form-item
        ><n-form-item :label="$t('password')"
          ><n-input
            :input-props="{ 'aria-label': $t('password') }"
            v-model:value="password"
            type="password"
            autocomplete="new-password"
            :maxlength="128" /></n-form-item
        ><n-form-item :label="$t('expiresAt')"
          ><n-date-picker
            :input-props="{ 'aria-label': $t('expiresAt') }"
            v-model:value="expiresAt"
            type="datetime" /></n-form-item
        ><n-button type="primary" attr-type="submit" :loading="busy">{{
          $t("add")
        }}</n-button></n-form
      ><n-alert
        v-if="created"
        type="warning"
        :title="$t('recoveryHelp')"
        style="margin-top: 20px"
        ><code class="break-secret">{{ created }}</code
        ><n-button quaternary @click="created = ''">{{
          $t("close")
        }}</n-button></n-alert
      ></n-card
    >
    <AccessibleModal
      :show="!!selectedFieldToken"
      :title="$t('fields')"
      class="account-modal"
      @update:show="!$event && (selectedFieldToken = 0)"
      ><CustomFieldEditor
        v-if="selectedFieldToken"
        :endpoint="'items/1001/' + selectedFieldToken + '/fields'"
        :can-secret="
          !!session.viewer?.isAppAdmin ||
          !!session.viewer?.permissions.accViewPass
        "
        :can-edit-secret="
          !!session.viewer?.isAppAdmin ||
          !!session.viewer?.permissions.accEditPass
        "
      /><n-button @click="selectedFieldToken = 0">{{
        $t("close")
      }}</n-button></AccessibleModal
    >
  </div>
</template>
