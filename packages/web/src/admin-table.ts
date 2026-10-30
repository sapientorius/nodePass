import type { GroupReference } from "@nodepass/contracts";

export interface AdminTableRow {
  id: number;
  primaryGroup?: GroupReference | null;
  additionalGroups?: GroupReference[];
  [key: string]: unknown;
}
const collator = (locale: string) =>
  new Intl.Collator(locale.replace("_", "-"), {
    numeric: true,
    sensitivity: "base",
  });
export function orderedGroups(
  groups: GroupReference[] = [],
  locale: string,
): GroupReference[] {
  const compare = collator(locale).compare;
  return [...groups].sort((a, b) => compare(a.name, b.name) || a.id - b.id);
}
export function sortedAdminRows<T extends AdminTableRow>(
  rows: T[],
  field: string,
  direction: "asc" | "desc",
  locale: string,
): T[] {
  const compare = collator(locale).compare;
  const value = (row: T): string[] =>
    field === "additionalGroups"
      ? orderedGroups(row.additionalGroups, locale).map((group) => group.name)
      : [
          String(
            field === "primaryGroup"
              ? (row.primaryGroup?.name ?? "")
              : (row[field] ?? ""),
          ),
        ];
  const values = new Map(rows.map((row) => [row, value(row)]));
  return [...rows].sort((a, b) => {
    let order = 0;
    if (field === "isDisabled")
      order = Number(!!a.isDisabled) - Number(!!b.isDisabled);
    else {
      const left = values.get(a)!,
        right = values.get(b)!;
      for (
        let index = 0;
        index < Math.min(left.length, right.length) && !order;
        index++
      )
        order = compare(left[index]!, right[index]!);
      order ||= left.length - right.length;
    }
    return order * (direction === "asc" ? 1 : -1) || a.id - b.id;
  });
}
