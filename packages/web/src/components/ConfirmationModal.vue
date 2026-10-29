<script lang="ts">
import { defineComponent } from "vue";
import AccessibleModal from "./AccessibleModal.vue";
import ConfirmationForm from "./ConfirmationForm.vue";
import {
  confirmation,
  cancelConfirmation,
  finishConfirmation,
} from "../confirmation";

export default defineComponent({
  components: { AccessibleModal, ConfirmationForm },
  data: () => ({ confirmation }),
  beforeUnmount() {
    cancelConfirmation();
  },
  methods: { cancelConfirmation, finishConfirmation },
});
</script>
<template>
  <AccessibleModal
    :show="confirmation.open"
    :title="$t('confirmIdentity')"
    class="confirmation-modal"
    style="width: min(480px, calc(100vw - 28px))"
    :mask-closable="false"
    @update:show="!$event && cancelConfirmation()"
  >
    <p class="muted">{{ $t("confirmResumeHelp") }}</p>
    <ConfirmationForm
      v-if="confirmation.open"
      :key="confirmation.revision"
      cancellable
      @confirmed="finishConfirmation(confirmation.revision)"
      @cancel="cancelConfirmation"
    />
  </AccessibleModal>
</template>
