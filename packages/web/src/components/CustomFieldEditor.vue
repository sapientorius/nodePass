<script lang="ts">
import { defineComponent, useId } from "vue";
import {
  NForm,
  NFormItem,
  NInput,
  NButton,
  NDatePicker,
  NEmpty,
  NCheckbox,
  useMessage,
} from "naive-ui";
import { api } from "../api";
import { useSession } from "../stores/session";

interface Field {
  id: number;
  name: string;
  help: string;
  required: boolean;
  isEncrypted: boolean;
  hasValue: boolean;
  typeName: string;
  value: string;
}
interface FieldState extends Field {
  editing: boolean;
  draft: string;
  remove: boolean;
  revealed: boolean;
  secret: string;
  pending: "reveal" | "copy" | "save" | null;
  timer: ReturnType<typeof setTimeout> | undefined;
}

export default defineComponent({
  components: {
    NForm,
    NFormItem,
    NInput,
    NButton,
    NDatePicker,
    NEmpty,
    NCheckbox,
  },
  setup() {
    return { message: useMessage(), fieldPrefix: useId() };
  },
  props: {
    endpoint: { type: String, required: true },
    canEdit: { type: Boolean, default: true },
    canSecret: { type: Boolean, default: true },
    canEditSecret: { type: Boolean, default: true },
    hideEmpty: Boolean,
  },
  data: () => ({
    fields: [] as FieldState[],
    loading: false,
    revision: 0,
  }),
  watch: {
    endpoint: { immediate: true, handler: "load" },
    canEdit: "load",
    canSecret: "load",
    canEditSecret: "load",
  },
  beforeUnmount() {
    this.revision++;
    this.clear();
    this.fields = [];
  },
  methods: {
    hide(field: FieldState) {
      clearTimeout(field.timer);
      field.timer = undefined;
      field.secret = "";
      field.revealed = false;
    },
    discard(field: FieldState) {
      this.hide(field);
      field.draft = "";
      field.remove = false;
      field.editing = false;
    },
    clear() {
      for (const field of this.fields) {
        this.discard(field);
        field.pending = null;
      }
    },
    canEditField(field: FieldState): boolean {
      return this.canEdit && (!field.isEncrypted || this.canEditSecret);
    },
    canSave(field: FieldState): boolean {
      if (!field.editing || field.pending || !this.canEditField(field))
        return false;
      if (field.remove) return field.isEncrypted && !field.required;
      if (field.required && !field.draft) return false;
      return field.isEncrypted ? !!field.draft : field.draft !== field.value;
    },
    async run(
      field: FieldState,
      action: NonNullable<FieldState["pending"]>,
      job: (current: () => boolean) => Promise<void>,
    ): Promise<boolean> {
      if (field.pending) return false;
      const revision = this.revision;
      const current = () =>
        revision === this.revision && this.fields.includes(field);
      field.pending = action;
      try {
        await job(current);
        return current();
      } catch (error) {
        if (current()) useSession().fail(error);
        return false;
      } finally {
        if (current()) field.pending = null;
      }
    },
    async load() {
      const revision = ++this.revision;
      this.clear();
      this.fields = [];
      this.loading = true;
      try {
        const fields = await api<Field[]>(this.endpoint);
        if (revision !== this.revision) return;
        this.fields = fields.map((field) => ({
          ...field,
          value: field.isEncrypted ? "" : field.value,
          editing: false,
          draft: "",
          remove: false,
          revealed: false,
          secret: "",
          pending: null,
          timer: undefined,
        }));
      } catch (error) {
        if (revision === this.revision) useSession().fail(error);
      } finally {
        if (revision === this.revision) this.loading = false;
      }
    },
    async reveal(field: FieldState) {
      if (!this.canSecret || !field.hasValue || field.editing || field.pending)
        return;
      if (field.revealed) {
        this.hide(field);
        return;
      }
      await this.run(field, "reveal", async (current) => {
        const result = await api<{ value: string }>(
          `${this.endpoint}/${field.id}/secret`,
          "POST",
          {},
        );
        if (!current()) return;
        field.secret = result.value;
        field.revealed = true;
        field.timer = setTimeout(() => this.hide(field), 15000);
      });
    },
    async copy(field: FieldState) {
      if (
        !field.hasValue ||
        field.editing ||
        (field.isEncrypted && !this.canSecret)
      )
        return;
      await this.run(field, "copy", async (current) => {
        // Copying a secret never puts it into the displayed value or a store.
        const value = field.isEncrypted
          ? (
              await api<{ value: string }>(
                `${this.endpoint}/${field.id}/secret`,
                "POST",
                {},
              )
            ).value
          : field.value;
        if (!current()) return;
        await navigator.clipboard.writeText(value);
        if (current())
          this.message.success(this.$t("clipboardCopied"), { duration: 2000 });
      });
    },
    async focus(field: FieldState, editing: boolean) {
      await this.$nextTick();
      if (!this.fields.includes(field) || field.editing !== editing) return;
      const row = (this.$el as HTMLElement).querySelector(
        `[data-field-id="${field.id}"]`,
      );
      row
        ?.querySelector<HTMLElement>(
          editing ? "input, textarea" : "[data-field-edit]",
        )
        ?.focus();
    },
    async edit(field: FieldState) {
      if (!this.canEditField(field) || field.pending) return;
      this.hide(field);
      field.draft = field.isEncrypted ? "" : field.value;
      field.remove = false;
      field.editing = true;
      await this.focus(field, true);
    },
    async cancel(field: FieldState) {
      if (field.pending) return;
      this.discard(field);
      await this.focus(field, false);
    },
    async save(field: FieldState) {
      if (!this.canSave(field)) return;
      const value = field.remove ? "" : field.draft;
      const saved = await this.run(field, "save", async (current) => {
        await api(`${this.endpoint}/${field.id}`, "PUT", { value });
        if (!current()) return;
        field.value = field.isEncrypted ? "" : value;
        field.hasValue = value.length > 0;
        this.discard(field);
        this.message.success(this.$t("saved"), { duration: 2000 });
      });
      if (saved) await this.focus(field, false);
    },
    label(action: string, field: FieldState): string {
      return `${this.$t(action)} · ${field.name}`;
    },
    labelDateInput(picker: unknown, field: FieldState) {
      // DatePicker does not forward input-props to its native input.
      const input = (
        picker as { $el?: HTMLElement } | null
      )?.$el?.querySelector("input");
      if (!input) return;
      for (const [name, value] of Object.entries(
        this.inputProps(field, true),
      )) {
        if (value === undefined) input.removeAttribute(name);
        else input.setAttribute(name, String(value));
      }
    },
    inputProps(
      field: FieldState,
      editing = false,
    ): import("vue").InputHTMLAttributes {
      const descriptions = [
        ...(field.help ? [`${this.fieldPrefix}-${field.id}-help`] : []),
        ...(editing && field.isEncrypted
          ? [`${this.fieldPrefix}-${field.id}-replacement`]
          : []),
      ];
      return {
        "aria-label": field.name,
        "aria-describedby": descriptions.length
          ? descriptions.join(" ")
          : undefined,
        "aria-required": editing && field.required ? true : undefined,
        ...(editing &&
        !field.isEncrypted &&
        ["email", "url", "telephone", "number"].includes(field.typeName)
          ? field.typeName === "number"
            ? { inputmode: "decimal" }
            : { type: field.typeName === "telephone" ? "tel" : field.typeName }
          : {}),
      };
    },
  },
});
</script>
<template>
  <div
    v-if="!hideEmpty || fields.length"
    :aria-busy="loading"
    class="custom-fields"
  >
    <n-empty v-if="!loading && !fields.length" :description="$t('empty')" />
    <section
      v-for="field in fields"
      :key="field.id"
      class="custom-field-row"
      role="group"
      :aria-label="field.name"
      :aria-busy="!!field.pending"
      :data-field-id="field.id"
    >
      <n-form @submit.prevent="save(field)">
        <n-form-item
          :label="field.name"
          :required="field.editing && field.required"
        >
          <div class="custom-field-content">
            <template v-if="field.editing">
              <n-date-picker
                v-if="field.typeName === 'date' && !field.isEncrypted"
                :ref="(picker) => labelDateInput(picker, field)"
                :formatted-value="field.draft || null"
                value-format="yyyy-MM-dd"
                type="date"
                clearable
                :disabled="!!field.pending"
                @update:formatted-value="field.draft = $event || ''"
              />
              <n-input
                v-else
                v-model:value="field.draft"
                :type="
                  field.isEncrypted
                    ? 'password'
                    : field.typeName === 'textarea'
                      ? 'textarea'
                      : 'text'
                "
                :show-password-on="field.isEncrypted ? 'click' : undefined"
                :input-props="inputProps(field, true)"
                :autocomplete="field.isEncrypted ? 'new-password' : 'off'"
                :disabled="!!field.pending || field.remove"
                :placeholder="
                  field.isEncrypted ? $t('fieldNewValue') : field.help || ''
                "
                :autosize="{ minRows: 2, maxRows: 6 }"
              />
              <p
                v-if="field.isEncrypted"
                :id="`${fieldPrefix}-${field.id}-replacement`"
                class="custom-field-help"
              >
                {{ $t("fieldReplacementHelp") }}
              </p>
              <n-checkbox
                v-if="field.isEncrypted && !field.required"
                :checked="field.remove"
                :disabled="!!field.pending"
                :aria-label="label('fieldClear', field)"
                @update:checked="
                  field.remove = $event;
                  if ($event) field.draft = '';
                "
                >{{ $t("fieldClear")
                }}<span class="custom-field-context">
                  · {{ field.name }}</span
                ></n-checkbox
              >
            </template>
            <n-input
              v-else
              :value="
                field.isEncrypted && field.hasValue
                  ? field.revealed
                    ? field.secret
                    : '••••••••••••••••'
                  : field.value
              "
              :type="field.typeName === 'textarea' ? 'textarea' : 'text'"
              :input-props="inputProps(field)"
              :placeholder="$t('fieldEmpty')"
              :autosize="{ minRows: 2, maxRows: 6 }"
              autocomplete="off"
              readonly
            />
            <p
              v-if="field.help"
              :id="`${fieldPrefix}-${field.id}-help`"
              class="custom-field-help"
            >
              {{ field.help }}
            </p>
            <div class="custom-field-actions">
              <template v-if="field.editing">
                <n-button
                  type="primary"
                  attr-type="submit"
                  :aria-label="label('save', field)"
                  :loading="field.pending === 'save'"
                  :disabled="!canSave(field)"
                  >{{ $t("save") }}</n-button
                >
                <n-button
                  :aria-label="label('cancel', field)"
                  :disabled="!!field.pending"
                  @click="cancel(field)"
                  >{{ $t("cancel") }}</n-button
                >
              </template>
              <template v-else>
                <n-button
                  v-if="field.isEncrypted && field.hasValue && canSecret"
                  :aria-label="
                    label(field.revealed ? 'fieldHide' : 'reveal', field)
                  "
                  :aria-pressed="field.revealed"
                  :loading="field.pending === 'reveal'"
                  :disabled="!!field.pending"
                  @click="reveal(field)"
                  >{{ $t(field.revealed ? "fieldHide" : "reveal") }}</n-button
                >
                <n-button
                  v-if="field.hasValue && (!field.isEncrypted || canSecret)"
                  :aria-label="label('copy', field)"
                  :loading="field.pending === 'copy'"
                  :disabled="!!field.pending"
                  @click="copy(field)"
                  >{{ $t("copy") }}</n-button
                >
                <n-button
                  v-if="canEditField(field)"
                  data-field-edit
                  :aria-label="label('edit', field)"
                  :disabled="!!field.pending"
                  @click="edit(field)"
                  >{{ $t("edit") }}</n-button
                >
              </template>
            </div>
          </div>
        </n-form-item>
      </n-form>
    </section>
  </div>
</template>
<style scoped>
.custom-field-content {
  display: flex;
  flex-direction: column;
  gap: 10px;
  width: 100%;
  min-width: 0;
}
.custom-field-content :deep(.n-date-picker) {
  width: 100%;
}
.custom-field-help {
  margin: 0;
  color: var(--muted);
  font-size: 13px;
  line-height: 1.6;
  overflow-wrap: anywhere;
}
.custom-field-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}
.custom-field-context {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  margin: -1px;
  overflow: hidden;
  clip-path: inset(50%);
  white-space: nowrap;
}
</style>
