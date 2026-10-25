<script lang="ts">
import { defineComponent, h } from "vue";
import { NModal } from "naive-ui";
export default defineComponent({
  inheritAttrs: false,
  props: { title: { type: String, required: true } },
  render() {
    return h(
      NModal,
      {
        ...this.$attrs,
        role: "dialog",
        "aria-label": this.title,
        preset: "card",
        title: undefined,
        closable: false,
      },
      {
        default: () => [
          h("h2", { class: "panel-title" }, this.title),
          this.$slots.default?.(),
        ],
      },
    );
  },
});
</script>
