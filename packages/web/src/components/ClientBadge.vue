<script lang="ts">
import { defineComponent } from "vue";
import { NTag } from "naive-ui";

export default defineComponent({
  components: { NTag },
  props: {
    name: { type: String, default: "" },
    clientId: { type: Number, required: true },
  },
  computed: {
    label(): string {
      return this.name.trim() || `${this.$t("client")} #${this.clientId}`;
    },
    initial(): string {
      return Array.from(this.name.trim())[0]?.toUpperCase() || "?";
    },
    hue(): string {
      return String((this.clientId * 137) % 360);
    },
  },
});
</script>
<template>
  <n-tag
    class="client-badge"
    round
    size="large"
    role="group"
    :aria-label="$t('client')"
    :title="label"
    :color="{
      color: 'var(--bg)',
      textColor: 'var(--text)',
      borderColor: 'var(--border)',
    }"
    :theme-overrides="{ heightLarge: '36px', fontSizeLarge: '12px' }"
    :style="{ '--client-hue': hue }"
  >
    <template #avatar>
      <span class="client-initial" aria-hidden="true">{{ initial }}</span>
    </template>
    {{ label }}
  </n-tag>
</template>
<style scoped>
.client-badge {
  min-width: 0;
  max-width: 100%;
}
.client-badge :deep(.n-tag__avatar) {
  flex-shrink: 0;
}
.client-badge :deep(.n-tag__content) {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
}
.client-initial {
  display: grid;
  place-items: center;
  width: 26px;
  height: 26px;
  border-radius: 50%;
  background: hsl(var(--client-hue) 35% 91%);
  color: hsl(var(--client-hue) 45% 30%);
  font-size: 12px;
  font-weight: 700;
  line-height: 1;
}
.is-dark .client-initial {
  background: hsl(var(--client-hue) 25% 27%);
  color: hsl(var(--client-hue) 50% 80%);
}
</style>
