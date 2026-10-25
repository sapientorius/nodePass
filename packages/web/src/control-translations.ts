import type { Language } from "@nodepass/contracts";
const clipboardCopiedLabels: Record<Language, string> = {
  de_DE: "In die Zwischenablage kopiert.",
  en_US: "Copied to clipboard.",
  es_ES: "Copiado al portapapeles.",
  ca_ES: "Copiat al porta-retalls.",
  hu_HU: "A vágólapra másolva.",
  fr_FR: "Copié dans le presse-papiers.",
  pl_PL: "Skopiowano do schowka.",
  ru_RU: "Скопировано в буфер обмена.",
  nl_NL: "Naar het klembord gekopieerd.",
  pt_BR: "Copiado para a área de transferência.",
  it_IT: "Copiato negli appunti.",
  da: "Kopieret til udklipsholderen.",
  fo: "Avritað á setiborðið.",
  ja_JP: "クリップボードにコピーしました。",
};
const rows: Record<Language, string> = {
  de_DE:
    "Hinzufügen|Erhöhen|Verringern|Sortieren nach|Elemente pro Seite|Passwort kopieren|Passwort kopiert|Konto auswählen|Richtung|Aufsteigend|Absteigend",
  en_US:
    "Add|Increase|Decrease|Sort by|Items per page|Copy password|Password copied|Select an account|Direction|Ascending|Descending",
  es_ES:
    "Añadir|Aumentar|Disminuir|Ordenar por|Elementos por página|Copiar contraseña|Contraseña copiada|Seleccionar una cuenta|Dirección|Ascendente|Descendente",
  ca_ES:
    "Afegeix|Augmenta|Disminueix|Ordena per|Elements per pàgina|Copia la contrasenya|Contrasenya copiada|Selecciona un compte|Direcció|Ascendent|Descendent",
  hu_HU:
    "Hozzáadás|Növelés|Csökkentés|Rendezés alapja|Elemek oldalanként|Jelszó másolása|Jelszó másolva|Fiók kiválasztása|Irány|Növekvő|Csökkenő",
  fr_FR:
    "Ajouter|Augmenter|Diminuer|Trier par|Éléments par page|Copier le mot de passe|Mot de passe copié|Sélectionner un compte|Ordre|Croissant|Décroissant",
  pl_PL:
    "Dodaj|Zwiększ|Zmniejsz|Sortuj według|Elementy na stronę|Kopiuj hasło|Hasło skopiowane|Wybierz konto|Kierunek|Rosnąco|Malejąco",
  ru_RU:
    "Добавить|Увеличить|Уменьшить|Сортировать по|Записей на странице|Копировать пароль|Пароль скопирован|Выберите учётную запись|Порядок|По возрастанию|По убыванию",
  nl_NL:
    "Toevoegen|Verhogen|Verlagen|Sorteren op|Items per pagina|Wachtwoord kopiëren|Wachtwoord gekopieerd|Selecteer een account|Richting|Oplopend|Aflopend",
  pt_BR:
    "Adicionar|Aumentar|Diminuir|Ordenar por|Itens por página|Copiar senha|Senha copiada|Selecionar uma conta|Direção|Crescente|Decrescente",
  it_IT:
    "Aggiungi|Aumenta|Diminuisci|Ordina per|Elementi per pagina|Copia password|Password copiata|Seleziona un account|Direzione|Crescente|Decrescente",
  da: "Tilføj|Forøg|Formindsk|Sortér efter|Poster pr. side|Kopiér adgangskode|Adgangskode kopieret|Vælg en konto|Retning|Stigende|Faldende",
  fo: "Legg afturat|Øk|Minka|Raða eftir|Færslur á síðu|Avrita loyniorð|Loyniorð avritað|Vel eina kontu|Rætningur|Vaksandi|Minkandi",
  ja_JP:
    "追加|増やす|減らす|並べ替え項目|1ページの件数|パスワードをコピー|パスワードをコピーしました|アカウントを選択|並び順|昇順|降順",
};
export const controlMessages = Object.fromEntries(
  Object.entries(rows).map(([locale, row]) => [
    locale,
    {
      clipboardCopied: clipboardCopiedLabels[locale as Language],
      ...Object.fromEntries(
        [
          "add",
          "increase",
          "decrease",
          "sort",
          "pageSize",
          "copyPassword",
          "passwordCopied",
          "selectAccount",
          "sortDirection",
          "ascending",
          "descending",
        ].map((key, n) => [key, row.split("|")[n]!]),
      ),
    },
  ]),
);
