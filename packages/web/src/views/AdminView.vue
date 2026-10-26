<script lang="ts">
import { defineComponent, h } from "vue";
import {
  NButton,
  NCard,
  NDataTable,
  NForm,
  NFormItem,
  NInput,
  NSelect,
  NSwitch,
  NCheckbox,
  NPopconfirm,
} from "naive-ui";
import { api } from "../api";
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
export default defineComponent({
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
    backupName: "",
    legacyEvents: false,
    flags: [
      "accView",
      "accViewPass",
      "accViewHistory",
      "accEdit",
      "accEditPass",
      "accAdd",
      "accDelete",
      "accFiles",
      "accPrivate",
      "accPrivateGroup",
      "accPermission",
      "accPublicLinks",
      "accGlobalSearch",
      "configGeneral",
      "configEncryption",
      "configBackup",
      "configImport",
      "mgmUsers",
      "mgmGroups",
      "mgmProfiles",
      "mgmCategories",
      "mgmCustomers",
      "mgmApiTokens",
      "mgmPublicLinks",
      "mgmTags",
      "mgmFiles",
      "mgmItemsPreset",
      "mgmAccounts",
      "evl",
      "mgmCustomFields",
    ],
  }),
  computed: {
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
        if (this.section === "security") this.policy = await api("security");
        else if (
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
      const userGroupId = row?.userGroupId ?? this.groups[0]?.id;
      this.form =
        this.section === "users"
          ? {
              name: row?.name ?? "",
              login: row?.login ?? "",
              email: row?.email ?? "",
              userGroupId,
              userProfileId: row?.userProfileId ?? this.profiles[0]?.id,
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
        await this.load();
      });
    },
    async savePolicy() {
      await this.run(async () => {
        this.policy = await api("security", "PATCH", this.policy);
        useSession().passwordPolicy = {
          minLength: this.policy.minLength,
          minScore: this.policy.minScore,
        };
      });
    },
    async backup() {
      await this.run(async () => {
        this.backupName = (await api("backups", "POST", {})).name;
      });
    },
    options(rows: any[]) {
      return rows.map((r) => ({ label: r.name, value: r.id }));
    },
    flagLabel(flag: string) {
      const mapping: Record<string, string[]> = {
        accView: ["reveal", "accounts"],
        accViewPass: ["reveal", "secret"],
        accViewHistory: ["reveal", "history"],
        accEdit: ["edit", "accounts"],
        accEditPass: ["edit", "secret"],
        accAdd: ["create"],
        accDelete: ["delete", "accounts"],
        accFiles: ["files"],
        accPrivate: ["private"],
        accPrivateGroup: ["privateGroup"],
        accPermission: ["permissions"],
        accPublicLinks: ["shares"],
        accGlobalSearch: ["search", "accounts"],
        mgmAccounts: ["accounts"],
        configBackup: ["backups", "export"],
        configImport: ["import"],
        configGeneral: ["settings"],
        configEncryption: ["security"],
        mgmUsers: ["users"],
        mgmGroups: ["groups"],
        mgmProfiles: ["profiles"],
        mgmCategories: ["categories"],
        mgmCustomers: ["clients"],
        mgmApiTokens: ["tokens"],
        mgmPublicLinks: ["shares"],
        mgmTags: ["tags"],
        mgmFiles: ["files"],
        mgmItemsPreset: ["presets"],
        mgmCustomFields: ["fields"],
        evl: ["events"],
      };
      return (mapping[flag] ?? ["settings"]).map((k) => this.$t(k)).join(" · ");
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
      ></n-card
    >
    <n-card v-else-if="section === 'backups'" class="settings-card"
      ><div class="backup-illustration"><Icon name="shield" :size="48" /></div>
      <h2>{{ $t("backups") }}</h2>
      <p class="muted">{{ $t("security") }} · nodePass</p>
      <n-button type="primary" :loading="busy" @click="backup">{{
        $t("add")
      }}</n-button>
      <div v-if="backupName" style="margin-top: 20px">
        <a :href="`/api/v1/backups/${backupName}`" download>{{
          $t("download")
        }}</a>
      </div></n-card
    >
    <n-data-table
      v-else
      :columns="columns"
      :data="rows"
      :loading="busy"
      :bordered="false"
      :row-key="(row: any) => row.id"
    />
    <n-modal
      v-model:show="show"
      preset="card"
      :title="$t(editing ? 'edit' : 'add')"
      class="account-modal"
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
            v-bind="session().passwordPolicy" /><n-form-item
            :label="$t('email')"
            ><n-input
              :input-props="{ 'aria-label': $t('email') }"
              v-model:value="form.email"
              type="text" /></n-form-item
          ><n-form-item :label="$t('primaryGroup')"
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
          ><n-form-item :label="$t('profiles')"
            ><n-select
              filterable
              :input-props="{ 'aria-label': $t('profiles') }"
              v-model:value="form.userProfileId"
              :options="options(profiles)"
          /></n-form-item>
          <template v-if="session().viewer?.isAppAdmin"
            ><n-checkbox v-model:checked="form.isAdminApp">{{
              $t("appAdmin")
            }}</n-checkbox
            ><n-checkbox v-model:checked="form.isAdminAcc">{{
              $t("accountAdmin")
            }}</n-checkbox></template
          >
          <n-form-item :label="$t('signIn')"
            ><n-switch
              :aria-label="$t('signIn')"
              :value="!form.isDisabled"
              @update:value="
                form.isDisabled = !$event
              " /></n-form-item></template
        ><template v-else-if="section === 'profiles'"
          ><div class="permission-grid">
            <n-checkbox
              v-for="flag in flags"
              :key="flag"
              :checked="!!form.profile[flag]"
              @update:checked="form.profile[flag] = $event"
              >{{ flagLabel(flag) }}</n-checkbox
            >
          </div></template
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
          ><n-checkbox
            v-if="section === 'clients'"
            v-model:checked="form.isGlobal"
            >{{ $t("all") }}</n-checkbox
          ></template
        >
        <div class="modal-actions">
          <n-button @click="show = false">{{ $t("cancel") }}</n-button
          ><n-button type="primary" attr-type="submit" :loading="busy">{{
            $t("save")
          }}</n-button>
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
.user-group-label {
  display: inline-flex;
  align-items: center;
  white-space: nowrap;
}
</style>
