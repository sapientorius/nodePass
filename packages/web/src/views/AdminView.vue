<script lang="ts">
import { defineComponent, h } from "vue";
import {
  useMessage,
  NButton,
  NCard,
  NDataTable,
  NTag,
  NForm,
  NFormItem,
  NInput,
  NSelect,
  NSwitch,
  NCheckbox,
  NPopconfirm,
} from "naive-ui";
import { api, download } from "../api";
import { useSession } from "../stores/session";
import { defaultPolicy } from "@nodepass/contracts";
import Icon from "../components/Icon.vue";
import PageAccent from "../components/PageAccent.vue";
import TransferView from "./TransferView.vue";
import UpdatesView from "./UpdatesView.vue";
import IntegrationsView from "./IntegrationsView.vue";
import TokensView from "./TokensView.vue";
import PresetsView from "./PresetsView.vue";
import PasswordStrength from "../components/PasswordStrength.vue";
import NInputNumber from "../components/NumberField.vue";
import NModal from "../components/AccessibleModal.vue";
import CustomFieldEditor from "../components/CustomFieldEditor.vue";
import FieldHelp from "../components/FieldHelp.vue";
import { profilePermissionGroups } from "../profile-permissions";
export default defineComponent({
  setup() {
    return { message: useMessage() };
  },
  components: {
    FieldHelp,
    CustomFieldEditor,
    NButton,
    NCard,
    NDataTable,
    NForm,
    NFormItem,
    NInput,
    NInputNumber,
    NSelect,
    NSwitch,
    NModal,
    NCheckbox,
    Icon,
    PageAccent,
    TransferView,
    UpdatesView,
    IntegrationsView,
    TokensView,
    PresetsView,
    PasswordStrength,
  },
  data: () => ({
    rows: [] as any[],
    busy: false,
    show: false,
    editing: 0,
    form: {} as any,
    groups: [] as any[],
    profiles: [] as any[],
    policy: { ...defaultPolicy },
    accountAccess: { fullGroupAccess: false },
    accountAccessLoaded: false,
    backupName: "",
    legacyEvents: false,
    permissionGroups: profilePermissionGroups,
  }),
  computed: {
    missingUserAssignment() {
      return (
        this.section === "users" &&
        (this.form.userGroupId == null || this.form.userProfileId == null)
      );
    },
    additionalGroupOptions() {
      return this.options(
        this.groups.filter((group) => group.id !== this.form.userGroupId),
      );
    },
    fieldTypeOptions() {
      return [
        "textType",
        "password",
        "expiry",
        "numberType",
        "email",
        "phoneType",
        "url",
        "colorType",
        "integrations",
        "multilineType",
      ].map((key, index) => ({
        label: index === 8 ? "Wiki" : this.$t(key),
        value: index + 1,
      }));
    },
    fieldModuleId() {
      return (
        {
          users: 701,
          groups: 801,
          profiles: 901,
          categories: 101,
          clients: 301,
        } as Record<string, number>
      )[this.section];
    },
    fieldModuleOptions() {
      return [
        [1, "accounts"],
        [101, "categories"],
        [301, "clients"],
        [701, "users"],
        [801, "groups"],
        [901, "profiles"],
        [1001, "tokens"],
        [10, "accounts"],
        [61, "categories"],
        [62, "clients"],
        [71, "users"],
        [72, "groups"],
      ].map(([value, key]) => ({
        value: Number(value),
        label:
          this.$t(String(key)) +
          ([10, 61, 62, 71, 72].includes(Number(value)) ? " (2.x)" : ""),
      }));
    },
    section() {
      return String(this.$route.params.section);
    },
    columns() {
      const keys =
        this.section === "events"
          ? ["date", "action", "userId", "target"]
          : [
              "name",
              ...(this.section === "users"
                ? ["login", "email"]
                : this.section === "profiles"
                  ? []
                  : ["description"]),
            ];
      return [
        ...keys.map((k) => ({
          title: this.$t(
            ["name", "login"].includes(k)
              ? k
              : this.section === "events"
                ? "events"
                : "notes",
          ),
          key: k,
        })),
        ...(this.section === "users"
          ? [
              {
                title: this.$t("signIn"),
                key: "isDisabled",
                render: (row: any) =>
                  h(
                    NTag,
                    {
                      size: "small",
                      type: row.isDisabled ? "error" : "success",
                      bordered: false,
                    },
                    {
                      default: () =>
                        this.$t(
                          row.isDisabled ? "signInBlocked" : "signInAllowed",
                        ),
                    },
                  ),
              },
            ]
          : []),
        ...(this.section === "events"
          ? []
          : [
              {
                title: "",
                key: "actions",
                render: (row: any) =>
                  h("div", { class: "table-actions" }, [
                    h(
                      NButton,
                      {
                        size: "small",
                        quaternary: true,
                        onClick: () => {
                          this.open(row);
                        },
                      },
                      { default: () => this.$t("edit") },
                    ),
                    ...(!["users", "profiles"].includes(this.section)
                      ? [
                          h(
                            NPopconfirm,
                            { onPositiveClick: () => this.remove(row.id) },
                            {
                              trigger: () =>
                                h(
                                  NButton,
                                  {
                                    size: "small",
                                    quaternary: true,
                                    type: "error",
                                  },
                                  { default: () => this.$t("delete") },
                                ),
                              default: () => this.$t("confirm"),
                            },
                          ),
                        ]
                      : []),
                  ]),
              },
            ]),
      ];
    },
    mfaOptions() {
      return [
        { label: this.$t("everyone"), value: "everyone" },
        { label: this.$t("admins"), value: "admins" },
        { label: this.$t("optional"), value: "optional" },
      ];
    },
  },
  watch: {
    section: {
      immediate: true,
      handler() {
        void this.load();
      },
    },
  },
  methods: {
    session() {
      return useSession();
    },
    async remove(id: number) {
      if (this.busy) return;
      await this.run(async () => {
        await api(`${this.section}/${id}`, "DELETE");
        await this.load();
      });
    },
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
        if (this.section === "security") {
          this.accountAccessLoaded = false;
          [this.policy, this.accountAccess] = await Promise.all([
            api("security"),
            api("account-access"),
          ]);
          this.accountAccessLoaded = true;
        } else if (
          ![
            "backups",
            "transfer",
            "integrations",
            "tokens",
            "presets",
            "updates",
          ].includes(this.section)
        )
          this.rows = await api(
            this.section +
              (this.section === "events" && this.legacyEvents
                ? "?legacy=true"
                : ""),
          );
        if (this.section === "users")
          [this.groups, this.profiles] = await Promise.all([
            api("groups"),
            api("profiles"),
          ]);
      });
    },
    open(row?: any) {
      this.editing = row?.id ?? 0;
      const userGroupId = row?.userGroupId ?? null;
      this.form =
        this.section === "users"
          ? {
              name: row?.name ?? "",
              login: row?.login ?? "",
              email: row?.email ?? "",
              userGroupId,
              userProfileId: row?.userProfileId ?? null,
              isDisabled: !!row?.isDisabled,
              isAdminApp: !!row?.isAdminApp,
              isAdminAcc: !!row?.isAdminAcc,
              password: "",
              groups: (row?.groups ?? []).filter(
                (group: number) => group !== userGroupId,
              ),
            }
          : this.section === "profiles"
            ? { name: row?.name ?? "", profile: { ...(row?.profile ?? {}) } }
            : this.section === "fields"
              ? {
                  name: row?.name ?? "",
                  help: row?.help ?? "",
                  moduleId: row?.moduleId ?? 1,
                  typeId: row?.typeId ?? 1,
                  required: !!row?.required,
                  isEncrypted: !!row?.isEncrypted,
                  showInList: !!row?.showInList,
                }
              : this.section === "tags"
                ? { name: row?.name ?? "" }
                : {
                    name: row?.name ?? "",
                    description: row?.description ?? "",
                    ...(this.section === "clients"
                      ? { isGlobal: !!row?.isGlobal }
                      : {}),
                  };
      this.show = true;
    },
    setPrimaryGroup(groupId: number) {
      this.form.userGroupId = groupId;
      this.form.groups = this.form.groups.filter(
        (group: number) => group !== groupId,
      );
    },
    async save() {
      if (this.busy || this.missingUserAssignment) return;
      await this.run(async () => {
        const data = { ...this.form };
        if (this.section === "users" && !useSession().viewer?.isAppAdmin) {
          delete data.isAdminApp;
          delete data.isAdminAcc;
        }
        if (this.section === "users" && this.editing && !data.password)
          delete data.password;
        await api(
          `${this.section}${this.editing ? `/${this.editing}` : ""}`,
          this.editing ? "PATCH" : "POST",
          data,
        );
        this.form = {};
        this.show = false;
        this.message.success(this.$t("saved"), { duration: 3000 });
        await this.load();
      });
    },
    async savePolicy() {
      if (this.busy) return;
      await this.run(async () => {
        this.policy = await api("security", "PATCH", this.policy);
        this.message.success(this.$t("saved"), { duration: 3000 });
        useSession().passwordPolicy = {
          minLength: this.policy.minLength,
          minScore: this.policy.minScore,
        };
      });
    },
    async saveAccountAccess() {
      if (this.busy || !this.accountAccessLoaded) return;
      await this.run(async () => {
        this.accountAccess = await api(
          "account-access",
          "PATCH",
          this.accountAccess,
        );
        this.message.success(this.$t("saved"), { duration: 3000 });
      });
    },
    async backup() {
      if (this.busy) return;
      await this.run(async () => {
        this.backupName = (await api("backups", "POST", {})).name;
        this.message.success(this.$t("saved"), { duration: 3000 });
      });
    },
    async downloadBackup() {
      if (this.busy) return;
      await this.run(() =>
        download(`backups/${this.backupName}`, undefined, "GET"),
      );
    },
    options(rows: any[]) {
      return rows.map((r) => ({ label: r.name, value: r.id }));
    },
  },
});
</script>
<template>
  <section :aria-busy="busy">
    <div class="page-heading">
      <div>
        <PageAccent />
        <h1>
          {{
            section === "transfer"
              ? $t("import") + " / " + $t("export")
              : $t(section)
          }}
        </h1>
      </div>
      <n-button
        v-if="
          ![
            'security',
            'events',
            'backups',
            'transfer',
            'integrations',
            'tokens',
            'presets',
            'updates',
          ].includes(section)
        "
        type="primary"
        @click="open()"
        ><template #icon><Icon name="plus" /></template
        >{{ $t("add") }}</n-button
      >
      <n-button
        v-if="section === 'events'"
        @click="
          legacyEvents = !legacyEvents;
          load();
        "
        >{{ legacyEvents ? "nodePass" : "sysPass" }} ·
        {{ $t("events") }}</n-button
      >
    </div>
    <UpdatesView v-if="section === 'updates'" /><TransferView
      v-else-if="section === 'transfer'"
    /><IntegrationsView v-else-if="section === 'integrations'" /><TokensView
      v-else-if="section === 'tokens'"
    /><PresetsView v-else-if="section === 'presets'" />
    <n-card v-else-if="section === 'security'" class="settings-card"
      ><n-form
        label-placement="left"
        label-width="180"
        @submit.prevent="savePolicy"
        ><n-form-item :label="$t('mfa')"
          ><n-select
            filterable
            :input-props="{ 'aria-label': $t('mfa') }"
            v-model:value="policy.mfa"
            :options="mfaOptions" /></n-form-item
        ><n-form-item :label="$t('minLength')"
          ><n-input-number
            :input-props="{ 'aria-label': $t('minLength') }"
            v-model:value="policy.minLength"
            :min="12"
            :max="128" /></n-form-item
        ><n-form-item :label="$t('minScore')"
          ><n-input-number
            :input-props="{ 'aria-label': $t('minScore') }"
            v-model:value="policy.minScore"
            :min="2"
            :max="4" /></n-form-item
        ><n-form-item :label="$t('idleTimeout')"
          ><n-input-number
            :input-props="{ 'aria-label': $t('idleTimeout') }"
            v-model:value="policy.sessionIdleSeconds"
            :min="60"
            :max="3600" /></n-form-item
        ><n-form-item :label="$t('absoluteTimeout')"
          ><n-input-number
            :input-props="{ 'aria-label': $t('absoluteTimeout') }"
            v-model:value="policy.sessionAbsoluteSeconds"
            :min="300"
            :max="86400" /></n-form-item
        ><n-button type="primary" attr-type="submit" :loading="busy">{{
          $t("save")
        }}</n-button></n-form
      >
      <h2>{{ $t("accountAccessTitle") }}</h2>
      <n-form label-placement="top" @submit.prevent="saveAccountAccess">
        <n-form-item :label="$t('secondaryGroupAccess')">
          <n-switch
            v-model:value="accountAccess.fullGroupAccess"
            :aria-label="$t('secondaryGroupAccess')"
            :aria-disabled="busy || !accountAccessLoaded"
            aria-describedby="secondary-group-help private-group-help"
            :disabled="busy || !accountAccessLoaded"
          />
        </n-form-item>
        <p id="secondary-group-help" class="muted">
          {{ $t("secondaryGroupAccessHelp") }}
        </p>
        <p id="private-group-help" class="muted">
          {{ $t("privateGroupAccessHelp") }}
        </p>
        <n-button
          type="primary"
          attr-type="submit"
          :loading="busy"
          :disabled="!accountAccessLoaded"
          >{{ $t("save") }}</n-button
        >
      </n-form></n-card
    >
    <n-card v-else-if="section === 'backups'" class="settings-card"
      ><div class="backup-illustration"><Icon name="shield" :size="48" /></div>
      <h2>{{ $t("backups") }}</h2>
      <p class="muted">{{ $t("security") }} · nodePass</p>
      <n-button type="primary" :loading="busy" @click="backup">{{
        $t("add")
      }}</n-button>
      <div v-if="backupName" style="margin-top: 20px">
        <n-button :loading="busy" @click="downloadBackup">{{
          $t("download")
        }}</n-button>
      </div></n-card
    >
    <n-data-table
      v-else
      :columns="columns"
      :data="rows"
      :scroll-x="section === 'users' ? 700 : undefined"
      :loading="busy"
      :bordered="false"
      :row-key="(row: any) => row.id"
    />
    <n-modal
      v-model:show="show"
      preset="card"
      :title="$t(editing ? 'edit' : 'add')"
      class="account-modal"
      :class="{ 'profile-modal': section === 'profiles' }"
      ><n-form @submit.prevent="save"
        ><n-form-item :label="$t('name')"
          ><n-input
            :input-props="{ 'aria-label': $t('name') }"
            v-model:value="form.name" /></n-form-item
        ><template v-if="section === 'users'"
          ><n-form-item :label="$t('login')"
            ><n-input
              :input-props="{ 'aria-label': $t('login') }"
              v-model:value="form.login"
              autocomplete="off" /></n-form-item
          ><n-form-item :label="$t('password')"
            ><n-input
              :input-props="{ 'aria-label': $t('password') }"
              v-model:value="form.password"
              type="password"
              autocomplete="new-password" /></n-form-item
          ><PasswordStrength
            :value="form.password"
            v-bind="session().passwordPolicy"
          /><n-form-item :label="$t('email')"
            ><n-input
              :input-props="{ 'aria-label': $t('email') }"
              v-model:value="form.email"
              type="text" /></n-form-item
          ><n-form-item :label="$t('primaryGroup')" required
            ><template #label
              ><span class="user-group-label"
                >{{ $t("primaryGroup")
                }}<FieldHelp
                  id="user-primary-group-help"
                  :label="$t('primaryGroup')"
                  :text="$t('primaryGroupHelp')" /></span></template
            ><n-select
              filterable
              :input-props="{
                'aria-label': $t('primaryGroup'),
                'aria-required': true,
              }"
              :value="form.userGroupId"
              @update:value="setPrimaryGroup"
              :options="options(groups)"
            /> </n-form-item
          ><n-form-item :label="$t('additionalGroups')"
            ><template #label
              ><span class="user-group-label"
                >{{ $t("additionalGroups")
                }}<FieldHelp
                  id="user-additional-groups-help"
                  :label="$t('additionalGroups')"
                  :text="$t('additionalGroupsHelp')" /></span></template
            ><n-select
              filterable
              v-model:value="form.groups"
              multiple
              :options="additionalGroupOptions"
              :input-props="{
                'aria-label': $t('additionalGroups'),
              }"
            /> </n-form-item
          ><n-form-item :label="$t('profiles')" required
            ><n-select
              filterable
              :input-props="{
                'aria-label': $t('profiles'),
                'aria-required': true,
              }"
              v-model:value="form.userProfileId"
              :options="options(profiles)"
          /></n-form-item>
          <div v-if="session().viewer?.isAppAdmin" class="user-admin-roles">
            <n-checkbox v-model:checked="form.isAdminApp">{{
              $t("appAdmin")
            }}</n-checkbox
            ><n-checkbox v-model:checked="form.isAdminAcc">{{
              $t("accountAdmin")
            }}</n-checkbox>
          </div>
          <n-form-item :label="$t('allowSignIn')" class="user-sign-in"
            ><n-switch
              :aria-label="$t('allowSignIn')"
              aria-describedby="user-sign-in-help"
              :value="!form.isDisabled"
              @update:value="form.isDisabled = !$event"
            />
            <p id="user-sign-in-help" class="muted user-sign-in-help">
              {{ $t("allowSignInHelp") }}
            </p></n-form-item
          ></template
        ><template v-else-if="section === 'profiles'"
          ><p class="profile-permission-intro muted">
            {{ $t("profilePermissionIntro") }}
          </p>
          <fieldset
            v-for="group in permissionGroups"
            :key="group.key"
            class="profile-permission-group"
            :aria-describedby="
              group.key === 'profileLegacy' ? 'profile-legacy-help' : undefined
            "
          >
            <legend>{{ $t(group.key) }}</legend>
            <p
              v-if="group.key === 'profileLegacy'"
              id="profile-legacy-help"
              class="muted profile-legacy-help"
            >
              {{ $t("profileLegacyHelp") }}
            </p>
            <div
              v-for="flag in group.flags"
              :key="flag"
              class="profile-permission-row"
              :data-permission="flag"
            >
              <n-checkbox
                :checked="!!form.profile[flag]"
                @update:checked="form.profile[flag] = $event"
                >{{ $t(`permission_${flag}`) }}</n-checkbox
              >
              <FieldHelp
                :id="`profile-${flag}-help`"
                :label="
                  $t('profilePermissionInfo') + ' · ' + $t(`permission_${flag}`)
                "
                :text="$t(`permission_${flag}Help`)"
              />
            </div></fieldset></template
        ><template v-else-if="section === 'fields'"
          ><n-form-item :label="$t('notes')"
            ><n-input
              :input-props="{ 'aria-label': $t('notes') }"
              v-model:value="form.help" /></n-form-item
          ><n-form-item :label="$t('fieldScope')"
            ><n-select
              filterable
              v-model:value="form.moduleId"
              :options="fieldModuleOptions"
              :input-props="{ 'aria-label': $t('fieldScope') }" /></n-form-item
          ><n-form-item :label="$t('format')"
            ><n-select
              filterable
              :input-props="{ 'aria-label': $t('format') }"
              v-model:value="form.typeId"
              :options="fieldTypeOptions" /></n-form-item
          ><n-checkbox v-model:checked="form.isEncrypted">{{
            $t("secret")
          }}</n-checkbox
          ><n-checkbox v-model:checked="form.required">{{
            $t("required")
          }}</n-checkbox></template
        ><template v-else-if="section !== 'tags'"
          ><n-form-item :label="$t('notes')"
            ><n-input
              :input-props="{ 'aria-label': $t('notes') }"
              v-model:value="form.description"
              type="textarea" /></n-form-item
        ></template>
        <div class="modal-actions">
          <n-button @click="show = false">{{ $t("cancel") }}</n-button
          ><n-button
            type="primary"
            attr-type="submit"
            :loading="busy"
            :disabled="missingUserAssignment"
            >{{ $t("save") }}</n-button
          >
        </div></n-form
      ><CustomFieldEditor
        v-if="show && editing && fieldModuleId"
        hide-empty
        :endpoint="'items/' + fieldModuleId + '/' + editing + '/fields'"
        :can-secret="
          !!session().viewer?.isAppAdmin ||
          !!session().viewer?.permissions.accViewPass
        "
        :can-edit-secret="
          !!session().viewer?.isAppAdmin ||
          !!session().viewer?.permissions.accEditPass
        "
    /></n-modal>
  </section>
</template>
<style scoped>
:global(.account-modal.profile-modal) {
  width: min(780px, calc(100vw - 28px));
}
.profile-permission-intro,
.profile-legacy-help {
  line-height: 1.6;
  margin: 0 0 16px;
}
.profile-permission-group {
  min-width: 0;
  margin: 0 0 24px;
  padding: 12px 0 0;
  border: 0;
  border-top: 1px solid var(--border);
}
.profile-permission-group legend {
  padding: 0 12px 0 0;
  font-weight: 600;
  font-size: 15px;
}
.profile-permission-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  min-height: 44px;
  padding: 4px 0;
}
.profile-permission-row :deep(.n-checkbox) {
  min-width: 0;
  flex: 1;
  align-items: center;
}
.profile-permission-row :deep(.n-checkbox__label) {
  white-space: normal;
  overflow-wrap: anywhere;
}
.profile-permission-row :deep(.field-help-trigger) {
  flex: 0 0 auto;
  margin-left: 0;
  width: 32px;
  height: 32px;
}
.settings-card h2 {
  margin: 28px 0 20px;
}
@media (max-width: 600px) {
  .settings-card :deep(.n-form-item) {
    display: flex;
    flex-direction: column;
    align-items: stretch;
  }
  .settings-card :deep(.n-form-item-label) {
    width: auto !important;
    max-width: none;
    justify-content: flex-start;
    text-align: left;
    padding: 0 0 8px;
  }
  .settings-card :deep(.n-form-item-blank) {
    min-width: 0;
  }
}
.user-group-label {
  display: inline-flex;
  align-items: center;
  white-space: nowrap;
}
.user-admin-roles {
  display: flex;
  flex-wrap: wrap;
  gap: 12px 20px;
}
.user-admin-roles + .user-sign-in {
  margin-top: 24px;
}
.user-sign-in :deep(.n-form-item-blank) {
  display: block;
}
.user-sign-in-help {
  margin: 8px 0 0;
  font-size: 12px;
  line-height: 1.5;
}
</style>
