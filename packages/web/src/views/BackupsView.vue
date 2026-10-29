<script lang="ts">
import { defineComponent } from "vue";
import {
  NAlert,
  NButton,
  NCard,
  NForm,
  NFormItem,
  NInput,
  NList,
  NListItem,
  NPagination,
  NPopconfirm,
  NSelect,
  NSwitch,
} from "naive-ui";
import type {
  BackupJob,
  BackupSchedule,
  BackupSummary,
  Page,
  RestoreTicket,
  Language,
} from "@nodepass/contracts";
import NInputNumber from "../components/NumberField.vue";
import NModal from "../components/AccessibleModal.vue";
import ConfirmationForm from "../components/ConfirmationForm.vue";
import PanelCard from "../components/PanelCard.vue";
import { api, ApiError, download } from "../api";
import { ActionCancelled } from "../confirmation";
import { useSession } from "../stores/session";
import {
  backupProgress,
  backupStepKey,
  forgetRestore,
  pollRestore,
  rememberRestore,
} from "../backup-progress";

function browserTimezone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
}
function timezoneOptions() {
  const zones = new Set([
    "UTC",
    browserTimezone(),
    ...Intl.supportedValuesOf("timeZone"),
  ]);
  return [...zones].sort().map((zone) => ({ label: zone, value: zone }));
}
function readChunk(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("Read failed"));
    reader.onload = () => resolve(String(reader.result).split(",")[1]!);
    reader.readAsDataURL(blob);
  });
}
export default defineComponent({
  components: {
    NAlert,
    NButton,
    NCard,
    NForm,
    NFormItem,
    NInput,
    NList,
    NListItem,
    NPagination,
    NPopconfirm,
    NSelect,
    NSwitch,
    NInputNumber,
    NModal,
    ConfirmationForm,
    PanelCard,
  },
  data: () => ({
    rows: [] as BackupSummary[],
    total: 0,
    page: 1,
    busy: false,
    error: "",
    loading: false,
    schedule: null as BackupSchedule | null,
    timezoneOptions: timezoneOptions(),
    job: null as BackupJob | null,
    restore: null as RestoreTicket | null,
    key: "",
    confirmation: "",
    showConfirm: false,
    revision: 0,
    timer: undefined as ReturnType<typeof setInterval> | undefined,
    polling: false,
    ticks: 0,
  }),
  computed: {
    admin(): boolean {
      return !!useSession().viewer?.isAppAdmin;
    },
    status() {
      return backupProgress.status?.id === this.restore?.id
        ? backupProgress.status
        : this.restore;
    },
    restoreActive(): boolean {
      return (
        !!this.status && !["complete", "failed"].includes(this.status.state)
      );
    },
  },
  mounted() {
    void this.load();
    this.timer = setInterval(() => void this.poll(), 2000);
  },
  beforeUnmount() {
    this.revision++;
    clearInterval(this.timer);
    this.key = "";
    this.confirmation = "";
    this.showConfirm = false;
  },
  methods: {
    backupStepKey,
    chooseUpload() {
      (this.$refs.uploadInput as HTMLInputElement | undefined)?.click();
    },
    date(at: number | null | undefined, timezone?: string): string {
      return at === null || at === undefined
        ? this.$t("backupNever")
        : new Date(at).toLocaleString(this.$i18n.locale.replace("_", "-"), {
            timeZone: timezone,
          });
    },
    size(bytes: number): string {
      const unit =
        bytes < 1024
          ? 0
          : Math.min(3, Math.floor(Math.log(bytes) / Math.log(1024)));
      return `${new Intl.NumberFormat(this.$i18n.locale.replace("_", "-"), { maximumFractionDigits: 1 }).format(bytes / 1024 ** unit)} ${["B", "KiB", "MiB", "GiB"][unit]}`;
    },
    origin(value: string): string {
      return this.$t(
        (
          {
            manual: "backupManual",
            automatic: "backupAutomatic",
            safety: "backupSafety",
            existing: "backupExisting",
          } as Record<string, string>
        )[value] ?? "backupExisting",
      );
    },
    fail(error: unknown) {
      if (!(error instanceof ActionCancelled))
        this.error = this.$t(
          error instanceof ApiError && error.status === 409
            ? "backupBusy"
            : "backupFailed",
        );
    },
    async refreshList() {
      const revision = this.revision;
      const result = await api<Page<BackupSummary>>(
        `backups?limit=25&skip=${(this.page - 1) * 25}`,
      );
      if (revision !== this.revision) return;
      this.rows = result.data;
      this.total = result.total;
      if (this.page > 1 && !this.rows.length) {
        this.page--;
        await this.refreshList();
      }
    },
    async load() {
      if (this.loading) return;
      this.loading = true;
      this.error = "";
      const revision = this.revision;
      try {
        const [, job, schedule, restore] = await Promise.all([
          this.refreshList(),
          api<BackupJob | null>("backup-jobs/latest"),
          this.admin ? api<BackupSchedule>("backup-schedule") : null,
          this.admin ? api<RestoreTicket | null>("backup-restores") : null,
        ]);
        if (revision !== this.revision) return;
        this.job = job;
        this.schedule = schedule;
        if (this.schedule && !this.schedule.configured)
          this.schedule.timezone = browserTimezone();
        if (restore) {
          this.restore = restore;
          rememberRestore(restore, this.$i18n.locale as Language);
        }
      } catch (error) {
        if (revision === this.revision) this.fail(error);
      } finally {
        if (revision === this.revision) this.loading = false;
      }
    },
    async run(work: () => Promise<void>) {
      if (this.busy) return;
      this.busy = true;
      this.error = "";
      const revision = this.revision;
      try {
        await work();
      } catch (error) {
        if (revision === this.revision) this.fail(error);
      } finally {
        if (revision === this.revision) this.busy = false;
      }
    },
    async poll() {
      if (this.polling || this.busy || this.loading) return;
      this.polling = true;
      const revision = this.revision;
      try {
        if (this.job?.state === "running") {
          const job = await api<BackupJob>(`backup-jobs/${this.job.id}`);
          if (revision !== this.revision) return;
          this.job = job;
          if (job.state !== "running") await this.refreshList();
        }
        if (this.restoreActive) await pollRestore();
        if (++this.ticks % 8 === 0) {
          await this.refreshList();
          if (this.admin && this.schedule) {
            const latest = await api<BackupSchedule>("backup-schedule");
            if (revision === this.revision && this.schedule) {
              this.schedule.nextAt = latest.nextAt;
              this.schedule.lastAttemptAt = latest.lastAttemptAt;
              this.schedule.lastSuccessAt = latest.lastSuccessAt;
              this.schedule.error = latest.error;
            }
          }
        }
      } catch (error) {
        if (revision === this.revision) this.fail(error);
      } finally {
        this.polling = false;
      }
    },
    create() {
      return this.run(async () => {
        const revision = this.revision;
        const job = await api<BackupJob>("backup-jobs", "POST", {});
        if (revision === this.revision) this.job = job;
      });
    },
    remove(name: string) {
      return this.run(async () => {
        await api(`backups/${name}`, "DELETE");
        await this.refreshList();
      });
    },
    download(name: string) {
      return this.run(() => download(`backups/${name}`, undefined, "GET"));
    },
    saveSchedule() {
      return this.run(async () => {
        if (!this.schedule) return;
        const { enabled, days, time, timezone, keep } = this.schedule;
        const revision = this.revision;
        const saved = await api<BackupSchedule>("backup-schedule", "PATCH", {
          enabled,
          days,
          time,
          timezone,
          keep,
        });
        if (revision === this.revision) this.schedule = saved;
      });
    },
    restoreFrom(name: string) {
      return this.run(async () => {
        const revision = this.revision;
        const ticket = await api<RestoreTicket>("backup-restores", "POST", {
          name,
        });
        if (revision !== this.revision) return;
        this.restore = ticket;
        this.key = "";
        this.confirmation = "";
        rememberRestore(ticket, this.$i18n.locale as Language);
      });
    },
    upload(event: Event) {
      const input = event.target as HTMLInputElement,
        file = input.files?.[0];
      input.value = "";
      if (!file) return;
      return this.run(async () => {
        if (file.size < 32 || file.size > 4 * 1024 ** 3) {
          this.error = this.$t("backupVerification");
          return;
        }
        const revision = this.revision;
        const ticket = await api<RestoreTicket>("backup-restores", "POST", {});
        if (revision !== this.revision) return;
        this.restore = ticket;
        this.key = "";
        this.confirmation = "";
        rememberRestore(ticket, this.$i18n.locale as Language);
        for (let offset = 0; offset < file.size; offset += 8 * 1024 ** 2) {
          const end = Math.min(offset + 8 * 1024 ** 2, file.size);
          const content = await readChunk(file.slice(offset, end));
          if (revision !== this.revision) return;
          await api(`backup-restores/${ticket.id}/upload`, "PUT", {
            offset,
            content,
            final: end === file.size,
          });
          if (revision !== this.revision) return;
          this.restore = { ...ticket, offset: end };
          if (backupProgress.status?.id === ticket.id)
            backupProgress.status = { ...backupProgress.status, offset: end };
        }
        await pollRestore();
      });
    },
    check() {
      return this.run(async () => {
        if (!this.restore) return;
        const key = this.key;
        this.key = "";
        await api(`backup-restores/${this.restore.id}/check`, "POST", { key });
        await pollRestore();
      });
    },
    cancel() {
      return this.run(async () => {
        if (!this.restore) return;
        await api(`backup-restores/${this.restore.id}`, "DELETE");
        this.restore = null;
        this.key = "";
        this.confirmation = "";
        this.showConfirm = false;
        forgetRestore();
      });
    },
    async confirmed(authorization: string) {
      this.showConfirm = false;
      await this.run(async () => {
        if (!this.restore) return;
        await api(`backup-restores/${this.restore.id}/commit`, "POST", {
          confirmation: this.confirmation,
          authorization,
        });
        this.confirmation = "";
        await pollRestore();
      });
    },
  },
});
</script>
<template>
  <div class="backup-settings" :aria-busy="busy || loading">
    <n-alert v-if="error" type="error" role="alert">{{ error }}</n-alert>
    <n-card>
      <p class="muted">{{ $t("backupHelp") }}</p>
      <div class="backup-actions">
        <n-button
          type="primary"
          :disabled="restoreActive || job?.state === 'running'"
          :loading="busy"
          @click="create"
          >{{ $t("backupCreate") }}</n-button
        >
        <n-button :disabled="busy" @click="load">{{
          $t("backupRefresh")
        }}</n-button>
        <template v-if="admin">
          <n-button :disabled="busy || restoreActive" @click="chooseUpload"
            >{{ $t("upload") }} · .npb</n-button
          >
          <input
            ref="uploadInput"
            hidden
            type="file"
            accept=".npb"
            :disabled="busy || restoreActive"
            @change="upload"
          />
        </template>
      </div>
      <n-alert
        v-if="job"
        :type="job.state === 'failed' ? 'error' : 'info'"
        class="backup-notice"
        role="status"
        >{{ $t(backupStepKey(job.step)) }}</n-alert
      >
      <n-list>
        <n-list-item v-for="item in rows" :key="item.name">
          <div class="backup-row">
            <div class="backup-details">
              <strong>{{ date(item.createdAt) }}</strong
              ><span>{{ origin(item.origin) }} · {{ size(item.size) }}</span
              ><code>{{ item.name }}</code>
            </div>
            <div class="backup-actions">
              <n-button :disabled="busy" @click="download(item.name)">{{
                $t("download")
              }}</n-button>
              <n-button
                v-if="admin"
                :disabled="busy || item.inUse || restoreActive"
                @click="restoreFrom(item.name)"
                >{{ $t("backupRestore") }}</n-button
              >
              <n-popconfirm v-if="admin" @positive-click="remove(item.name)"
                ><template #trigger
                  ><n-button
                    type="error"
                    secondary
                    :disabled="busy || item.inUse"
                    >{{ $t("delete") }}</n-button
                  ></template
                >{{ $t("backupDeleteConfirm") }}</n-popconfirm
              >
            </div>
          </div>
        </n-list-item>
      </n-list>
      <p v-if="!rows.length && !loading" class="muted">{{ $t("empty") }}</p>
      <n-pagination
        v-if="total > 25"
        :page="page"
        :page-size="25"
        :item-count="total"
        :simple="true"
        @update:page="
          page = $event;
          refreshList().catch(fail);
        "
      />
    </n-card>
    <PanelCard v-if="admin && schedule" :title="$t('backupSchedule')">
      <n-form @submit.prevent="saveSchedule">
        <n-form-item :label="$t('backupEnabled')"
          ><n-switch
            v-model:value="schedule.enabled"
            :aria-label="$t('backupEnabled')"
            :disabled="busy || restoreActive"
        /></n-form-item>
        <div class="backup-form-grid">
          <n-form-item :label="$t('backupDays')"
            ><n-input-number
              v-model:value="schedule.days"
              :min="1"
              :max="365"
              :input-props="{ 'aria-label': $t('backupDays') }"
          /></n-form-item>
          <n-form-item :label="$t('backupTime')"
            ><input
              v-model="schedule.time"
              class="backup-time"
              type="time"
              required
              :aria-label="$t('backupTime')"
          /></n-form-item>
          <n-form-item :label="$t('backupTimezone')"
            ><n-select
              v-model:value="schedule.timezone"
              filterable
              :options="timezoneOptions"
              :input-props="{ 'aria-label': $t('backupTimezone') }"
          /></n-form-item>
          <n-form-item :label="$t('backupKeep')"
            ><n-input-number
              v-model:value="schedule.keep"
              :min="1"
              :max="365"
              :input-props="{ 'aria-label': $t('backupKeep') }"
          /></n-form-item>
        </div>
        <n-button
          attr-type="submit"
          type="primary"
          :loading="busy"
          :disabled="
            restoreActive ||
            !schedule.days ||
            !schedule.keep ||
            !schedule.time ||
            !schedule.timezone
          "
          >{{ $t("save") }}</n-button
        >
      </n-form>
      <dl class="backup-schedule-status">
        <dt>{{ $t("backupNext") }}</dt>
        <dd>
          {{ date(schedule.nextAt, schedule.timezone) }} ·
          {{ schedule.timezone }}
        </dd>
        <dt>{{ $t("backupAttempt") }}</dt>
        <dd>{{ date(schedule.lastAttemptAt, schedule.timezone) }}</dd>
        <dt>{{ $t("backupSuccess") }}</dt>
        <dd>{{ date(schedule.lastSuccessAt, schedule.timezone) }}</dd>
      </dl>
      <n-alert v-if="schedule.error" type="error">{{
        $t("backupFailed")
      }}</n-alert>
    </PanelCard>
    <PanelCard v-if="admin && restoreActive" :title="$t('backupRestore')">
      <n-alert type="warning">{{ $t("backupRestoreHelp") }}</n-alert>
      <p role="status">
        {{ $t(backupStepKey(status!.step)) }} · {{ size(status!.offset) }}
      </p>
      <n-alert v-if="status?.error" type="error" role="alert">{{
        $t(
          status.error === "verification"
            ? "backupVerification"
            : "backupFailed",
        )
      }}</n-alert>
      <n-form
        v-if="status?.state === 'upload' && status.uploadComplete"
        @submit.prevent="check"
      >
        <n-form-item :label="$t('backupKey')"
          ><n-input
            v-model:value="key"
            type="password"
            autocomplete="off"
            :maxlength="100"
            :input-props="{ 'aria-label': $t('backupKey'), spellcheck: false }"
        /></n-form-item>
        <n-button attr-type="submit" type="primary" :disabled="!key || busy">{{
          $t("backupCheck")
        }}</n-button>
      </n-form>
      <n-form
        v-if="status?.state === 'ready'"
        @submit.prevent="showConfirm = true"
      >
        <p>{{ $t("backupCreated") }}: {{ date(status.createdAt) }}</p>
        <p>
          {{ $t("accounts") }}: {{ status.counts?.Account ?? 0 }} ·
          {{ $t("users") }}: {{ status.counts?.User ?? 0 }}
        </p>
        <p>{{ $t("backupConfirmHelp") }}</p>
        <code class="backup-confirmation">{{ status.confirmation }}</code>
        <n-form-item :label="$t('confirm')"
          ><n-input
            v-model:value="confirmation"
            autocomplete="off"
            :input-props="{ 'aria-label': $t('confirm'), spellcheck: false }"
        /></n-form-item>
        <n-button
          attr-type="submit"
          type="error"
          :disabled="confirmation !== status.confirmation || busy"
          >{{ $t("backupReplace") }}</n-button
        >
      </n-form>
      <n-button
        v-if="status && ['upload', 'ready'].includes(status.state)"
        class="backup-notice"
        :disabled="busy"
        @click="cancel"
        >{{ $t("cancel") }}</n-button
      >
    </PanelCard>
    <n-modal
      v-model:show="showConfirm"
      preset="card"
      class="account-modal"
      :title="$t('confirm')"
      ><ConfirmationForm
        v-if="showConfirm && restore"
        :key="restore.id"
        :endpoint="`backup-restores/${restore.id}/confirm`"
        cancellable
        @confirmed="confirmed"
        @cancel="showConfirm = false"
    /></n-modal>
  </div>
</template>
<style scoped>
.backup-settings {
  display: grid;
  gap: 20px;
}
.backup-row,
.backup-actions {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
}
.backup-row {
  justify-content: space-between;
  width: 100%;
}
.backup-details {
  display: grid;
  gap: 6px;
  min-width: 0;
}
.backup-details code,
.backup-confirmation {
  overflow-wrap: anywhere;
  white-space: normal;
}
.backup-confirmation {
  display: block;
  margin-bottom: 16px;
}
.backup-actions :deep(.n-button) {
  max-width: 100%;
  height: auto;
  min-height: 36px;
}
.backup-actions :deep(.n-button__content) {
  white-space: normal;
}
.backup-form-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 0 20px;
}
.backup-time {
  box-sizing: border-box;
  width: 100%;
  min-height: 36px;
  padding: 6px 10px;
  background: var(--surface);
  color: var(--text);
  border: 1px solid var(--border);
  border-radius: 6px;
  font: inherit;
}
.backup-schedule-status {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr);
  gap: 8px 20px;
}
.backup-schedule-status dd {
  margin: 0;
  overflow-wrap: anywhere;
}
.backup-notice {
  margin-top: 16px;
}
@media (max-width: 600px) {
  .backup-form-grid,
  .backup-schedule-status {
    grid-template-columns: minmax(0, 1fr);
  }
  .backup-schedule-status dd {
    margin-bottom: 8px;
  }
}
</style>
