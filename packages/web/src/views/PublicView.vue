<script lang="ts">
import { defineComponent } from "vue";
import {
  useMessage,
  NButton,
  NDescriptions,
  NDescriptionsItem,
  NInput,
} from "naive-ui";
import { api } from "../api";
import { useSession } from "../stores/session";
import Icon from "../components/Icon.vue";
import NCard from "../components/PanelCard.vue";
export default defineComponent({
  setup() {
    return { message: useMessage() };
  },
  components: {
    NCard,
    NButton,
    NDescriptions,
    NDescriptionsItem,
    NInput,
    Icon,
  },
  data: () => ({
    value: null as any,
    busy: false,
    copying: false,
    copied: false,
    revision: 0,
  }),
  watch: {
    "$route.params.hash"() {
      this.clear();
    },
  },
  methods: {
    clear() {
      this.revision++;
      this.value = null;
      this.busy = false;
      this.copying = false;
      this.copied = false;
    },
    async reveal() {
      if (this.busy || this.value) return;
      const revision = this.revision;
      this.busy = true;
      try {
        const value = await api(
          `public/${encodeURIComponent(String(this.$route.params.hash))}/reveal`,
          "POST",
          {},
        );
        if (revision === this.revision) this.value = value;
      } catch (e) {
        if (revision === this.revision) useSession().fail(e);
      } finally {
        if (revision === this.revision) this.busy = false;
      }
    },
    async copyPassword() {
      if (!this.value || this.copying) return;
      const revision = this.revision;
      this.copying = true;
      this.copied = false;
      try {
        await navigator.clipboard.writeText(this.value.password);
        this.message.success(this.$t("clipboardCopied"), { duration: 2000 });
        if (revision === this.revision) this.copied = true;
      } catch (error) {
        if (revision === this.revision) useSession().fail(error);
      } finally {
        if (revision === this.revision) this.copying = false;
      }
    },
  },
  beforeUnmount() {
    this.clear();
  },
});
</script>
<template>
  <div class="public-page">
    <img src="/logo.svg" width="55" height="55" alt="nodePass" />
    <h1>nodePass</h1>
    <n-card :title="value?.name || $t('shares')" style="max-width: 540px"
      ><template v-if="value"
        ><n-descriptions :column="1"
          ><n-descriptions-item :label="$t('login')">{{
            value.login
          }}</n-descriptions-item
          ><n-descriptions-item :label="$t('password')"
            ><div class="public-password-row">
              <n-input
                :input-props="{ 'aria-label': $t('password') }"
                value="••••••••••••••••"
                type="password"
                :show-password-toggle="false"
                autocomplete="off"
                readonly
              />
              <n-button
                type="primary"
                secondary
                :loading="copying"
                @click="copyPassword"
              >
                <template #icon><Icon name="copy" :size="18" /></template>
                {{ $t("copyPassword") }}
              </n-button>
            </div>
            <p class="public-copy-status" role="status">
              {{ copied ? $t("passwordCopied") : "" }}
            </p> </n-descriptions-item
          ><n-descriptions-item :label="$t('notes')">{{
            value.notes
          }}</n-descriptions-item></n-descriptions
        ></template
      ><n-button v-else type="primary" block :loading="busy" @click="reveal">{{
        $t("reveal")
      }}</n-button></n-card
    >
  </div>
</template>
<style scoped>
.public-password-row {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}
.public-password-row .n-input {
  flex: 1 1 160px;
  min-width: 0;
}
.public-copy-status {
  color: var(--accent);
  font-size: 12px;
  min-height: 18px;
  margin: 8px 0 0;
}
</style>
