<script lang="ts">
import { defineComponent, type PropType } from "vue";
import { NAlert, NButton } from "naive-ui";
import type { UpdateStatus } from "@nodepass/contracts";
export default defineComponent({
  components: { NAlert, NButton },
  props: {
    status: { type: Object as PropType<UpdateStatus>, required: true },
    panel: Boolean,
    busy: Boolean,
  },
  emits: ["acknowledge"],
  computed: {
    checkedAt(): string {
      return this.status.lastSuccessAt === null
        ? this.$t("updatesNeverChecked")
        : new Date(this.status.lastSuccessAt).toLocaleString(
            this.$i18n.locale.replace("_", "-"),
          );
    },
  },
});
</script>
<template>
  <section
    class="update-notice"
    :class="{ 'update-panel': panel }"
    :aria-label="$t('updatesTitle')"
  >
    <n-alert
      v-if="status.available && (panel || !status.available.acknowledged)"
      :type="status.available.critical ? 'error' : 'info'"
      :title="
        $t(status.available.critical ? 'updatesCritical' : 'updatesAvailable')
      "
    >
      <p>
        {{
          $t("updatesVersions", {
            installed: status.installedVersion,
            available: status.available.version,
          })
        }}
      </p>
      <div class="update-actions">
        <router-link v-if="!panel" to="/manage/updates">{{
          $t("updatesDetails")
        }}</router-link>
        <a
          :href="status.available.url"
          target="_blank"
          rel="noopener noreferrer"
          >{{ $t("updatesRelease") }}</a
        >
        <n-button
          v-if="!status.available.acknowledged"
          size="small"
          :loading="busy"
          @click="$emit('acknowledge', status.available.id)"
          >{{ $t("updatesAcknowledge") }}</n-button
        >
      </div>
    </n-alert>
    <n-alert v-if="status.error || status.stale" type="warning">{{
      $t("updatesCheckFailed")
    }}</n-alert>
    <template v-if="panel">
      <router-link to="/manage/updates">{{ $t("updatesDetails") }}</router-link>
      <p v-if="!status.available && !status.error && !status.stale">
        {{ $t("updatesCurrent") }}
      </p>
      <p class="muted">{{ $t("updatesChecked", { time: checkedAt }) }}</p>
      <p
        v-if="status.mail.enabled && status.mail.missingAddresses"
        class="update-delivery-warning"
      >
        {{ $t("updatesMailMissing", { count: status.mail.missingAddresses }) }}
      </p>
      <p v-if="status.mail.failed" class="update-delivery-warning">
        {{ $t("updatesMailFailed", { count: status.mail.failed }) }}
      </p>
      <p
        v-else-if="
          status.available && status.mail.enabled && status.mail.pending
        "
        class="muted"
      >
        {{ $t("updatesMailPending", { count: status.mail.pending }) }}
      </p>
      <p v-if="status.available && !status.mail.enabled" class="muted">
        {{ $t("updatesMailDisabled") }}
      </p>
    </template>
  </section>
</template>
