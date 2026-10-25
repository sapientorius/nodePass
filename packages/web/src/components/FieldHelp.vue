<script lang="ts">
import { defineComponent } from "vue";
import { NButton, NPopover } from "naive-ui";
import Icon from "./Icon.vue";

export default defineComponent({
  components: { NButton, NPopover, Icon },
  props: {
    label: { type: String, required: true },
    text: { type: String, required: true },
    id: { type: String, required: true },
  },
  data: () => ({ show: false }),
  methods: {
    onKeydown(event: KeyboardEvent) {
      if (event.key === "Escape" && this.show) {
        event.stopPropagation();
        event.preventDefault();
        this.show = false;
      }
    },
  },
});
</script>
<template>
  <n-popover
    v-model:show="show"
    trigger="click"
    placement="top"
    to="body"
    :style="{ maxWidth: 'min(300px, calc(100vw - 48px))' }"
  >
    <template #trigger>
      <n-button
        class="field-help-trigger"
        quaternary
        circle
        size="tiny"
        attr-type="button"
        :aria-label="label"
        :aria-expanded="show"
        :aria-describedby="show ? id : undefined"
        @keydown="onKeydown"
      >
        <Icon name="info" :size="16" />
      </n-button>
    </template>
    <span :id="id">{{ text }}</span>
  </n-popover>
</template>
<style scoped>
.field-help-trigger {
  margin-left: 6px;
  vertical-align: middle;
}
</style>
