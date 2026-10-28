import type { Viewer } from "@nodepass/contracts";

export const managementNavigation = [
  { key: "users", icon: "users", permission: "mgmUsers" },
  { key: "groups", icon: "users", permission: "mgmGroups" },
  { key: "profiles", icon: "shield", permission: "" },
  { key: "categories", icon: "folder", permission: "mgmCategories" },
  { key: "clients", icon: "folder", permission: "mgmCustomers" },
  { key: "tags", icon: "folder", permission: "mgmTags" },
  { key: "security", icon: "shield", permission: "" },
  { key: "updates", icon: "clock", permission: "" },
  { key: "events", icon: "clock", permission: "evl" },
  { key: "backups", icon: "folder", permission: "configBackup" },
  {
    key: "transfer",
    label: "import",
    icon: "folder",
    permission: "configImport",
  },
  { key: "integrations", icon: "settings", permission: "configGeneral" },
  { key: "tokens", icon: "key", permission: "mgmApiTokens" },
  { key: "presets", icon: "folder", permission: "mgmItemsPreset" },
  { key: "fields", icon: "folder", permission: "mgmCustomFields" },
];

export function canManage(viewer: Viewer | null, section: string): boolean {
  const item = managementNavigation.find((item) => item.key === section);
  return (
    !!item &&
    !!viewer &&
    (viewer.isAppAdmin || !!viewer.permissions[item.permission])
  );
}
