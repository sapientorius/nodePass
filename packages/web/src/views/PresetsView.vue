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
  NSwitch,
  NCheckbox,
  NList,
  NListItem,
  NThing,
  NPopconfirm,
} from "naive-ui";
import { api } from "../api";
import { useSession } from "../stores/session";
const initial = () => ({
  type: "account.private",
  userId: null as number | null,
  userGroupId: null as number | null,
  userProfileId: null as number | null,
  fixed: false,
  priority: 0,
  data: {} as any,
});
import NInputNumber from "../components/NumberField.vue";
import NModal from "../components/AccessibleModal.vue";
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
    NInputNumber,
    NSwitch,
    NCheckbox,
    NList,
    NListItem,
    NThing,
    NPopconfirm,
    NModal,
  },
  data: () => ({
    rows: [] as any[],
    users: [] as any[],
    groups: [] as any[],
    profiles: [] as any[],
    show: false,
    editing: 0,
    busy: false,
    form: initial(),
  }),
  computed: {
    types() {
      return [
        { label: this.$t("permissions"), value: "account.permission" },
        { label: this.$t("private"), value: "account.private" },
        { label: this.$t("password"), value: "account.password" },
        { label: this.$t("tags"), value: "account.tag" },
        { label: this.$t("expiry"), value: "session.timeout" },
      ];
    },
  },
  mounted() {
    void this.load();
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
        [this.rows, this.users, this.groups, this.profiles] = await Promise.all(
          [
            api("presets?all=true"),
            api("users"),
            api("groups"),
            api("profiles"),
          ],
        );
      });
    },
    options(rows: any[]) {
      return rows.map((r) => ({ label: r.name, value: r.id }));
    },
    open(row?: any) {
      this.editing = row?.id ?? 0;
      this.form = row
        ? {
            type: row.type,
            userId: row.userId,
            userGroupId: row.userGroupId,
            userProfileId: row.userProfileId,
            fixed: !!row.fixed,
            priority: row.priority,
            data: { ...row.data },
          }
        : initial();
      for (const key of [
        "usersView",
        "usersEdit",
        "userGroupsView",
        "userGroupsEdit",
        "tags",
      ])
        if (this.form.data[key] && !Array.isArray(this.form.data[key]))
          this.form.data[key] = Object.values(this.form.data[key]);
      this.show = true;
    },
    async save() {
      if (this.busy) return;
      await this.run(async () => {
        await api(
          `presets${this.editing ? "/" + this.editing : ""}`,
          this.editing ? "PATCH" : "POST",
          this.form,
        );
        this.show = false;
        this.message.success(this.$t("saved"), { duration: 3000 });
        this.rows = await api("presets?all=true");
      });
    },
    async remove(id: number) {
      if (this.busy) return;
      await this.run(async () => {
        await api(`presets/${id}`, "DELETE");
        this.rows = await api("presets?all=true");
      });
    },
  },
});
</script>
<template>
  <n-card :aria-busy="busy"
    ><n-button type="primary" @click="open()">{{ $t("add") }}</n-button
    ><n-list
      ><n-list-item v-for="row in rows" :key="row.id"
        ><n-thing
          :title="types.find((t) => t.value === row.type)?.label || row.type"
          :description="`${row.userId || $t('all')} · ${row.priority}`"
          ><template #action
            ><n-button size="small" @click="open(row)">{{
              $t("edit")
            }}</n-button
            ><n-popconfirm @positive-click="remove(row.id)"
              ><template #trigger
                ><n-button size="small" secondary type="error">{{
                  $t("delete")
                }}</n-button></template
              >{{ $t("confirm") }}</n-popconfirm
            ></template
          ></n-thing
        ></n-list-item
      ></n-list
    ></n-card
  >
  <n-modal
    v-model:show="show"
    preset="card"
    class="account-modal"
    :title="$t('presets')"
    ><n-form @submit.prevent="save"
      ><n-form-item :label="$t('format')"
        ><n-select
          filterable
          :input-props="{ 'aria-label': $t('format') }"
          v-model:value="form.type"
          :options="types"
          @update:value="form.data = {}"
      /></n-form-item>
      <div class="form-grid">
        <n-form-item :label="$t('users')"
          ><n-select
            filterable
            :input-props="{ 'aria-label': $t('users') }"
            v-model:value="form.userId"
            clearable
            :options="options(users)"
            :placeholder="$t('all')" /></n-form-item
        ><n-form-item :label="$t('groups')"
          ><n-select
            filterable
            :input-props="{ 'aria-label': $t('groups') }"
            v-model:value="form.userGroupId"
            clearable
            :options="options(groups)"
            :placeholder="$t('all')" /></n-form-item
        ><n-form-item :label="$t('profiles')"
          ><n-select
            filterable
            :input-props="{ 'aria-label': $t('profiles') }"
            v-model:value="form.userProfileId"
            clearable
            :options="options(profiles)"
            :placeholder="$t('all')" /></n-form-item
        ><n-form-item :label="$t('fixed')"
          ><n-switch
            :aria-label="$t('permissions')"
            v-model:value="form.fixed" /></n-form-item
        ><n-form-item :label="$t('priority')"
          ><n-input-number
            :input-props="{ 'aria-label': $t('list') }"
            v-model:value="form.priority"
            :min="0"
            :max="255"
        /></n-form-item>
      </div>
      <template v-if="form.type === 'account.private'"
        ><n-checkbox v-model:checked="form.data.privateUser">{{
          $t("private")
        }}</n-checkbox
        ><n-checkbox v-model:checked="form.data.privateGroup">{{
          $t("privateGroup")
        }}</n-checkbox></template
      >
      <template v-if="form.type === 'account.password'"
        ><n-form-item :label="$t('minLength')"
          ><n-input-number
            :input-props="{ 'aria-label': $t('minLength') }"
            v-model:value="form.data.length"
            :min="0"
            :max="128" /></n-form-item
        ><n-form-item :label="$t('minScore')"
          ><n-input-number
            :input-props="{ 'aria-label': $t('minScore') }"
            v-model:value="form.data.score"
            :min="0"
            :max="4" /></n-form-item
        ><n-form-item :label="$t('expiry') + ' (s)'"
          ><n-input-number
            :input-props="{ 'aria-label': $t('expiry') + ' (s)' }"
            v-model:value="form.data.expireTime"
            :min="0"
            :max="315360000" /></n-form-item
        ><n-form-item :label="$t('regex')"
          ><n-input
            v-model:value="form.data.regex"
            :input-props="{ 'aria-label': $t('regex') }"
            :maxlength="512"
            placeholder="^(?=.*[A-Z]).{16,}$"
        /></n-form-item>
        <n-checkbox
          v-for="flag in [
            'useLetters',
            'useLower',
            'useUpper',
            'useNumbers',
            'useSymbols',
          ]"
          :key="flag"
          :checked="!!form.data[flag]"
          @update:checked="form.data[flag] = $event"
          >{{ $t(flag) }}</n-checkbox
        >
      </template>
      <template v-if="form.type === 'account.permission'"
        ><n-form-item
          v-for="key in [
            'usersView',
            'usersEdit',
            'userGroupsView',
            'userGroupsEdit',
          ]"
          :key="key"
          :label="
            $t(key.includes('users') ? 'users' : 'groups') +
            ' · ' +
            $t(key.endsWith('Edit') ? 'edit' : 'reveal')
          "
          ><n-select
            filterable
            :input-props="{
              'aria-label':
                $t(key.includes('users') ? 'users' : 'groups') +
                ' · ' +
                $t(key.endsWith('Edit') ? 'edit' : 'reveal'),
            }"
            v-model:value="form.data[key]"
            multiple
            :options="
              options(key.includes('users') ? users : groups)
            " /></n-form-item
      ></template>
      <n-form-item v-if="form.type === 'account.tag'" :label="$t('tags')"
        ><n-select
          :input-props="{ 'aria-label': $t('tags') }"
          v-model:value="form.data.tags"
          multiple
          filterable
          tag
          :options="[]"
      /></n-form-item>
      <template v-if="form.type === 'session.timeout'"
        ><n-form-item label="IP / CIDR"
          ><n-input
            :input-props="{ 'aria-label': 'IP / CIDR' }"
            v-model:value="form.data.address" /></n-form-item
        ><n-form-item :label="$t('idleTimeout')"
          ><n-input-number
            :input-props="{ 'aria-label': $t('idleTimeout') }"
            v-model:value="form.data.timeout"
            :min="60"
            :max="3600" /></n-form-item
      ></template>
      <div class="modal-actions">
        <n-button @click="show = false">{{ $t("cancel") }}</n-button
        ><n-button type="primary" attr-type="submit" :loading="busy">{{
          $t("save")
        }}</n-button>
      </div></n-form
    ></n-modal
  >
</template>
