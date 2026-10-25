import type { HTMLAttributes } from "vue";

// NaiveUI's visual tabs do not provide native keyboard activation.
export function tabProps(label: string, selected: boolean): HTMLAttributes {
  return {
    role: "button",
    "aria-label": label,
    tabindex: 0,
    "aria-pressed": selected,
    onKeydown(event: KeyboardEvent) {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        (event.currentTarget as HTMLElement).click();
      }
    },
  };
}
