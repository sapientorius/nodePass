<script lang="ts">
import { defineComponent } from "vue";
import { NProgress } from "naive-ui";
import { defaultPolicy } from "@nodepass/contracts";
import { assessPassword } from "../password-policy";
export default defineComponent({
  components: { NProgress },
  props: {
    value: { type: String, default: "" },
    minLength: { type: Number, default: defaultPolicy.minLength },
    minScore: { type: Number, default: defaultPolicy.minScore },
  },
  computed: {
    assessment() {
      return assessPassword(this.value, this);
    },
  },
});
</script>
<template>
  <div v-if="value" class="password-strength" aria-live="polite">
    <n-progress
      type="line"
      :aria-label="$t('minScore')"
      :percentage="assessment.score * 25"
      :show-indicator="false"
      :status="assessment.valid ? 'success' : 'warning'"
    /><small
      >{{ $t("minLength") }}: {{ assessment.length }} / {{ minLength }} ·
      {{ $t("minScore") }}: {{ assessment.score }} / {{ minScore }}</small
    >
  </div>
</template>
