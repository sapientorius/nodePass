import type { Language } from "@nodepass/contracts";
const keys = [
  "textType",
  "numberType",
  "phoneType",
  "colorType",
  "multilineType",
  "fieldScope",
  "fieldHide",
  "fieldEmpty",
  "fieldNewValue",
  "fieldReplacementHelp",
  "fieldClear",
];
const rows: Record<Language, string> = {
  de_DE:
    "Text|Zahl|Telefon|Farbe|Mehrzeiliger Text|Bereich|Verbergen|Kein Wert|Neuen Wert eingeben|Der bisherige Wert bleibt erhalten, bis du einen neuen Wert speicherst oder ihn ausdrücklich löschst.|Wert löschen",
  en_US:
    "Text|Number|Phone|Color|Multiline text|Scope|Hide|No value|Enter a new value|The existing value is kept until you save a replacement or explicitly clear it.|Clear value",
  es_ES:
    "Texto|Número|Teléfono|Color|Texto multilínea|Ámbito|Ocultar|Sin valor|Introduce un nuevo valor|El valor actual se conserva hasta que guardes uno nuevo o lo borres explícitamente.|Borrar valor",
  ca_ES:
    "Text|Nombre|Telèfon|Color|Text multilínia|Àmbit|Amaga|Sense valor|Introdueix un valor nou|El valor actual es conserva fins que en desis un de nou o l’esborris explícitament.|Esborra el valor",
  hu_HU:
    "Szöveg|Szám|Telefon|Szín|Többsoros szöveg|Hatókör|Elrejtés|Nincs érték|Adjon meg új értéket|A meglévő érték megmarad, amíg újat nem ment, vagy kifejezetten nem törli.|Érték törlése",
  fr_FR:
    "Texte|Nombre|Téléphone|Couleur|Texte multiligne|Portée|Masquer|Aucune valeur|Saisir une nouvelle valeur|La valeur actuelle est conservée jusqu’à l’enregistrement d’une nouvelle valeur ou sa suppression explicite.|Effacer la valeur",
  pl_PL:
    "Tekst|Liczba|Telefon|Kolor|Tekst wielowierszowy|Zakres|Ukryj|Brak wartości|Wprowadź nową wartość|Obecna wartość pozostaje do czasu zapisania nowej lub jej wyraźnego usunięcia.|Wyczyść wartość",
  ru_RU:
    "Текст|Число|Телефон|Цвет|Многострочный текст|Область|Скрыть|Нет значения|Введите новое значение|Текущее значение сохраняется, пока вы не сохраните новое или явно не удалите его.|Очистить значение",
  nl_NL:
    "Tekst|Getal|Telefoon|Kleur|Tekst met meerdere regels|Bereik|Verbergen|Geen waarde|Voer een nieuwe waarde in|De bestaande waarde blijft behouden totdat je een nieuwe opslaat of deze uitdrukkelijk wist.|Waarde wissen",
  pt_BR:
    "Texto|Número|Telefone|Cor|Texto multilinha|Escopo|Ocultar|Sem valor|Digite um novo valor|O valor atual é mantido até você salvar um novo ou apagá-lo explicitamente.|Limpar valor",
  it_IT:
    "Testo|Numero|Telefono|Colore|Testo su più righe|Ambito|Nascondi|Nessun valore|Inserisci un nuovo valore|Il valore attuale viene mantenuto finché non ne salvi uno nuovo o lo cancelli esplicitamente.|Cancella valore",
  da: "Tekst|Tal|Telefon|Farve|Tekst med flere linjer|Område|Skjul|Ingen værdi|Indtast en ny værdi|Den eksisterende værdi bevares, indtil du gemmer en ny eller udtrykkeligt rydder den.|Ryd værdi",
  fo: "Tekstur|Tal|Telefon|Litur|Fleirlinjutekstur|Øki|Fjal|Einki virði|Skriva eitt nýtt virði|Verandi virði verður varðveitt, til tú goymir eitt nýtt ella strikar tað beinleiðis.|Strika virði",
  ja_JP:
    "テキスト|数値|電話|色|複数行テキスト|対象|非表示|値なし|新しい値を入力|新しい値を保存するか、明示的に消去するまで、現在の値は保持されます。|値を消去",
};
export const fieldMessages = Object.fromEntries(
  Object.entries(rows).map(([locale, row]) => {
    const values = row.split("|");
    if (values.length !== keys.length)
      throw new Error("Incomplete field translations");
    return [
      locale,
      Object.fromEntries(keys.map((key, n) => [key, values[n]!])),
    ];
  }),
);
