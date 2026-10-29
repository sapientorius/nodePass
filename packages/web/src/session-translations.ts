import type { Language } from "@nodepass/contracts";

const accessChanged: Record<Language, string> = {
  de_DE:
    "Deine Berechtigungen haben sich geändert. Offene Ansichten wurden neu geladen und ungespeicherte Eingaben verworfen.",
  en_US:
    "Your permissions have changed. Open views were reloaded and unsaved entries were discarded.",
  es_ES:
    "Tus permisos han cambiado. Se han recargado las vistas abiertas y descartado los cambios sin guardar.",
  ca_ES:
    "Els teus permisos han canviat. S’han tornat a carregar les vistes obertes i s’han descartat els canvis sense desar.",
  hu_HU:
    "A jogosultságai megváltoztak. A megnyitott nézetek újratöltődtek, a nem mentett módosítások elvesztek.",
  fr_FR:
    "Vos autorisations ont changé. Les vues ouvertes ont été rechargées et les saisies non enregistrées ont été supprimées.",
  pl_PL:
    "Twoje uprawnienia uległy zmianie. Otwarte widoki zostały ponownie wczytane, a niezapisane zmiany odrzucone.",
  ru_RU:
    "Ваши права изменились. Открытые представления перезагружены, несохранённые изменения отменены.",
  nl_NL:
    "Je rechten zijn gewijzigd. Open weergaven zijn opnieuw geladen en niet-opgeslagen invoer is verwijderd.",
  pt_BR:
    "Suas permissões mudaram. As telas abertas foram recarregadas e as alterações não salvas foram descartadas.",
  it_IT:
    "Le tue autorizzazioni sono cambiate. Le viste aperte sono state ricaricate e le modifiche non salvate sono state scartate.",
  da: "Dine rettigheder er ændret. Åbne visninger blev genindlæst, og ikke-gemte indtastninger blev kasseret.",
  fo: "Tíni rættindi eru broytt. Opnar sýningar vórðu endurlisnar, og óvistaðar inntøkur vórðu strikaðar.",
  ja_JP:
    "権限が変更されました。開いていた画面を再読み込みし、未保存の入力を破棄しました。",
};

export const sessionMessages = Object.fromEntries(
  Object.entries(accessChanged).map(([locale, message]) => [
    locale,
    { accessChanged: message },
  ]),
);
