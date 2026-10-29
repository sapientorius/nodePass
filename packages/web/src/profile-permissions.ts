export const profilePermissionGroups = [
  {
    key: "profileAccounts",
    flags: [
      "accView",
      "accViewPass",
      "accViewHistory",
      "accAdd",
      "accEdit",
      "accEditPass",
      "accDelete",
      "accFiles",
      "accPrivate",
      "accPrivateGroup",
      "accPermission",
      "accPublicLinks",
    ],
  },
  {
    key: "profileAdministration",
    flags: [
      "mgmUsers",
      "mgmUsersResetPassword",
      "mgmGroups",
      "mgmProfiles",
      "mgmCategories",
      "mgmCustomers",
      "mgmTags",
      "mgmApiTokens",
      "mgmItemsPreset",
      "mgmCustomFields",
    ],
  },
  {
    key: "profileTools",
    flags: ["configGeneral", "configBackup", "configImport", "evl"],
  },
  {
    key: "profileLegacy",
    flags: [
      "accGlobalSearch",
      "configEncryption",
      "mgmPublicLinks",
      "mgmFiles",
      "mgmAccounts",
    ],
  },
] as const;
