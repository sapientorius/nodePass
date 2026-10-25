<script lang="ts">
import { defineComponent } from "vue";
const paths: Record<string, string> = {
  info: "M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18 M12 11v6 M12 7h.01",
  vault: "M5 4h14v16H5z M9 8h6v8H9z M3 8h2 M3 16h2 M15 12h4",
  star: "m12 3 2.8 5.7 6.2.9-4.5 4.4 1.1 6.2L12 17.3l-5.6 2.9 1.1-6.2L3 9.6l6.2-.9Z",
  search: "M21 21l-5-5 M18 10a8 8 0 1 1-16 0 8 8 0 0 1 16 0",
  plus: "M12 5v14 M5 12h14",
  grid: "M3 3h7v7H3z M14 3h7v7h-7z M3 14h7v7H3z M14 14h7v7h-7z",
  list: "M8 5h13 M8 12h13 M8 19h13 M3 5h.01 M3 12h.01 M3 19h.01",
  shield: "m12 3 8 3v6c0 4-5 7-8 9-3-2-8-5-8-9V6z M8 12l3 3 5-6",
  users:
    "M16 21v-3c0-3-3-5-6-5s-6 2-6 5v3 M10 10a4 4 0 1 0 0-8 4 4 0 0 0 0 8 M17 4c5 0 5 7 0 7 M20 21v-3c0-2-1-4-3-4",
  folder: "M3 6h7l2 3h9v11H3z",
  settings:
    "M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8 M12 2v3 M12 19v3 M2 12h3 M19 12h3 M5 5l2 2 M17 17l2 2 M5 19l2-2 M17 7l2-2",
  sun: "M12 7a5 5 0 1 0 0 10 5 5 0 0 0 0-10 M12 1v2 M12 21v2 M1 12h2 M21 12h2 M4 4l2 2 M18 18l2 2 M4 20l2-2 M18 6l2-2",
  moon: "M20 15a9 9 0 0 1-11-11 9 9 0 1 0 11 11",
  logout: "M9 4H4v16h5 M9 12h12 M17 8l4 4-4 4",
  key: "M14 7a5 5 0 1 0 0 10 5 5 0 0 0 0-10 M9 12H2 M5 12v4",
  copy: "M9 8h11v13H9z M15 8V3H3v13h6",
  arrow: "m9 5 7 7-7 7",
  clock: "M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18 M12 7v5l3 2",
  lock: "M6 10h12v11H6z M8 10V6a4 4 0 0 1 8 0v4",
};
export default defineComponent({
  props: {
    name: { type: String, default: "vault" },
    size: { type: Number, default: 20 },
  },
  computed: {
    path() {
      return paths[this.name] ?? paths.vault;
    },
  },
});
</script>
<template>
  <svg
    :width="size"
    :height="size"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    stroke-width="1.65"
    stroke-linecap="round"
    stroke-linejoin="round"
    aria-hidden="true"
  >
    <path :d="path" />
  </svg>
</template>
