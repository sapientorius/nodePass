<script lang="ts">
import { defineComponent, type PropType } from "vue";
import {
  useMessage,
  NDrawer,
  NDrawerContent,
  NTabs,
  NTabPane,
  NDescriptions,
  NDescriptionsItem,
  NInput,
  NButton,
  NTag,
  NEmpty,
  NList,
  NListItem,
  NThing,
  NPopconfirm,
  NSelect,
  NForm,
  NFormItem,
} from "naive-ui";
import type { Account } from "@nodepass/contracts";
import { api } from "../api";
import { useSession } from "../stores/session";
import Icon from "./Icon.vue";
import NInputNumber from "./NumberField.vue";
import CustomFieldEditor from "./CustomFieldEditor.vue";
import { tabProps } from "../tab-props";
import { safeWebUrl } from "../safe-url";
type PublicLink = {
  id: number;
  hash: string;
  dateExpire: number;
  countViews: number;
  maxCountViews: number;
};
export default defineComponent({
  setup() {
    return { message: useMessage() };
  },
  components: {
    CustomFieldEditor,
    NDrawer,
    NDrawerContent,
    NTabs,
    NTabPane,
    NDescriptions,
    NDescriptionsItem,
    NInput,
    NButton,
    NTag,
    NEmpty,
    NList,
    NListItem,
    NThing,
    NInputNumber,
    NPopconfirm,
    Icon,
    NSelect,
    NForm,
    NFormItem,
  },
  props: {
    account: { type: Object as PropType<Account | null>, default: null },
  },
  emits: ["close", "edit", "changed"],
  data: () => ({
    secret: "",
    tab: "overview",
    history: [] as any[],
    files: [] as any[],
    links: [] as PublicLink[],
    users: [] as any[],
    groups: [] as any[],
    usersView: [] as number[],
    usersEdit: [] as number[],
    groupsView: [] as number[],
    groupsEdit: [] as number[],
    views: 3,
    validityMinutes: 60,
    busy: false,
    revision: 0,
    clearTimer: undefined as ReturnType<typeof setTimeout> | undefined,
    linkTimer: undefined as ReturnType<typeof setTimeout> | undefined,
  }),
  computed: {
    canShare() {
      return (
        Number.isInteger(this.views) &&
        this.views >= 1 &&
        this.views <= 1000 &&
        Number.isInteger(this.validityMinutes) &&
        this.validityMinutes >= 1 &&
        this.validityMinutes <= 10080
      );
    },
    safeUrl() {
      return safeWebUrl(this.account?.url);
    },
  },
  watch: {
    account() {
      this.revision++;
      this.clear();
      this.tab = "overview";
      this.history = [];
      this.files = [];
      this.setLinks([]);
    },
  },
  beforeUnmount() {
    this.revision++;
    this.clear();
    this.setLinks([]);
  },
  methods: {
    tabProps,
    async call(path: string, method = "GET", data?: unknown) {
      const revision = this.revision;
      const result = await api(path, method, data);
      if (revision !== this.revision)
        throw new Error("Account changed; request discarded");
      return result;
    },
    clear() {
      clearTimeout(this.clearTimer);
      this.secret = "";
    },
    async run(job: () => Promise<void>) {
      const revision = this.revision;
      this.busy = true;
      try {
        await job();
      } catch (e) {
        if (revision === this.revision) useSession().fail(e);
      } finally {
        this.busy = false;
      }
    },
    async reveal(copy = false) {
      await this.run(async () => {
        if (!this.account) return;
        const { password } = await this.call(
          `accounts/${this.account.id}/secret`,
          "POST",
          {},
        );
        if (copy) {
          await navigator.clipboard.writeText(password);
          this.message.success(this.$t("clipboardCopied"), { duration: 2000 });
        } else {
          this.secret = password;
          clearTimeout(this.clearTimer);
          this.clearTimer = setTimeout(() => {
            this.secret = "";
          }, 15000);
        }
      });
    },
    async loadTab(tab: string) {
      this.clear();
      this.setLinks([]);
      this.tab = tab;
      if (!this.account || tab === "overview") return;
      await this.run(async () => {
        if (tab === "history")
          this.history = await this.call(
            `accounts/${this.account!.id}/history`,
          );
        if (tab === "files")
          this.files = await this.call(`accounts/${this.account!.id}/files`);
        if (tab === "shares")
          this.setLinks(await this.call(`accounts/${this.account!.id}/links`));
        if (tab === "permissions") {
          const [grants, users, groups] = await Promise.all([
            this.call(`accounts/${this.account!.id}/permissions`),
            api("users"),
            api("groups"),
          ]);
          this.users = users;
          this.groups = groups;
          this.usersView = grants.users.map((g: any) => g.userId);
          this.usersEdit = grants.users
            .filter((g: any) => g.isEdit)
            .map((g: any) => g.userId);
          this.groupsView = grants.groups.map((g: any) => g.userGroupId);
          this.groupsEdit = grants.groups
            .filter((g: any) => g.isEdit)
            .map((g: any) => g.userGroupId);
        }
      });
    },
    async upload(event: Event) {
      const file = (event.target as HTMLInputElement).files?.[0];
      if (!file || !this.account) return;
      await this.run(async () => {
        if (file.size > 10 * 1024 ** 2) throw new Error(this.$t("error"));
        const bytes = new Uint8Array(await file.arrayBuffer());
        let binary = "";
        for (let i = 0; i < bytes.length; i += 8192)
          binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
        await this.call(`accounts/${this.account!.id}/files`, "POST", {
          name: file.name,
          content: btoa(binary),
        });
        this.files = await this.call(`accounts/${this.account!.id}/files`);
      });
    },
    async share() {
      this.setLinks(this.links);
      if (!this.account || !this.canShare || this.busy || this.links.length)
        return;
      await this.run(async () => {
        await this.call(`accounts/${this.account!.id}/links`, "POST", {
          views: this.views,
          seconds: this.validityMinutes * 60,
        });
        this.setLinks(await this.call(`accounts/${this.account!.id}/links`));
      });
    },
    setLinks(links: PublicLink[]) {
      clearTimeout(this.linkTimer);
      const now = Date.now();
      this.links =
        this.tab === "shares" && this.account
          ? links.filter(
              (link) =>
                link.dateExpire * 1000 > now &&
                (link.maxCountViews === 0 ||
                  link.countViews < link.maxCountViews),
            )
          : [];
      if (this.links.length) {
        const nextExpiry =
          Math.min(...this.links.map((l) => l.dateExpire)) * 1000;
        this.linkTimer = setTimeout(
          () => this.setLinks(this.links),
          Math.min(nextExpiry - now, 2_147_483_647),
        );
      }
    },
    async copyLink(link: PublicLink) {
      this.setLinks(this.links);
      if (this.busy || !this.links.includes(link)) return;
      await this.run(async () => {
        await navigator.clipboard.writeText(
          `${location.origin}/public/${link.hash}`,
        );
        this.message.success(this.$t("clipboardCopied"), { duration: 2000 });
      });
    },
    async revoke(id: number) {
      await this.run(async () => {
        await this.call(`links/${id}`, "DELETE");
        this.setLinks(this.links.filter((l) => l.id !== id));
      });
    },
    async remove() {
      await this.run(async () => {
        await this.call(`accounts/${this.account!.id}`, "DELETE");
        this.$emit("close");
        this.$emit("changed");
      });
    },
    options(rows: any[]) {
      return rows.map((r) => ({ label: r.name, value: r.id }));
    },
    async saveGrants() {
      await this.run(async () => {
        await this.call(`accounts/${this.account!.id}/permissions`, "PUT", {
          users: [...new Set([...this.usersView, ...this.usersEdit])].map(
            (userId) => ({ userId, isEdit: this.usersEdit.includes(userId) }),
          ),
          groups: [...new Set([...this.groupsView, ...this.groupsEdit])].map(
            (userGroupId) => ({
              userGroupId,
              isEdit: this.groupsEdit.includes(userGroupId),
            }),
          ),
        });
        this.$emit("changed");
      });
    },
    async restore(entry: any) {
      await this.run(async () => {
        await this.call(
          `accounts/${this.account!.id}/history/${entry.id}/restore`,
          "POST",
          { version: this.account!.version },
        );
        this.$emit("close");
        this.$emit("changed");
      });
    },
    async revealHistory(entry: any) {
      await this.run(async () => {
        this.secret = (
          await this.call(
            `accounts/${this.account!.id}/history/${entry.id}/secret`,
            "POST",
            {},
          )
        ).password;
        clearTimeout(this.clearTimer);
        this.clearTimer = setTimeout(() => this.clear(), 15000);
      });
    },
    async removeFile(id: number) {
      await this.run(async () => {
        await this.call(`files/${id}`, "DELETE");
        this.files = this.files.filter((f) => f.id !== id);
      });
    },
  },
});
</script>
<template>
  <n-drawer
    :show="!!account"
    :width="560"
    placement="right"
    :auto-focus="true"
    @update:show="!$event && $emit('close')"
    ><n-drawer-content v-if="account" :title="account.name" closable
      ><div class="detail-header">
        <div class="account-symbol"><Icon name="vault" :size="28" /></div>
        <div>
          <n-tag :bordered="false" round size="small">{{
            account.categoryName
          }}</n-tag>
          <p class="muted">{{ account.clientName }}</p>
        </div>
      </div>
      <n-tabs :value="tab" @update:value="loadTab"
        ><n-tab-pane
          name="overview"
          :tab="$t('accounts')"
          :tab-props="tabProps($t('accounts'), tab === 'overview')"
          ><n-descriptions :column="1" label-placement="top"
            ><n-descriptions-item :label="$t('login')">{{
              account.login || "—"
            }}</n-descriptions-item
            ><n-descriptions-item :label="$t('password')"
              ><div class="secret-row">
                <n-input
                  :input-props="{ 'aria-label': $t('password') }"
                  :value="secret || '••••••••••••••••'"
                  readonly
                  class="secret-input"
                /><n-button
                  v-if="account.permissions.secret"
                  :aria-label="$t('reveal')"
                  :loading="busy"
                  @click="reveal(false)"
                  ><Icon name="key" :size="18" /></n-button
                ><n-button
                  v-if="account.permissions.secret"
                  :aria-label="$t('copy')"
                  @click="reveal(true)"
                  ><Icon name="copy" :size="18"
                /></n-button></div></n-descriptions-item
            ><n-descriptions-item :label="$t('url')"
              ><a
                v-if="safeUrl"
                :href="safeUrl"
                target="_blank"
                rel="noopener noreferrer"
                >{{ account.url }}</a
              ><span v-else>{{ account.url || "—" }}</span></n-descriptions-item
            ><n-descriptions-item :label="$t('group')">{{
              account.groupName
            }}</n-descriptions-item
            ><n-descriptions-item :label="$t('tags')"
              ><n-tag
                v-for="tag in account.tags"
                :key="tag"
                size="small"
                style="margin: 0 5px 5px 0"
                >{{ tag }}</n-tag
              ></n-descriptions-item
            ><n-descriptions-item :label="$t('notes')"
              ><div class="notes-text">
                {{ account.notes || "—" }}
              </div></n-descriptions-item
            ></n-descriptions
          >
          <div class="detail-actions">
            <n-button
              v-if="account.permissions.edit"
              type="primary"
              @click="$emit('edit', account)"
              >{{ $t("edit") }}</n-button
            ><n-popconfirm
              v-if="account.permissions.delete"
              @positive-click="remove"
              ><template #trigger
                ><n-button type="error" secondary>{{
                  $t("delete")
                }}</n-button></template
              >{{ $t("confirm") }}</n-popconfirm
            >
          </div></n-tab-pane
        >
        <n-tab-pane
          v-if="account.permissions.history"
          name="history"
          :tab-props="tabProps($t('history'), tab === 'history')"
          :tab="$t('history')"
          ><n-empty v-if="!history.length" :description="$t('empty')" /><n-list
            v-else
            ><n-list-item v-for="entry in history" :key="entry.id"
              ><n-thing :title="entry.name" :description="entry.dateEdit || '—'"
                ><p>{{ entry.notes }}</p>
                <n-button
                  v-if="account.permissions.secret"
                  size="small"
                  @click="revealHistory(entry)"
                  >{{ $t("reveal") }}</n-button
                ><n-popconfirm
                  v-if="
                    account.permissions.edit && account.permissions.editSecret
                  "
                  @positive-click="restore(entry)"
                  ><template #trigger
                    ><n-button size="small">{{
                      $t("restore")
                    }}</n-button></template
                  >{{ $t("confirm") }}</n-popconfirm
                ></n-thing
              ></n-list-item
            ></n-list
          ><n-input v-if="secret" :value="secret" readonly class="secret-input"
        /></n-tab-pane>
        <n-tab-pane
          v-if="account.permissions.files"
          name="files"
          :tab-props="tabProps($t('files'), tab === 'files')"
          :tab="$t('files')"
          ><label v-if="account.permissions.edit" class="file-label"
            >{{ $t("upload") }}<input type="file" @change="upload" /></label
          ><n-empty v-if="!files.length" :description="$t('empty')" /><n-list
            v-else
            ><n-list-item v-for="file in files" :key="file.id"
              ><a :href="`/api/v1/files/${file.id}`" download>{{ file.name }}</a
              ><small class="muted">
                · {{ Math.ceil(file.size / 1024) }} KiB</small
              ><n-popconfirm
                v-if="account.permissions.edit"
                @positive-click="removeFile(file.id)"
                ><template #trigger
                  ><n-button quaternary size="small" type="error">{{
                    $t("delete")
                  }}</n-button></template
                >{{ $t("confirm") }}</n-popconfirm
              ></n-list-item
            ></n-list
          ></n-tab-pane
        >
        <n-tab-pane
          v-if="account.permissions.share"
          name="shares"
          :tab-props="tabProps($t('shares'), tab === 'shares')"
          :tab="$t('shares')"
          ><p class="share-help muted">{{ $t("shareHelp") }}</p>
          <n-form @submit.prevent="share">
            <div class="form-grid">
              <n-form-item :label="$t('shareMaxViews')">
                <n-input-number
                  :input-props="{ 'aria-label': $t('shareMaxViews') }"
                  v-model:value="views"
                  :min="1"
                  :max="1000"
                  :precision="0"
                  :disabled="busy || !!links.length"
                />
              </n-form-item>
              <n-form-item :label="$t('shareMinutes')">
                <n-input-number
                  :input-props="{ 'aria-label': $t('shareMinutes') }"
                  v-model:value="validityMinutes"
                  :min="1"
                  :max="10080"
                  :precision="0"
                  :disabled="busy || !!links.length"
                />
              </n-form-item>
            </div>
            <p class="share-help muted">{{ $t("shareLimitsHelp") }}</p>
            <p v-if="links.length" class="share-help muted">
              {{ $t("shareExisting") }}
            </p>
            <n-button
              type="primary"
              attr-type="submit"
              :loading="busy"
              :disabled="!canShare || busy || !!links.length"
              >{{ $t("createShare") }}</n-button
            >
          </n-form>
          <n-list v-if="links.length" style="margin-top: 20px"
            ><n-list-item v-for="link in links" :key="link.id"
              ><n-thing
                :title="
                  $t('expiresAt') +
                  ': ' +
                  new Date(link.dateExpire * 1000).toLocaleString()
                "
                :description="
                  $t('shareViewsUsed', {
                    count: link.countViews,
                    max: link.maxCountViews,
                  })
                "
                ><div class="share-actions">
                  <n-button
                    size="small"
                    :disabled="busy"
                    @click="copyLink(link)"
                    >{{ $t("copyShare") }}</n-button
                  >
                  <n-button
                    size="small"
                    :disabled="busy"
                    @click="revoke(link.id)"
                    >{{ $t("revokeShare") }}</n-button
                  >
                </div></n-thing
              ></n-list-item
            ></n-list
          ></n-tab-pane
        ><n-tab-pane
          name="fields"
          :tab="$t('fields')"
          :tab-props="tabProps($t('fields'), tab === 'fields')"
          ><CustomFieldEditor
            v-if="tab === 'fields'"
            :endpoint="'accounts/' + account.id + '/fields'"
            :can-edit="account.permissions.edit"
            :can-secret="account.permissions.secret"
            :can-edit-secret="account.permissions.editSecret" /></n-tab-pane
        ><n-tab-pane
          v-if="account.permissions.permissions"
          name="permissions"
          :tab-props="tabProps($t('permissions'), tab === 'permissions')"
          :tab="$t('permissions')"
          ><n-form @submit.prevent="saveGrants"
            ><n-form-item :label="$t('users') + ' · ' + $t('reveal')"
              ><n-select
                filterable
                :input-props="{
                  'aria-label': $t('users') + ' · ' + $t('reveal'),
                }"
                v-model:value="usersView"
                multiple
                :options="options(users)" /></n-form-item
            ><n-form-item :label="$t('users') + ' · ' + $t('edit')"
              ><n-select
                filterable
                :input-props="{
                  'aria-label': $t('users') + ' · ' + $t('edit'),
                }"
                v-model:value="usersEdit"
                multiple
                :options="options(users)" /></n-form-item
            ><n-form-item :label="$t('groups') + ' · ' + $t('reveal')"
              ><n-select
                filterable
                :input-props="{
                  'aria-label': $t('groups') + ' · ' + $t('reveal'),
                }"
                v-model:value="groupsView"
                multiple
                :options="options(groups)" /></n-form-item
            ><n-form-item :label="$t('groups') + ' · ' + $t('edit')"
              ><n-select
                filterable
                :input-props="{
                  'aria-label': $t('groups') + ' · ' + $t('edit'),
                }"
                v-model:value="groupsEdit"
                multiple
                :options="options(groups)" /></n-form-item
            ><n-button type="primary" attr-type="submit" :loading="busy">{{
              $t("save")
            }}</n-button></n-form
          ></n-tab-pane
        ></n-tabs
      ></n-drawer-content
    ></n-drawer
  >
</template>
<style scoped>
.share-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}
.share-help {
  font-size: 13px;
  line-height: 1.7;
  margin: 0 0 20px;
}
</style>
