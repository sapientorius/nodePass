<script lang="ts">
import { defineComponent, h } from "vue";
import { NInputNumber } from "naive-ui";
export default defineComponent({
  inheritAttrs: false,
  render() {
    return h(NInputNumber, this.$attrs, {
      ...this.$slots,
      "minus-icon": () =>
        h("span", { role: "img", "aria-label": this.$t("decrease") }, "−"),
      "add-icon": () =>
        h("span", { role: "img", "aria-label": this.$t("increase") }, "+"),
    });
  },
});
</script>
