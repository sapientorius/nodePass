<script lang="ts">
import { defineComponent } from "vue";
import { NAlert, NCollapse, NCollapseItem, NSpin } from "naive-ui";
import type { ReleaseHistory } from "@nodepass/contracts";
import { version } from "@nodepass/contracts";
import { useSession } from "../stores/session";
import { api, ApiError } from "../api";
import NCard from "../components/PanelCard.vue";
import ReleaseNotes from "../components/ReleaseNotes";
export default defineComponent({
  components: {
    NCard,
    NAlert,
    NCollapse,
    NCollapseItem,
    NSpin,
    ReleaseNotes,
  },
  data: () => ({
    version,
    history: null as ReleaseHistory | null,
    loading: false,
    failed: false,
    denied: false,
    expanded: [] as string[],
    revision: 0,
    timer: undefined as ReturnType<typeof setInterval> | undefined,
  }),
  computed: {
    session: () => useSession(),
    allowed(): boolean {
      return (
        this.session.viewer?.phase === "ready" &&
        this.session.viewer.isAppAdmin &&
        !this.denied
      );
    },
  },
  watch: {
    "session.viewer": {
      immediate: true,
      handler() {
        this.revision++;
        this.history = null;
        this.expanded = [];
        this.failed = false;
        this.denied = false;
        void this.load();
      },
    },
  },
  mounted() {
    this.timer = setInterval(() => void this.load(), 60000);
  },
  beforeUnmount() {
    this.revision++;
    clearInterval(this.timer);
    this.history = null;
  },
  methods: {
    toggle(version: string) {
      this.expanded = this.expanded.includes(version)
        ? this.expanded.filter((v) => v !== version)
        : [...this.expanded, version];
    },
    date(time: number | null): string {
      return time === null
        ? this.$t("releaseUnknown")
        : new Date(time).toLocaleString(this.$i18n.locale.replace("_", "-"));
    },
    async load() {
      if (!this.allowed) return;
      const revision = ++this.revision,
        user = this.session.viewer!.id;
      this.loading = true;
      try {
        const history = await api<ReleaseHistory>("updates/releases");
        if (
          revision !== this.revision ||
          !this.allowed ||
          this.session.viewer?.id !== user
        )
          return;
        const newest = history.releases[0]?.version;
        if (
          !this.history ||
          (!this.history.releases.length && history.releases.length > 0) ||
          this.history.latestVersion !== history.latestVersion
        )
          this.expanded = newest ? [newest] : [];
        else
          this.expanded = this.expanded.filter((v) =>
            history.releases.some((r) => r.version === v),
          );
        // Keep reactive entry identities stable for NaiveUI's lazily rendered slots.
        // This also preserves keyboard focus during polling updates.
        const previous = new Map(
          this.history?.releases.map((release) => [release.version, release]),
        );
        history.releases = history.releases.map((release) => {
          const existing = previous.get(release.version);
          if (!existing) return release;
          existing.publishedAt = release.publishedAt;
          existing.url = release.url;
          existing.notes = release.notes;
          existing.notesStatus = release.notesStatus;
          existing.verifiedAt = release.verifiedAt;
          return existing;
        });
        this.history = history;
        this.failed = false;
      } catch (error) {
        if (revision === this.revision) {
          if (error instanceof ApiError && error.status === 403) {
            this.history = null;
            this.expanded = [];
            this.denied = true;
          } else this.failed = true;
        }
      } finally {
        if (revision === this.revision) this.loading = false;
      }
    },
  },
});
</script>
<template>
  <n-alert v-if="!allowed" type="error">{{ $t("releaseDenied") }}</n-alert>
  <section
    v-else
    class="release-overview"
    :aria-busy="loading"
    :aria-label="$t('updatesDetails')"
  >
    <div class="release-version-grid">
      <n-card :title="$t('releaseInstalledVersion')"
        ><p class="release-version">
          v{{ history?.installedVersion || session.version || version }}
        </p></n-card
      >
      <n-card :title="$t('releaseLatestVersion')"
        ><p class="release-version">
          {{
            history?.latestVersion
              ? "v" + history.latestVersion
              : $t("releaseUnknown")
          }}
        </p></n-card
      >
    </div>
    <n-spin v-if="loading && !history" size="small" />
    <n-alert v-if="failed" type="warning">{{ $t("releaseLoadError") }}</n-alert>
    <template v-if="history">
      <div class="release-check-summary">
        <span
          >{{ $t("releaseChannel") }}:
          {{ history.channel === "rc" ? "RC" : "Stable" }}</span
        >
        <span>{{
          $t("updatesChecked", {
            time:
              history.lastSuccessAt === null
                ? $t("updatesNeverChecked")
                : date(history.lastSuccessAt),
          })
        }}</span>
      </div>
      <n-alert v-if="history.error || history.stale" type="warning">{{
        $t("updatesCheckFailed")
      }}</n-alert>
      <n-alert v-if="!history.complete" type="info">{{
        $t("releaseHistoryIncomplete")
      }}</n-alert>
      <n-alert v-if="history.installedPublished === false" type="info">{{
        $t("releaseUnpublished")
      }}</n-alert>
      <p class="muted">{{ $t("releaseOriginal") }}</p>
      <n-collapse v-model:expanded-names="expanded" display-directive="if">
        <n-collapse-item
          v-for="release in history.releases"
          :key="release.version"
          :name="release.version"
        >
          <template #header>
            <button
              type="button"
              class="release-heading release-toggle"
              :aria-expanded="expanded.includes(release.version)"
              :aria-controls="
                expanded.includes(release.version)
                  ? 'release-' + release.version
                  : undefined
              "
              @click.stop="toggle(release.version)"
            >
              <strong>v{{ release.version }}</strong>
              <span
                v-if="release.version === history.installedVersion"
                class="release-badge"
                >{{ $t("releaseInstalled") }}</span
              >
              <span
                v-if="release.version === history.latestVersion"
                class="release-badge"
                >{{ $t("releaseLatest") }}</span
              >
              <span v-if="release.version.includes('-')" class="release-badge"
                >RC</span
              >
            </button>
          </template>
          <div class="release-entry" :id="'release-' + release.version">
            <time
              v-if="release.publishedAt !== null"
              :datetime="new Date(release.publishedAt).toISOString()"
              >{{ date(release.publishedAt) }}</time
            >
            <n-alert
              v-if="release.notesStatus !== 'verified'"
              :type="release.notesStatus === 'pending' ? 'info' : 'warning'"
              >{{
                $t(
                  release.notesStatus === "pending"
                    ? "releasePending"
                    : release.notesStatus === "mismatch"
                      ? "releaseMismatch"
                      : "releaseUnavailable",
                )
              }}</n-alert
            >
            <p
              v-if="
                release.notes !== null && release.notesStatus !== 'verified'
              "
              class="muted"
            >
              {{ $t("releaseCached", { time: date(release.verifiedAt) }) }}
            </p>
            <ReleaseNotes
              v-if="release.notes !== null"
              :text="release.notes"
              :base-url="release.url"
            />
            <a :href="release.url" target="_blank" rel="noopener noreferrer">{{
              $t("updatesRelease")
            }}</a>
          </div>
        </n-collapse-item>
      </n-collapse>
      <p v-if="!history.releases.length" class="muted">
        {{ $t("releaseEmpty") }}
      </p>
    </template>
  </section>
</template>
