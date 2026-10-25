/** IDs from sysPass 3.2.11 ActionsInterface and its pre-3.0 upgrade mapper. */
import { BadRequest } from "@feathersjs/errors";
export const fieldModules: Record<
  number,
  { table: string; catalogue: string; permission: string; aliases: number[] }
> = {
  1: {
    table: "Account",
    catalogue: "accounts",
    permission: "accView",
    aliases: [1, 10],
  },
  101: {
    table: "Category",
    catalogue: "categories",
    permission: "mgmCategories",
    aliases: [101, 61],
  },
  301: {
    table: "Client",
    catalogue: "clients",
    permission: "mgmCustomers",
    aliases: [301, 62],
  },
  701: {
    table: "User",
    catalogue: "users",
    permission: "mgmUsers",
    aliases: [701, 71],
  },
  801: {
    table: "UserGroup",
    catalogue: "groups",
    permission: "mgmGroups",
    aliases: [801, 72],
  },
  901: {
    table: "UserProfile",
    catalogue: "profiles",
    permission: "mgmProfiles",
    aliases: [901],
  },
  1001: {
    table: "AuthToken",
    catalogue: "tokens",
    permission: "mgmApiTokens",
    aliases: [1001],
  },
};
export function fieldModule(id: number) {
  const item = Object.entries(fieldModules).find(([, module]) =>
    module.aliases.includes(id),
  );
  if (!item) throw new BadRequest("Unsupported custom-field module");
  return { id: Number(item[0]), ...item[1] };
}
