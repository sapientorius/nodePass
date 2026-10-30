import type { Language } from "@nodepass/contracts";

const rows: Record<Language, string[]> = {
  de_DE: [
    "Mitglieder",
    "Mitglieder mit dieser Hauptgruppe",
    "Mitglieder mit dieser Nebengruppe",
    "{count} Mitglieder",
    "Die Mitglieder konnten nicht geladen werden.",
    "Erneut versuchen",
  ],
  en_US: [
    "Members",
    "Members with this primary group",
    "Members with this additional group",
    "{count} members",
    "The members could not be loaded.",
    "Try again",
  ],
  es_ES: [
    "Miembros",
    "Miembros con este grupo principal",
    "Miembros con este grupo adicional",
    "{count} miembros",
    "No se pudieron cargar los miembros.",
    "Reintentar",
  ],
  ca_ES: [
    "Membres",
    "Membres amb aquest grup principal",
    "Membres amb aquest grup addicional",
    "{count} membres",
    "No s’han pogut carregar els membres.",
    "Torna-ho a provar",
  ],
  hu_HU: [
    "Tagok",
    "Tagok ezzel az elsődleges csoporttal",
    "Tagok ezzel a további csoporttal",
    "{count} tag",
    "A tagok nem tölthetők be.",
    "Újrapróbálkozás",
  ],
  fr_FR: [
    "Membres",
    "Membres ayant ce groupe principal",
    "Membres ayant ce groupe supplémentaire",
    "{count} membres",
    "Impossible de charger les membres.",
    "Réessayer",
  ],
  pl_PL: [
    "Członkowie",
    "Członkowie z tą grupą główną",
    "Członkowie z tą grupą dodatkową",
    "{count} członków",
    "Nie udało się wczytać członków.",
    "Spróbuj ponownie",
  ],
  ru_RU: [
    "Участники",
    "Участники с этой основной группой",
    "Участники с этой дополнительной группой",
    "Участников: {count}",
    "Не удалось загрузить участников.",
    "Повторить",
  ],
  nl_NL: [
    "Leden",
    "Leden met deze primaire groep",
    "Leden met deze aanvullende groep",
    "{count} leden",
    "De leden konden niet worden geladen.",
    "Opnieuw proberen",
  ],
  pt_BR: [
    "Membros",
    "Membros com este grupo principal",
    "Membros com este grupo adicional",
    "{count} membros",
    "Não foi possível carregar os membros.",
    "Tentar novamente",
  ],
  it_IT: [
    "Membri",
    "Membri con questo gruppo principale",
    "Membri con questo gruppo aggiuntivo",
    "{count} membri",
    "Impossibile caricare i membri.",
    "Riprova",
  ],
  da: [
    "Medlemmer",
    "Medlemmer med denne primære gruppe",
    "Medlemmer med denne ekstra gruppe",
    "{count} medlemmer",
    "Medlemmerne kunne ikke indlæses.",
    "Prøv igen",
  ],
  fo: [
    "Limir",
    "Limir við hesum høvuðsbólki",
    "Limir við hesum eykabólki",
    "{count} limir",
    "Limirnir kundu ikki lesast.",
    "Royn aftur",
  ],
  ja_JP: [
    "メンバー",
    "このグループをメイングループとするメンバー",
    "このグループを追加グループとするメンバー",
    "メンバー数: {count}",
    "メンバーを読み込めませんでした。",
    "再試行",
  ],
};
const keys = [
  "groupMembers",
  "primaryMembers",
  "additionalMembers",
  "memberCount",
  "memberLoadError",
  "memberRetry",
];
export const groupMemberMessages = Object.fromEntries(
  Object.entries(rows).map(([locale, values]) => {
    if (values.length !== keys.length)
      throw new Error(`Incomplete group membership translation: ${locale}`);
    return [
      locale,
      Object.fromEntries(keys.map((key, index) => [key, values[index]!])),
    ];
  }),
);
