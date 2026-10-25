import { createApp } from "vue";
import { createPinia } from "pinia";
import { createRouter, createWebHistory } from "vue-router";
import App from "./App.vue";
import { i18n } from "./i18n";
import "./style.css";
const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: "/", component: () => import("./views/AccountsView.vue") },
    { path: "/favorites", component: () => import("./views/AccountsView.vue") },
    {
      path: "/manage/:section",
      component: () => import("./views/AdminView.vue"),
    },
    { path: "/settings", component: () => import("./views/PersonalView.vue") },
    {
      path: "/public/:hash",
      component: () => import("./views/PublicView.vue"),
    },
  ],
});
const legacy = new URLSearchParams(location.search).get("r");
if (legacy?.startsWith("account/viewLink/")) {
  history.replaceState(
    null,
    "",
    `/public/${encodeURIComponent(legacy.slice("account/viewLink/".length))}`,
  );
}
createApp(App).use(createPinia()).use(router).use(i18n).mount("#app");
