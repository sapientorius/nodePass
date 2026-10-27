<script lang="ts">
import { defineComponent, h } from "vue";
import { mapStores } from "pinia";
import {
  useMessage,
  NButton,
  NCheckbox,
  NInput,
  NSelect,
  NTag,
  NEmpty,
  NSpin,
  NPagination,
  NDataTable,
  type DataTableBaseColumn,
  type DataTableColumns,
  type DataTableSortState,
} from "naive-ui";
import type { Account } from "@nodepass/contracts";
import { api } from "../api";
import {
  accountPageSizes,
  accountSortFields,
  useAccounts,
  type AccountSortField,
} from "../stores/accounts";
import { useSession } from "../stores/session";
import { safeWebUrl } from "../safe-url";
import Icon from "../components/Icon.vue";
import PageAccent from "../components/PageAccent.vue";
import ClientBadge from "../components/ClientBadge.vue";
import AccountForm from "../components/AccountForm.vue";
import AccountDetail from "../components/AccountDetail.vue";
export default defineComponent({
  setup() {
    return { message: useMessage() };
  },
  components: {
    NButton,
    NCheckbox,
    NInput,
    NSelect,
    NTag,
    NEmpty,
    NSpin,
    NPagination,
    NDataTable,
    Icon,
    PageAccent,
    ClientBadge,
    AccountForm,
    AccountDetail,
  },
  data: () => ({
    categories: [] as any[],
    clients: [] as any[],
    groups: [] as any[],
    tags: [] as any[],
    selected: null as Account | null,
    editing: null as Account | null,
    formOpen: false,
    cataloguesLoading: true,
    copying: [] as number[],
    copyFeedback: "",
    active: true,
    debounce: undefined as ReturnType<typeof setTimeout> | undefined,
  }),
  computed: {
    ...mapStores(useAccounts, useSession),
    columns(): DataTableColumns<Account> {
      return [
        {
          ...this.sortColumn("name"),
          width: 170,
          render: (row) =>
            h(
              "button",
              {
                class: "table-title",
                onClick: () => {
                  this.selected = row;
                },
              },
              row.name,
            ),
        },
        {
          ...this.sortColumn("login"),
          width: 150,
          ellipsis: { tooltip: true },
        },
        {
          ...this.sortColumn("category"),
          width: 110,
          render: (row) =>
            h(
              NTag,
              { size: "small", bordered: false, round: true },
              { default: () => row.categoryName },
            ),
        },
        {
          ...this.sortColumn("client"),
          width: 110,
          ellipsis: { tooltip: true },
          render: (row) => row.clientName,
        },
        { title: this.$t("group"), key: "groupName", width: 100 },
        {
          title: this.$t("url"),
          key: "url",
          width: 190,
          render: (row) => {
            const href = safeWebUrl(row.url);
            return href
              ? h(
                  "a",
                  {
                    href,
                    target: "_blank",
                    rel: "noopener noreferrer",
                    class: "table-account-url",
                    title: row.url,
                  },
                  row.url ?? href,
                )
              : "—";
          },
        },
        {
          title: this.$t("password"),
          key: "password",
          width: 115,
          fixed: "right",
          render: (row) =>
            row.permissions.secret
              ? h(
                  NButton,
                  {
                    size: "small",
                    secondary: true,
                    "aria-label": `${this.$t("copyPassword")} · ${row.name}`,
                    loading: this.copying.includes(row.id),
                    onClick: () => {
                      void this.copyPassword(row);
                    },
                  },
                  {
                    icon: () => h(Icon, { name: "copy", size: 16 }),
                    default: () => this.$t("copy"),
                  },
                )
              : "—",
        },
        {
          title: "",
          key: "actions",
          width: 44,
          fixed: "right",
          render: (row) =>
            h(
              NButton,
              {
                quaternary: true,
                circle: true,
                "aria-label": this.$t("favorites"),
                onClick: () => {
                  void this.favorite(row);
                },
              },
              {
                default: () =>
                  h(Icon, {
                    name: "star",
                    size: 18,
                    style: row.favorite ? "color:var(--accent)" : "",
                  }),
              },
            ),
        },
      ];
    },
    categoryOptions() {
      return this.categories.map((c) => ({ label: c.name, value: c.id }));
    },
    clientOptions() {
      return this.clients.map((c) => ({ label: c.name, value: c.id }));
    },
    tagOptions() {
      return this.tags.map((tag) => ({ label: tag.name, value: tag.name }));
    },
    sortOptions() {
      return accountSortFields.map((key) => ({
        label: this.$t(key),
        value: key,
      }));
    },
    sortDirectionOptions() {
      return [
        { label: this.$t("ascending"), value: "asc" },
        { label: this.$t("descending"), value: "desc" },
      ];
    },
    accountSort() {
      return `${this.accountsStore.sort}:${this.accountsStore.sortDirection}`;
    },
    pageSizeOptions() {
      return accountPageSizes.map((value) => ({ label: String(value), value }));
    },
  },
  watch: {
    "$route.path": {
      immediate: true,
      handler() {
        this.accountsStore.favorite = this.$route.path === "/favorites";
        this.accountsStore.page = 1;
        void this.load();
      },
    },
    "accountsStore.search"() {
      clearTimeout(this.debounce);
      this.debounce = setTimeout(() => {
        this.accountsStore.page = 1;
        void this.load();
      }, 250);
    },
    "accountsStore.categoryId"() {
      this.accountsStore.page = 1;
      void this.load();
    },
    "accountsStore.clientId"() {
      this.accountsStore.page = 1;
      void this.load();
    },
    "accountsStore.tag"() {
      this.accountsStore.page = 1;
      void this.load();
    },
    "accountsStore.privateOnly"() {
      this.accountsStore.page = 1;
      void this.load();
    },
    accountSort() {
      this.accountsStore.page = 1;
      void this.load();
    },
  },
  async mounted() {
    try {
      [this.categories, this.clients, this.groups, this.tags] =
        await Promise.all([
          api("categories"),
          api("clients"),
          api("groups"),
          api("tags"),
        ]);
    } catch (e) {
      this.sessionStore.fail(e);
    } finally {
      this.cataloguesLoading = false;
    }
  },
  beforeUnmount() {
    this.active = false;
    clearTimeout(this.debounce);
  },
  methods: {
    safeWebUrl,
    sortColumn(field: AccountSortField): DataTableBaseColumn<Account> {
      const selected = this.accountsStore.sort === field;
      const nextDirection =
        selected && this.accountsStore.sortDirection === "asc"
          ? "descending"
          : "ascending";
      return {
        key: field,
        title: () =>
          h(
            "button",
            {
              type: "button",
              class: "table-sort-title",
              "aria-label": `${this.$t("sort")}: ${this.$t(field)} · ${this.$t(nextDirection)}`,
              onClick: (event: MouseEvent) => {
                event.stopPropagation();
                this.accountsStore.$patch({
                  sort: field,
                  sortDirection: nextDirection === "ascending" ? "asc" : "desc",
                });
              },
            },
            this.$t(field),
          ),
        sorter: true,
        sortOrder: selected
          ? this.accountsStore.sortDirection === "asc"
            ? "ascend"
            : "descend"
          : false,
        customNextSortOrder: (order) =>
          order === "ascend" ? "descend" : "ascend",
      };
    },
    changeTableSort(state: DataTableSortState | DataTableSortState[] | null) {
      if (!state || Array.isArray(state) || !state.order) return;
      const field = accountSortFields.find((key) => key === state.columnKey);
      if (field)
        this.accountsStore.$patch({
          sort: field,
          sortDirection: state.order === "descend" ? "desc" : "asc",
        });
    },
    async changePage(page: number) {
      this.accountsStore.page = page;
      await this.load();
      await this.scrollToResults();
    },
    async changePageSize(pageSize: number) {
      this.accountsStore.setPageSize(pageSize);
      await this.load();
      await this.scrollToResults();
    },
    async scrollToResults() {
      await this.$nextTick();
      if (this.active)
        (this.$refs.results as HTMLElement).scrollIntoView({ block: "start" });
    },
    async copyPassword(account: Account) {
      if (this.copying.includes(account.id) || !account.permissions.secret)
        return;
      this.copying.push(account.id);
      this.copyFeedback = "";
      try {
        const { password } = await api<{ password: string }>(
          `accounts/${account.id}/secret`,
          "POST",
          {},
        );
        if (!this.active) return;
        await navigator.clipboard.writeText(password);
        this.message.success(this.$t("clipboardCopied"), { duration: 2000 });
        this.copyFeedback = this.$t("passwordCopied");
      } catch (error) {
        if (this.active) this.sessionStore.fail(error);
      } finally {
        this.copying = this.copying.filter((id) => id !== account.id);
      }
    },
    async changeView(view: "cards" | "list") {
      this.accountsStore.setView(view);
      try {
        await api("preferences", "PATCH", { view });
      } catch (error) {
        this.sessionStore.fail(error);
      }
    },
    async load() {
      try {
        await this.accountsStore.load();
      } catch (e) {
        this.sessionStore.fail(e);
      }
    },
    create() {
      this.editing = null;
      this.formOpen = true;
    },
    edit(row: Account) {
      this.editing = row;
      this.formOpen = true;
    },
    async saved(row: Account) {
      this.formOpen = false;
      if (this.selected?.id === row.id) this.selected = row;
      await this.load();
    },
    async favorite(row: Account) {
      try {
        await api(`accounts/${row.id}/favorite`, "POST", {
          enabled: !row.favorite,
        });
        row.favorite = !row.favorite;
        if (this.accountsStore.favorite) await this.load();
      } catch (e) {
        this.sessionStore.fail(e);
      }
    },
    rowProps(row: Account) {
      return {
        onDblclick: () => {
          this.selected = row;
        },
      };
    },
  },
});
</script>
<template>
  <section class="account-page">
    <div class="page-heading">
      <div>
        <PageAccent />
        <h1>
          {{ $t(accountsStore.favorite ? "favorites" : "accounts")
          }}<span class="heading-count">{{ accountsStore.total }}</span>
        </h1>
      </div>
      <n-button
        type="primary"
        size="large"
        :disabled="
          cataloguesLoading ||
          !categories.length ||
          !clients.length ||
          !groups.length
        "
        @click="create"
        ><template #icon><Icon name="plus" /></template
        >{{ $t("create") }}</n-button
      >
    </div>
    <div class="filter-bar">
      <n-input
        :input-props="{ 'aria-label': $t('search') }"
        v-model:value="accountsStore.search"
        clearable
        :placeholder="$t('search')"
        :aria-label="$t('search')"
        size="large"
        class="account-search"
        ><template #prefix><Icon name="search" :size="18" /></template></n-input
      ><n-select
        filterable
        :input-props="{ 'aria-label': $t('category') }"
        v-model:value="accountsStore.categoryId"
        :options="categoryOptions"
        clearable
        :placeholder="$t('category')"
        :aria-label="$t('category')"
        class="filter-select"
      /><n-select
        filterable
        :input-props="{ 'aria-label': $t('client') }"
        v-model:value="accountsStore.clientId"
        :options="clientOptions"
        clearable
        :placeholder="$t('client')"
        :aria-label="$t('client')"
        class="filter-select"
      />
      <n-select
        v-model:value="accountsStore.tag"
        clearable
        filterable
        :options="tagOptions"
        :placeholder="$t('tags')"
        :input-props="{ 'aria-label': $t('tags') }"
        class="filter-select"
      />
      <n-checkbox v-model:checked="accountsStore.privateOnly">{{
        $t("private")
      }}</n-checkbox>
      <div class="view-toggle">
        <n-button
          :type="accountsStore.view === 'cards' ? 'primary' : 'default'"
          quaternary
          :aria-label="$t('cards')"
          :aria-pressed="accountsStore.view === 'cards'"
          @click="changeView('cards')"
          ><Icon name="grid" :size="18" /></n-button
        ><n-button
          :type="accountsStore.view === 'list' ? 'primary' : 'default'"
          quaternary
          :aria-label="$t('list')"
          :aria-pressed="accountsStore.view === 'list'"
          @click="changeView('list')"
          ><Icon name="list" :size="19"
        /></n-button>
      </div>
    </div>
    <div ref="results" class="results-caption">
      <span
        >{{ $t("all") }} <strong>{{ accountsStore.total }}</strong></span
      >
      <div class="account-sorting">
        <div class="sort-control">
          <span id="account-sort-label">{{ $t("sort") }}</span>
          <n-select
            filterable
            v-model:value="accountsStore.sort"
            :options="sortOptions"
            :input-props="{ 'aria-labelledby': 'account-sort-label' }"
          />
        </div>
        <div class="sort-control">
          <span id="account-direction-label">{{ $t("sortDirection") }}</span>
          <n-select
            filterable
            v-model:value="accountsStore.sortDirection"
            :options="sortDirectionOptions"
            :input-props="{ 'aria-labelledby': 'account-direction-label' }"
          />
        </div>
      </div>
    </div>
    <n-spin :show="accountsStore.loading"
      ><n-empty
        v-if="!accountsStore.items.length && !accountsStore.loading"
        :description="$t('empty')"
        class="account-empty"
        ><template #icon><Icon name="vault" :size="45" /></template
        ><template #extra
          ><n-button @click="create">{{ $t("create") }}</n-button></template
        ></n-empty
      >
      <div v-else-if="accountsStore.view === 'cards'" class="account-grid">
        <article
          v-for="account in accountsStore.items"
          :key="account.id"
          class="account-card"
        >
          <div class="card-top">
            <ClientBadge
              :name="account.clientName"
              :client-id="account.clientId"
            />
            <n-button
              quaternary
              circle
              :aria-label="$t('favorites')"
              :class="{ 'is-favorite': account.favorite }"
              @click="favorite(account)"
              ><Icon name="star" :size="18"
            /></n-button>
          </div>
          <button class="card-title" @click="selected = account">
            {{ account.name }}
          </button>
          <p class="account-login">{{ account.login || "—" }}</p>
          <a
            v-if="safeWebUrl(account.url)"
            :href="safeWebUrl(account.url)"
            target="_blank"
            rel="noopener noreferrer"
            class="account-url"
            :title="account.url || undefined"
            >{{ account.url }}</a
          >
          <dl v-if="account.listFields?.length" class="list-fields">
            <template v-for="field in account.listFields" :key="field.id">
              <dt>{{ field.name }}</dt>
              <dd>{{ field.value }}</dd>
            </template>
          </dl>
          <div class="card-tags">
            <n-tag size="small" :bordered="false" round>{{
              account.categoryName
            }}</n-tag
            ><span
              v-for="tag in account.tags?.slice(0, 2)"
              :key="tag"
              class="plain-tag"
              >{{ tag }}</span
            >
          </div>
          <div class="card-bottom">
            <span><Icon name="users" :size="14" />{{ account.groupName }}</span>
            <div class="card-actions">
              <n-button
                v-if="account.permissions.secret"
                quaternary
                size="small"
                :aria-label="$t('copyPassword') + ' · ' + account.name"
                :loading="copying.includes(account.id)"
                @click="copyPassword(account)"
                ><template #icon><Icon name="copy" :size="16" /></template
                >{{ $t("password") }}</n-button
              ><n-button
                secondary
                class="card-open"
                :aria-label="$t('reveal') + ' · ' + account.name"
                @click="selected = account"
                ><Icon name="arrow" :size="20"
              /></n-button>
            </div>
          </div>
        </article>
      </div>
      <n-data-table
        v-else
        remote
        :columns="columns"
        :data="accountsStore.items"
        :row-key="(row: Account) => row.id"
        :row-props="rowProps"
        :bordered="false"
        :single-line="false"
        :scroll-x="1100"
        class="accounts-table"
        @update:sorter="changeTableSort"
    /></n-spin>
    <p class="copy-feedback" role="status">{{ copyFeedback }}</p>
    <div class="pagination">
      <div class="page-size-control">
        <span>{{ $t("pageSize") }}</span>
        <n-select
          filterable
          :value="accountsStore.pageSize"
          :options="pageSizeOptions"
          :input-props="{ 'aria-label': $t('pageSize') }"
          @update:value="changePageSize"
        />
      </div>
      <n-pagination
        v-if="accountsStore.total > accountsStore.pageSize"
        :page="accountsStore.page"
        :page-size="accountsStore.pageSize"
        :item-count="accountsStore.total"
        :page-slot="5"
        @update:page="changePage"
      />
    </div>
    <AccountForm
      v-model:show="formOpen"
      :account="editing"
      :categories="categories"
      :clients="clients"
      :groups="groups"
      @saved="saved"
    />
    <AccountDetail
      :account="selected"
      @close="selected = null"
      @edit="edit"
      @changed="load"
    />
  </section>
</template>
