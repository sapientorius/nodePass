<script lang="ts">
import { defineComponent } from "vue";
import { mapStores } from "pinia";
import {
  NConfigProvider,
  NMessageProvider,
  NDialogProvider,
  NButton,
  NAlert,
  NSelect,
  NSpin,
  NPopover,
  NBadge,
  NList,
  NListItem,
  NThing,
  darkTheme,
} from "naive-ui";
import { useSession } from "./stores/session";
import { useAccounts } from "./stores/accounts";
import { languageOptions } from "./i18n";
import Icon from "./components/Icon.vue";
import LoginView from "./views/LoginView.vue";
import UpdateNotice from "./components/UpdateNotice.vue";
import ConfirmationModal from "./components/ConfirmationModal.vue";
import { cancelConfirmation } from "./confirmation";
import { uiLocales, dateLocales } from "./ui-locale";
import type { Language, UpdateStatus } from "@nodepass/contracts";
import { api, setCsrf } from "./api";
export default defineComponent({
  components: {
    NConfigProvider,
    NMessageProvider,
    NDialogProvider,
    NButton,
    NAlert,
    NSelect,
    NSpin,
    NPopover,
    NBadge,
    NList,
    NListItem,
    NThing,
    Icon,
    LoginView,
    UpdateNotice,
    ConfirmationModal,
  },
  data: () => ({
    languageOptions,
    darkTheme,
    mobileOpen: false,
    notifications: [] as any[],
    updates: null as UpdateStatus | null,
    updateBusy: false,
    pollRevision: 0,
    poller: undefined as ReturnType<typeof setInterval> | undefined,
  }),
  computed: {
    componentLocale() {
      return uiLocales[this.$i18n.locale as Language];
    },
    componentDateLocale() {
      return dateLocales[this.$i18n.locale as Language];
    },
    ...mapStores(useSession, useAccounts),
    publicRoute() {
      return this.$route.path.startsWith("/public/");
    },
    themeOverrides() {
      return {
        common: {
          primaryColor:
            this.sessionStore.theme === "dark" ? "#62d9c3" : "#087f82",
          primaryColorHover:
            this.sessionStore.theme === "dark" ? "#8cebd9" : "#096d70",
          primaryColorPressed: "#065f62",
          borderRadius: "10px",
          fontFamily:
            'Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
          fontSize: "14px",
        },
        Button: { fontWeight: "600" },
        Card: { borderRadius: "16px" },
        Empty: {
          textColor: this.sessionStore.theme === "dark" ? "#b9c6d6" : "#526175",
        },
        DataTable: {
          thTextColor:
            this.sessionStore.theme === "dark" ? "#e3eaf3" : "#26364a",
          thColor: this.sessionStore.theme === "dark" ? "#253344" : "#edf1f5",
        },
      };
    },
    navigation() {
      const viewer = this.sessionStore.viewer;
      const management = [
        { key: "users", icon: "users", permission: "mgmUsers" },
        { key: "groups", icon: "users", permission: "mgmGroups" },
        { key: "profiles", icon: "shield", permission: "" },
        { key: "categories", icon: "folder", permission: "mgmCategories" },
        { key: "clients", icon: "folder", permission: "mgmCustomers" },
        { key: "tags", icon: "folder", permission: "mgmTags" },
        { key: "security", icon: "shield", permission: "" },
        { key: "updates", icon: "clock", permission: "" },
        { key: "events", icon: "clock", permission: "evl" },
        { key: "backups", icon: "folder", permission: "configBackup" },
        {
          key: "transfer",
          label: "import",
          icon: "folder",
          permission: "configImport",
        },
        { key: "integrations", icon: "settings", permission: "configGeneral" },
        { key: "tokens", icon: "key", permission: "mgmApiTokens" },
        { key: "presets", icon: "folder", permission: "mgmItemsPreset" },
        { key: "fields", icon: "folder", permission: "mgmCustomFields" },
      ]
        .filter((item) =>
          item.key === "updates"
            ? !!viewer?.isAppAdmin
            : viewer?.isAppAdmin || !!viewer?.permissions[item.permission],
        )
        .map((item) => ({
          key: item.label ?? item.key,
          to: "/manage/" + item.key,
          icon: item.icon,
        }));
      return [
        { key: "accounts", to: "/", icon: "vault" },
        { key: "favorites", to: "/favorites", icon: "star" },
        { key: "personal", to: "/settings", icon: "key" },
        ...management,
      ];
    },
  },
  watch: {
    "sessionStore.viewer"(viewer, previous) {
      if (
        viewer?.id !== previous?.id ||
        viewer?.phase !== previous?.phase ||
        viewer?.isAppAdmin !== previous?.isAppAdmin
      ) {
        this.pollRevision++;
        this.updates = null;
        this.notifications = [];
        this.updateBusy = false;
        if (viewer?.phase === "ready") void this.poll();
      }
    },
    "sessionStore.viewer.view"(view: "list" | "cards" | undefined) {
      if (view) this.accountsStore.setView(view);
    },
    "sessionStore.viewer.language"(locale: string) {
      if (locale) {
        this.$i18n.locale = locale;
        document.documentElement.lang = locale.split("_")[0]!;
      }
    },
    "sessionStore.theme": {
      immediate: true,
      handler(theme: string) {
        document.documentElement.dataset.theme = theme;
      },
    },
    "$route.fullPath"() {
      if (!this.sessionStore.booting) cancelConfirmation();
      this.mobileOpen = false;
    },
  },
  async mounted() {
    window.addEventListener("nodepass-expired", this.expired);
    await this.sessionStore.load();
    if (this.sessionStore.viewer)
      this.$i18n.locale = this.sessionStore.viewer.language;
    await this.poll();
    this.poller = setInterval(() => void this.poll(), 60000);
  },
  beforeUnmount() {
    this.pollRevision++;
    clearInterval(this.poller);
    window.removeEventListener("nodepass-expired", this.expired);
  },
  methods: {
    expired() {
      cancelConfirmation();
      setCsrf("");
      this.sessionStore.viewer = null;
      this.accountsStore.clear();
      this.notifications = [];
      this.updates = null;
      this.pollRevision++;
    },
    async poll() {
      if (this.sessionStore.viewer?.phase !== "ready") return;
      const revision = ++this.pollRevision;
      const viewer = this.sessionStore.viewer;
      try {
        const [notifications, updates] = await Promise.all([
          api<any[]>("notifications"),
          viewer.isAppAdmin
            ? api<UpdateStatus>("updates")
            : Promise.resolve(null),
        ]);
        if (
          revision !== this.pollRevision ||
          this.sessionStore.viewer?.id !== viewer.id
        )
          return;
        this.notifications = notifications;
        this.updates = updates;
      } catch (e) {
        this.sessionStore.fail(e);
      }
    },
    async acknowledgeUpdate(id: string) {
      if (this.updateBusy) return;
      this.updateBusy = true;
      try {
        await api("updates/acknowledgement", "POST", { id });
        await this.poll();
      } catch (error) {
        this.sessionStore.fail(error);
      } finally {
        this.updateBusy = false;
      }
    },
    async acknowledge(id: number) {
      try {
        await api(`notifications/${id}/read`, "POST", {});
        await this.poll();
      } catch (e) {
        this.sessionStore.fail(e);
      }
    },
    async logout() {
      try {
        await this.sessionStore.logout();
        this.accountsStore.clear();
        await this.$router.push("/");
      } catch (e) {
        this.sessionStore.fail(e);
      }
    },
    setLanguage(value: string) {
      this.$i18n.locale = value;
      document.documentElement.lang = value.split("_")[0]!;
      void api("preferences", "PATCH", { lang: value }).catch((e) =>
        this.sessionStore.fail(e),
      );
    },
  },
});
</script>
<template>
  <n-config-provider
    :locale="componentLocale"
    :date-locale="componentDateLocale"
    :theme="sessionStore.theme === 'dark' ? darkTheme : null"
    :theme-overrides="themeOverrides"
  >
    <n-message-provider
      ><n-dialog-provider>
        <div
          class="app-root"
          :class="{ 'is-dark': sessionStore.theme === 'dark' }"
        >
          <ConfirmationModal
            v-if="sessionStore.viewer?.phase === 'ready' && !publicRoute"
          />
          <div v-if="sessionStore.booting" class="boot">
            <img src="/logo.svg" alt="nodePass" width="64" height="64" /><n-spin
              size="large"
            />
          </div>
          <template v-else>
            <div v-if="sessionStore.error" class="global-error">
              <n-alert type="error" closable @close="sessionStore.error = ''">{{
                sessionStore.error
              }}</n-alert>
            </div>
            <template v-if="publicRoute"><router-view /></template>
            <template
              v-else-if="
                !sessionStore.viewer || sessionStore.viewer.phase !== 'ready'
              "
              ><LoginView
            /></template>
            <div v-else class="workspace">
              <button
                class="mobile-toggle"
                :aria-label="$t('accounts')"
                @click="mobileOpen = !mobileOpen"
              >
                <Icon name="list" />
              </button>
              <aside class="sidebar" :class="{ open: mobileOpen }">
                <router-link to="/" class="brand"
                  ><img src="/logo.svg" alt="" width="37" height="37" /><span
                    >node<span class="brand-weight">Pass</span
                    ><small>Password Manager</small></span
                  ></router-link
                >
                <div class="nav-caption">{{ $t("accounts") }}</div>
                <nav :aria-label="$t('accounts')">
                  <router-link
                    v-for="item in navigation"
                    :key="item.to"
                    :to="item.to"
                    class="nav-link"
                    :class="{ active: $route.path === item.to }"
                    ><Icon :name="item.icon" /><span>{{ $t(item.key) }}</span
                    ><span
                      v-if="item.key === 'accounts' && accountsStore.total"
                      class="nav-count"
                      >{{ accountsStore.total }}</span
                    ></router-link
                  >
                </nav>
                <div class="sidebar-bottom">
                  <a
                    class="repository-link"
                    href="https://github.com/sapientorius/nodePass"
                    target="_blank"
                    rel="noopener noreferrer"
                    aria-label="nodePass · GitHub"
                  >
                    <svg
                      width="19"
                      height="19"
                      viewBox="0 0 16 16"
                      fill="currentColor"
                      aria-hidden="true"
                      focusable="false"
                    >
                      <path
                        d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82a7.65 7.65 0 0 1 2-.27c.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0 0 16 8c0-4.42-3.58-8-8-8Z"
                      />
                    </svg>
                    <span>GitHub</span>
                    <Icon name="arrow" :size="14" class="repository-arrow" />
                  </a>
                  <div class="profile">
                    <div class="avatar">
                      {{ sessionStore.viewer.name.slice(0, 1).toUpperCase() }}
                    </div>
                    <div class="profile-name">
                      <strong>{{ sessionStore.viewer.name }}</strong
                      ><small>{{ sessionStore.viewer.login }}</small>
                    </div>
                    <n-button
                      quaternary
                      circle
                      :aria-label="$t('signOut')"
                      @click="logout"
                      ><Icon name="logout" :size="18"
                    /></n-button>
                  </div>
                </div>
              </aside>
              <div class="main-column">
                <header class="topbar">
                  <span class="breadcrumb"
                    >nodePass <span>/</span>
                    {{
                      $t(($route.params.section as string) || "accounts")
                    }}</span
                  >
                  <div class="toolbar">
                    <n-popover trigger="click" placement="bottom-end"
                      ><template #trigger
                        ><n-badge
                          :value="
                            notifications.filter((n) => !n.checked).length +
                            (updates?.available &&
                            !updates.available.acknowledged
                              ? 1
                              : 0)
                          "
                          :dot="!!updates?.available?.critical"
                          :type="
                            updates?.available?.critical ? 'error' : 'default'
                          "
                          :max="99"
                          ><n-button
                            quaternary
                            circle
                            :aria-label="
                              updates?.available?.critical
                                ? $t('notifications') +
                                  ': ' +
                                  $t('updatesCritical')
                                : $t('notifications')
                            "
                            ><Icon name="clock" /></n-button></n-badge
                      ></template>
                      <div class="notification-panel">
                        <UpdateNotice
                          v-if="updates"
                          :status="updates"
                          panel
                          :busy="updateBusy"
                          @acknowledge="acknowledgeUpdate"
                        />
                        <strong>{{ $t("notifications") }}</strong
                        ><n-list
                          ><n-list-item
                            v-for="item in notifications"
                            :key="item.id"
                            ><n-thing
                              :title="item.type"
                              :description="item.description"
                              ><template #action
                                ><n-button
                                  v-if="!item.checked"
                                  size="small"
                                  quaternary
                                  @click="acknowledge(item.id)"
                                  >{{ $t("confirm") }}</n-button
                                ></template
                              ></n-thing
                            ></n-list-item
                          ></n-list
                        >
                        <p v-if="!notifications.length" class="muted">
                          {{ $t("empty") }}
                        </p>
                      </div></n-popover
                    >
                    <n-select
                      filterable
                      :input-props="{ 'aria-label': $t('language') }"
                      class="language-select"
                      size="small"
                      :value="$i18n.locale"
                      :options="languageOptions"
                      :aria-label="$t('language')"
                      @update:value="setLanguage"
                    /><n-button
                      quaternary
                      circle
                      :aria-label="
                        $t(sessionStore.theme === 'light' ? 'dark' : 'light')
                      "
                      @click="sessionStore.toggleTheme"
                      ><Icon
                        :name="sessionStore.theme === 'light' ? 'moon' : 'sun'"
                    /></n-button>
                  </div>
                </header>
                <UpdateNotice
                  v-if="updates"
                  :status="updates"
                  :busy="updateBusy"
                  @acknowledge="acknowledgeUpdate"
                />
                <main id="main-content"><router-view /></main>
                <footer>
                  nodePass<template v-if="sessionStore.version">
                    <span aria-hidden="true">·</span>v{{ sessionStore.version }}
                  </template>
                </footer>
              </div>
            </div>
          </template>
        </div>
      </n-dialog-provider></n-message-provider
    >
  </n-config-provider>
</template>
