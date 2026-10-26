<script lang="ts">
import { defineComponent, type PropType } from "vue";
import {
  useMessage,
  NForm,
  NFormItem,
  NInput,
  NSelect,
  NButton,
  NCheckbox,
  NDynamicTags,
  NDatePicker,
} from "naive-ui";
import type { Account, Page } from "@nodepass/contracts";
import { api, generatePassword } from "../api";
import { useSession } from "../stores/session";
import Icon from "./Icon.vue";
const initial = () => ({
  name: "",
  login: "",
  url: "",
  notes: "",
  password: "",
  categoryId: null as number | null,
  clientId: null as number | null,
  userGroupId: null as number | null,
  isPrivate: false,
  isPrivateGroup: false,
  tags: [] as string[],
  passDateChange: 0,
  parentId: 0,
});
import NModal from "./AccessibleModal.vue";
export default defineComponent({
  setup() {
    return { message: useMessage() };
  },
  components: {
    NModal,
    NForm,
    NFormItem,
    NInput,
    NSelect,
    NButton,
    NCheckbox,
    NDynamicTags,
    NDatePicker,
    Icon,
  },
  props: {
    show: Boolean,
    account: { type: Object as PropType<Account | null>, default: null },
    categories: { type: Array as PropType<any[]>, required: true },
    clients: { type: Array as PropType<any[]>, required: true },
    groups: { type: Array as PropType<any[]>, required: true },
  },
  emits: ["update:show", "saved"],
  data: () => ({
    form: initial(),
    busy: false,
    changePassword: false,
    parentAccounts: [] as Account[],
    selectedParent: null as Account | null,
    parentsLoading: false,
    parentRevision: 0,
    formRevision: 0,
    parentDebounce: undefined as ReturnType<typeof setTimeout> | undefined,
  }),
  computed: {
    parentOptions() {
      const rows = [...this.parentAccounts];
      if (
        this.selectedParent &&
        !rows.some((row) => row.id === this.selectedParent!.id)
      )
        rows.unshift(this.selectedParent);
      return rows
        .filter((row) => row.id !== this.account?.id)
        .map((row) => ({
          label: [row.name, row.login].filter(Boolean).join(" · "),
          value: row.id,
        }));
    },
  },
  watch: {
    show(value: boolean) {
      this.formRevision++;
      this.parentRevision++;
      clearTimeout(this.parentDebounce);
      this.parentAccounts = [];
      this.selectedParent = null;
      this.parentsLoading = false;
      if (!value) {
        this.form = initial();
        return;
      }
      this.changePassword = !this.account;
      this.form = this.account
        ? {
            ...initial(),
            ...this.account,
            login: this.account.login ?? "",
            url: this.account.url ?? "",
            notes: this.account.notes ?? "",
            passDateChange: this.account.passDateChange ?? 0,
            password: "",
            isPrivate: !!(this.account as any).isPrivate,
            isPrivateGroup: !!(this.account as any).isPrivateGroup,
            tags: [...(this.account.tags ?? [])],
          }
        : {
            ...initial(),
            categoryId: this.categories[0]?.id ?? null,
            clientId: this.clients[0]?.id ?? null,
            userGroupId: this.groups[0]?.id ?? null,
          };
      void this.loadParents("");
      if (this.form.parentId) void this.loadSelectedParent();
    },
  },
  beforeUnmount() {
    this.formRevision++;
    this.parentRevision++;
    clearTimeout(this.parentDebounce);
  },
  methods: {
    async loadSelectedParent() {
      const revision = this.formRevision;
      try {
        const parent = await api<Account>(`accounts/${this.form.parentId}`);
        if (revision === this.formRevision && this.form.parentId === parent.id)
          this.selectedParent = parent;
      } catch (error) {
        if (revision === this.formRevision) useSession().fail(error);
      }
    },
    searchParents(search: string) {
      clearTimeout(this.parentDebounce);
      this.parentRevision++;
      this.parentsLoading = true;
      this.parentDebounce = setTimeout(
        () => void this.loadParents(search),
        250,
      );
    },
    async loadParents(search: string) {
      const revision = ++this.parentRevision;
      this.parentsLoading = true;
      try {
        const query = new URLSearchParams({ search, limit: "50" });
        const result = await api<Page<Account>>(`accounts?${query}`);
        if (revision === this.parentRevision) this.parentAccounts = result.data;
      } catch (error) {
        if (revision === this.parentRevision) useSession().fail(error);
      } finally {
        if (revision === this.parentRevision) this.parentsLoading = false;
      }
    },
    selectParent(id: number | null) {
      this.form.parentId = id ?? 0;
      this.selectedParent =
        this.parentAccounts.find((row) => row.id === id) ??
        (this.selectedParent?.id === id ? this.selectedParent : null);
    },
    options(rows: any[]) {
      return rows.map((r) => ({ label: r.name, value: r.id }));
    },
    generate() {
      this.form.password = generatePassword();
    },
    async save() {
      this.busy = true;
      try {
        const {
          name,
          login,
          url,
          notes,
          categoryId,
          clientId,
          userGroupId,
          isPrivate,
          isPrivateGroup,
          tags,
          passDateChange,
          parentId,
        } = this.form;
        const data = {
          name,
          login,
          url,
          notes,
          categoryId,
          clientId,
          userGroupId,
          isPrivate,
          isPrivateGroup,
          tags,
          passDateChange,
          parentId,
          ...(this.changePassword ? { password: this.form.password } : {}),
          ...(this.account ? { version: this.account.version } : {}),
        };
        const row = await api(
          `accounts${this.account ? `/${this.account.id}` : ""}`,
          this.account ? "PATCH" : "POST",
          data,
        );
        this.form.password = "";
        this.message.success(this.$t("saved"), { duration: 3000 });
        this.$emit("saved", row);
      } catch (e) {
        useSession().fail(e);
      } finally {
        this.busy = false;
      }
    },
  },
});
</script>
<template>
  <n-modal
    :show="show"
    preset="card"
    :title="$t(account ? 'edit' : 'create')"
    class="account-modal"
    :mask-closable="!busy"
    @update:show="$emit('update:show', $event)"
    ><n-form @submit.prevent="save"
      ><n-form-item :label="$t('name')" required
        ><n-input
          :input-props="{ 'aria-label': $t('name') }"
          v-model:value="form.name"
          :maxlength="100"
          autofocus
      /></n-form-item>
      <div class="form-grid">
        <n-form-item :label="$t('login')"
          ><n-input
            :input-props="{ 'aria-label': $t('login') }"
            v-model:value="form.login"
            :maxlength="50"
            autocomplete="off" /></n-form-item
        ><n-form-item :label="$t('url')"
          ><n-input
            :input-props="{ 'aria-label': $t('url') }"
            v-model:value="form.url"
            :maxlength="255"
            placeholder="https://"
        /></n-form-item>
      </div>
      <n-checkbox
        v-if="account?.permissions.editSecret"
        v-model:checked="changePassword"
        style="margin-bottom: 18px"
        >{{ $t("password") }}</n-checkbox
      ><n-form-item v-if="changePassword" :label="$t('password')" required
        ><n-input
          :input-props="{ 'aria-label': $t('password') }"
          v-model:value="form.password"
          type="password"
          show-password-on="click"
          autocomplete="new-password"
          :maxlength="1000" /><n-button
          style="margin-left: 8px"
          :aria-label="$t('generate')"
          @click="generate"
          ><Icon name="key" /></n-button
      ></n-form-item>
      <div class="form-grid">
        <n-form-item :label="$t('category')" required
          ><n-select
            filterable
            :input-props="{ 'aria-label': $t('category') }"
            v-model:value="form.categoryId"
            :options="options(categories)" /></n-form-item
        ><n-form-item :label="$t('client')" required
          ><n-select
            filterable
            :input-props="{ 'aria-label': $t('client') }"
            v-model:value="form.clientId"
            :options="options(clients)"
        /></n-form-item>
      </div>
      <n-form-item :label="$t('group')" required
        ><n-select
          filterable
          :input-props="{ 'aria-label': $t('group') }"
          v-model:value="form.userGroupId"
          :options="options(groups)" /></n-form-item
      ><n-form-item :label="$t('tags')"
        ><n-dynamic-tags
          v-model:value="form.tags"
          :input-props="{ inputProps: { 'aria-label': $t('tags') } }"
          ><template #trigger="{ activate, disabled }"
            ><n-button size="small" :disabled="disabled" @click="activate"
              >{{ $t("tags") }} · {{ $t("add") }}</n-button
            ></template
          ></n-dynamic-tags
        ></n-form-item
      >
      <div class="form-grid account-privacy">
        <n-checkbox v-model:checked="form.isPrivate">{{
          $t("private")
        }}</n-checkbox
        ><n-checkbox v-model:checked="form.isPrivateGroup">{{
          $t("privateGroup")
        }}</n-checkbox>
      </div>
      <n-form-item :label="$t('expiry')"
        ><n-date-picker
          :input-props="{ 'aria-label': $t('expiry') }"
          :value="form.passDateChange ? form.passDateChange * 1000 : null"
          type="date"
          clearable
          @update:value="
            form.passDateChange = $event ? Math.floor($event / 1000) : 0
          " /></n-form-item
      ><n-form-item :label="$t('parent')"
        ><n-select
          filterable
          :input-props="{ 'aria-label': $t('parent') }"
          :value="form.parentId || null"
          :options="parentOptions"
          :loading="parentsLoading"
          :placeholder="$t('selectAccount')"
          remote
          clearable
          @search="searchParents"
          @update:value="selectParent" /></n-form-item
      ><n-form-item :label="$t('notes')"
        ><n-input
          :input-props="{ 'aria-label': $t('notes') }"
          v-model:value="form.notes"
          type="textarea"
          :autosize="{ minRows: 3, maxRows: 8 }"
      /></n-form-item>
      <div class="modal-actions">
        <n-button :disabled="busy" @click="$emit('update:show', false)">{{
          $t("cancel")
        }}</n-button
        ><n-button type="primary" attr-type="submit" :loading="busy">{{
          $t("save")
        }}</n-button>
      </div></n-form
    ></n-modal
  >
</template>
