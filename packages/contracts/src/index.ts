import { Type, type Static } from "@feathersjs/typebox";
export { version } from "./version.js";
export * from "./updates.js";

export const languages = [
  "de_DE",
  "en_US",
  "es_ES",
  "ca_ES",
  "hu_HU",
  "fr_FR",
  "pl_PL",
  "ru_RU",
  "nl_NL",
  "pt_BR",
  "it_IT",
  "da",
  "fo",
  "ja_JP",
] as const;
export type Language = (typeof languages)[number];
export type MfaPolicy = "optional" | "admins" | "everyone";
export type ConfirmationMethod = "password" | "totp" | "recovery" | "passkey";
export interface ConfirmationMethods {
  methods: ConfirmationMethod[];
}
export interface SecurityPolicy {
  mfa: MfaPolicy;
  minLength: number;
  minScore: number;
  sessionIdleSeconds: number;
  sessionAbsoluteSeconds: number;
}
export const defaultPolicy: SecurityPolicy = {
  mfa: "admins",
  minLength: 15,
  minScore: 3,
  sessionIdleSeconds: 900,
  sessionAbsoluteSeconds: 28800,
};
export interface Viewer {
  accessRevision: string;
  id: number;
  name: string;
  login: string;
  isAdmin: boolean;
  isAppAdmin: boolean;
  isAccountAdmin: boolean;
  directory: boolean;
  theme?: "light" | "dark";
  view?: "list" | "cards";
  language: Language;
  needsMfa: boolean;
  csrf: string;
  permissions: Record<string, boolean>;
}
export interface UserManagement {
  canEdit: boolean;
  canResetPassword: boolean;
  reason?: "permission" | "self" | "administrator" | "groups" | "profile";
}
export interface Account {
  id: number;
  name: string;
  login: string | null;
  url: string | null;
  notes: string | null;
  categoryId: number;
  clientId: number;
  userGroupId: number;
  userId: number;
  categoryName?: string;
  clientName?: string;
  groupName?: string;
  favorite?: boolean;
  tags?: string[];
  listFields?: { id: number; name: string; value: string }[];
  version: number;
  permissions: Record<string, boolean>;
  passDateChange?: number | null;
}
export interface Page<T> {
  total: number;
  limit: number;
  skip: number;
  data: T[];
}
export const accountInput = Type.Object(
  {
    name: Type.String({ minLength: 1, maxLength: 100 }),
    login: Type.Optional(Type.String({ maxLength: 50 })),
    url: Type.Optional(Type.String({ maxLength: 255 })),
    notes: Type.Optional(Type.String({ maxLength: 30000 })),
    password: Type.Optional(Type.String({ maxLength: 1000 })),
    categoryId: Type.Integer({ minimum: 1 }),
    clientId: Type.Integer({ minimum: 1 }),
    userGroupId: Type.Integer({ minimum: 1 }),
    isPrivate: Type.Optional(Type.Boolean()),
    isPrivateGroup: Type.Optional(Type.Boolean()),
    otherUserEdit: Type.Optional(Type.Boolean()),
    otherUserGroupEdit: Type.Optional(Type.Boolean()),
    parentId: Type.Optional(Type.Integer({ minimum: 0 })),
    passDateChange: Type.Optional(Type.Integer({ minimum: 0 })),
    tags: Type.Optional(
      Type.Array(Type.String({ minLength: 1, maxLength: 45 }), {
        maxItems: 30,
      }),
    ),
    version: Type.Optional(Type.Integer({ minimum: 0 })),
  },
  { additionalProperties: false },
);
export type AccountInput = Static<typeof accountInput>;
