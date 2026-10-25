import type { Language } from "@nodepass/contracts";

const keys = [
  "primaryGroup",
  "primaryGroupHelp",
  "additionalGroups",
  "additionalGroupsHelp",
];
const rows: Record<Language, string[]> = {
  de_DE: [
    "Hauptgruppe",
    "Verpflichtende Gruppe des Benutzers. Sie wird beim Zugriff auf Konten berücksichtigt.",
    "Weitere Gruppen",
    "Optional. Die Hauptgruppe ist bereits zugeordnet. Das Profil begrenzt die erlaubten Aktionen.",
  ],
  en_US: [
    "Primary group",
    "The user's required group. It is taken into account when accessing accounts.",
    "Additional groups",
    "Optional. The primary group is already assigned. The profile limits the permitted actions.",
  ],
  es_ES: [
    "Grupo principal",
    "Grupo obligatorio del usuario. Se tiene en cuenta al acceder a las cuentas.",
    "Grupos adicionales",
    "Opcional. El grupo principal ya está asignado. El perfil limita las acciones permitidas.",
  ],
  ca_ES: [
    "Grup principal",
    "Grup obligatori de l’usuari. Es té en compte en accedir als comptes.",
    "Grups addicionals",
    "Opcional. El grup principal ja està assignat. El perfil limita les accions permeses.",
  ],
  hu_HU: [
    "Elsődleges csoport",
    "A felhasználó kötelező csoportja. A rendszer figyelembe veszi a fiókok elérésekor.",
    "További csoportok",
    "Nem kötelező. Az elsődleges csoport már hozzá van rendelve. A profil korlátozza az engedélyezett műveleteket.",
  ],
  fr_FR: [
    "Groupe principal",
    "Groupe obligatoire de l’utilisateur. Il est pris en compte lors de l’accès aux comptes.",
    "Groupes supplémentaires",
    "Facultatif. Le groupe principal est déjà attribué. Le profil limite les actions autorisées.",
  ],
  pl_PL: [
    "Grupa główna",
    "Wymagana grupa użytkownika. Jest uwzględniana przy dostępie do kont.",
    "Dodatkowe grupy",
    "Opcjonalne. Grupa główna jest już przypisana. Profil ogranicza dozwolone działania.",
  ],
  ru_RU: [
    "Основная группа",
    "Обязательная группа пользователя. Учитывается при доступе к учётным записям.",
    "Дополнительные группы",
    "Необязательно. Основная группа уже назначена. Профиль ограничивает разрешённые действия.",
  ],
  nl_NL: [
    "Hoofdgroep",
    "De verplichte groep van de gebruiker. Deze wordt meegenomen bij toegang tot accounts.",
    "Extra groepen",
    "Optioneel. De hoofdgroep is al toegewezen. Het profiel beperkt de toegestane acties.",
  ],
  pt_BR: [
    "Grupo principal",
    "Grupo obrigatório do usuário. É considerado no acesso às contas.",
    "Grupos adicionais",
    "Opcional. O grupo principal já está atribuído. O perfil limita as ações permitidas.",
  ],
  it_IT: [
    "Gruppo principale",
    "Gruppo obbligatorio dell’utente. Viene considerato per l’accesso agli account.",
    "Gruppi aggiuntivi",
    "Facoltativi. Il gruppo principale è già assegnato. Il profilo limita le azioni consentite.",
  ],
  da: [
    "Primær gruppe",
    "Brugerens obligatoriske gruppe. Den tages i betragtning ved adgang til konti.",
    "Yderligere grupper",
    "Valgfrit. Den primære gruppe er allerede tildelt. Profilen begrænser de tilladte handlinger.",
  ],
  fo: [
    "Høvuðsbólkur",
    "Kravdi bólkurin hjá brúkaranum. Hann verður tikin við, tá atgongd til kontur verður mett.",
    "Aðrir bólkar",
    "Valfrítt. Høvuðsbólkurin er longu tillutaður. Vangamyndin avmarkar loyvdu gerðirnar.",
  ],
  ja_JP: [
    "主グループ",
    "ユーザーに必須のグループです。アカウントへのアクセス時に考慮されます。",
    "追加グループ",
    "任意です。主グループは既に割り当てられています。許可される操作はプロファイルによって制限されます。",
  ],
};
export const userGroupMessages = Object.fromEntries(
  Object.entries(rows).map(([locale, values]) => {
    if (values.length !== keys.length)
      throw new Error(`Incomplete user group translation: ${locale}`);
    return [
      locale,
      Object.fromEntries(keys.map((key, index) => [key, values[index]!])),
    ];
  }),
);
