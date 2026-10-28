import { defineStore } from "pinia";
import type { Account, Page } from "@nodepass/contracts";
import { api } from "../api";
export const accountPageSizes = [12, 24, 48, 96];
export const accountSortFields = [
  "name",
  "login",
  "category",
  "client",
  "expiry",
] as const;
export type AccountSortField = (typeof accountSortFields)[number];
const storedPageSize = Number(localStorage.getItem("nodepass-page-size"));
export const useAccounts = defineStore("accounts", {
  state: () => ({
    items: [] as Account[],
    total: 0,
    search: "",
    categoryId: null as number | null,
    clientId: null as number | null,
    tag: null as string | null,
    privateOnly: false,
    sort: "name" as AccountSortField,
    sortDirection: "asc" as "asc" | "desc",
    favorite: false,
    view: (localStorage.getItem("nodepass-view") === "list"
      ? "list"
      : "cards") as "list" | "cards",
    page: 1,
    pageSize: accountPageSizes.includes(storedPageSize) ? storedPageSize : 24,
    loading: false,
    revision: 0,
  }),
  actions: {
    async load() {
      const revision = ++this.revision;
      this.loading = true;
      const q = new URLSearchParams({
        limit: String(this.pageSize),
        skip: String((this.page - 1) * this.pageSize),
      });
      if (this.search) q.set("search", this.search);
      if (this.categoryId) q.set("categoryId", String(this.categoryId));
      if (this.clientId) q.set("clientId", String(this.clientId));
      if (this.tag) q.set("tag", this.tag);
      q.set("sort", this.sort);
      q.set("direction", this.sortDirection);
      if (this.favorite) q.set("favorite", "true");
      if (this.privateOnly) q.set("privateOnly", "true");
      try {
        const result = await api<Page<Account>>(`accounts?${q}`);
        if (this.revision === revision) {
          this.items = result.data;
          this.total = result.total;
        }
      } finally {
        if (this.revision === revision) this.loading = false;
      }
    },
    setView(value: "list" | "cards") {
      this.view = value;
      localStorage.setItem("nodepass-view", value);
    },
    setPageSize(value: number) {
      if (!accountPageSizes.includes(value)) return;
      this.pageSize = value;
      this.page = 1;
      localStorage.setItem("nodepass-page-size", String(value));
    },
    invalidate() {
      this.items = [];
      this.total = 0;
      this.loading = false;
      this.revision++;
    },
    clear() {
      this.invalidate();
      this.search = "";
      this.categoryId = null;
      this.clientId = null;
      this.tag = null;
      this.privateOnly = false;
      this.sort = "name";
      this.sortDirection = "asc";
      this.page = 1;
    },
  },
});
