import type { Language } from "@nodepass/contracts";

const keys = ["eventDate", "eventAction", "eventActor", "eventTarget"];
const rows: Record<Language, string> = {
  de_DE: "Zeitpunkt (UTC)|Aktion|Ausgeführt von (Benutzer-ID)|Ziel / Details",
  en_US: "Time (UTC)|Action|Performed by (user ID)|Target / details",
  es_ES:
    "Fecha y hora (UTC)|Acción|Realizada por (ID de usuario)|Destino / detalles",
  ca_ES: "Data i hora (UTC)|Acció|Feta per (ID d’usuari)|Destinació / detalls",
  hu_HU:
    "Időpont (UTC)|Művelet|Végrehajtó (felhasználóazonosító)|Cél / részletek",
  fr_FR:
    "Date et heure (UTC)|Action|Effectuée par (ID utilisateur)|Cible / détails",
  pl_PL:
    "Data i czas (UTC)|Działanie|Wykonawca (ID użytkownika)|Cel / szczegóły",
  ru_RU:
    "Дата и время (UTC)|Действие|Исполнитель (ID пользователя)|Цель / подробности",
  nl_NL: "Tijdstip (UTC)|Actie|Uitgevoerd door (gebruikers-ID)|Doel / details",
  pt_BR:
    "Data e hora (UTC)|Ação|Executada por (ID do usuário)|Destino / detalhes",
  it_IT:
    "Data e ora (UTC)|Azione|Eseguita da (ID utente)|Destinazione / dettagli",
  da: "Tidspunkt (UTC)|Handling|Udført af (bruger-ID)|Mål / detaljer",
  fo: "Tíðspunkt (UTC)|Gerð|Útint av (brúkara-ID)|Mál / upplýsingar",
  ja_JP: "日時 (UTC)|操作|実行者（ユーザーID）|対象 / 詳細",
};

export const eventMessages = Object.fromEntries(
  Object.entries(rows).map(([locale, row]) => {
    const values = row.split("|");
    if (values.length !== keys.length)
      throw new Error(`Incomplete event translation: ${locale}`);
    return [
      locale,
      Object.fromEntries(keys.map((key, index) => [key, values[index]!])),
    ];
  }),
);
