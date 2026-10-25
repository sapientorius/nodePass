<script lang="ts">
import { defineComponent, h } from "vue";
import { NCard } from "naive-ui";
export default defineComponent({
  inheritAttrs: false,
  props: { title: { type: String, required: true } },
  render() {
    return h(NCard, this.$attrs, {
      default: () => [
        h("h2", { class: "panel-title" }, this.title),
        this.$slots.default?.(),
      ],
    });
  },
});
</script>
