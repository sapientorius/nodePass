<script lang="ts">
import { defineComponent, type PropType } from "vue";
import { NButton, NDataTable, NPagination } from "naive-ui";
import type {
  GroupMember,
  GroupMembership,
  GroupReference,
  Page,
} from "@nodepass/contracts";
import { api } from "../api";
import { useSession } from "../stores/session";
import NModal from "./AccessibleModal.vue";

const listState = () => ({
  page: 1,
  total: 0,
  result: null as Page<GroupMember> | null,
  busy: false,
  error: false,
  revision: 0,
});
export default defineComponent({
  components: { NModal, NButton, NDataTable, NPagination },
  props: {
    group: { type: Object as PropType<GroupReference>, required: true },
  },
  emits: ["close"],
  data: () => ({
    active: true,
    lists: { primary: listState(), additional: listState() },
  }),
  computed: {
    title() {
      return `${this.$t("groupMembers")}: ${this.group.name}`;
    },
    columns() {
      return [
        { key: "name", title: this.$t("name") },
        { key: "login", title: this.$t("login") },
      ];
    },
    accessEpoch() {
      return useSession().accessEpoch;
    },
  },
  watch: {
    accessEpoch() {
      this.close();
    },
    "group.id"() {
      this.reset();
      this.loadBoth();
    },
  },
  mounted() {
    this.loadBoth();
  },
  beforeUnmount() {
    this.active = false;
    this.reset();
  },
  methods: {
    reset() {
      for (const kind of ["primary", "additional"] as const) {
        const state = this.lists[kind];
        state.revision++;
        state.result = null;
        state.page = 1;
        state.total = 0;
        state.error = false;
        state.busy = false;
      }
    },
    close() {
      this.active = false;
      this.reset();
      this.$emit("close");
    },
    loadBoth() {
      void this.load("primary", 1);
      void this.load("additional", 1);
    },
    async load(kind: GroupMembership, page: number) {
      const state = this.lists[kind];
      const revision = ++state.revision;
      const groupId = this.group.id;
      const accessEpoch = this.accessEpoch;
      state.page = page;
      state.result = null;
      state.busy = true;
      state.error = false;
      const current = () =>
        this.active &&
        this.group.id === groupId &&
        this.accessEpoch === accessEpoch &&
        state.revision === revision;
      try {
        const result = await api<Page<GroupMember>>(
          `groups/${groupId}/members?membership=${kind}&limit=25&skip=${(page - 1) * 25}`,
        );
        if (current()) {
          state.result = result;
          state.total = result.total;
        }
      } catch {
        if (current()) state.error = true;
      } finally {
        if (current()) state.busy = false;
      }
    },
  },
});
</script>
<template>
  <n-modal
    :show="true"
    :title="title"
    class="account-modal group-members-modal"
    @update:show="
      (show: boolean) => {
        if (!show) close();
      }
    "
  >
    <section
      v-for="kind in ['primary', 'additional'] as const"
      :key="kind"
      :aria-labelledby="`members-${kind}-title`"
      :aria-busy="lists[kind].busy"
      :data-membership="kind"
    >
      <h3 :id="`members-${kind}-title`">
        {{ $t(kind === "primary" ? "primaryMembers" : "additionalMembers") }}
      </h3>
      <div v-if="lists[kind].error" role="alert" class="member-error">
        <p>{{ $t("memberLoadError") }}</p>
        <n-button @click="load(kind, lists[kind].page)">{{
          $t("memberRetry")
        }}</n-button>
      </div>
      <template v-else>
        <p role="status">
          {{
            lists[kind].busy
              ? $t("loading")
              : $t("memberCount", { count: lists[kind].total })
          }}
        </p>
        <div
          class="members-table-scroll"
          tabindex="0"
          role="region"
          :aria-labelledby="`members-${kind}-title`"
        >
          <n-data-table
            :columns="columns"
            :data="lists[kind].result?.data ?? []"
            :loading="lists[kind].busy"
            :bordered="false"
            :row-key="(row: GroupMember) => row.id"
            :single-line="false"
          >
            <template #empty>{{
              lists[kind].busy ? $t("loading") : $t("empty")
            }}</template>
          </n-data-table>
        </div>
        <n-pagination
          v-if="lists[kind].total > 25"
          :page="lists[kind].page"
          :page-size="25"
          :item-count="lists[kind].total"
          :page-slot="5"
          :disabled="lists[kind].busy"
          @update:page="(page: number) => load(kind, page)"
        />
      </template>
    </section>
    <n-button class="members-close" @click="close">{{ $t("close") }}</n-button>
  </n-modal>
</template>
<style scoped>
.group-members-modal section {
  min-width: 0;
  margin-bottom: 24px;
}
.group-members-modal h3 {
  margin-bottom: 8px;
}
.group-members-modal :deep(.n-data-table-td) {
  overflow-wrap: anywhere;
}
.members-table-scroll {
  max-height: 320px;
  overflow: auto;
}
.members-table-scroll > .n-data-table {
  min-width: 420px;
}
.members-table-scroll:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 2px;
}
.group-members-modal .n-pagination {
  margin-top: 12px;
}
.member-error p {
  color: var(--text);
}
.members-close {
  margin-top: 8px;
}
</style>
