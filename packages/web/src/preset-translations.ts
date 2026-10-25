import type { Language } from "@nodepass/contracts";
const keys =
  "fixed|priority|appAdmin|accountAdmin|required|useNumbers|useSymbols|useUpper|useLower|regex|useLetters".split(
    "|",
  );
const rows: Record<Language, string> = {
  de_DE:
    "Verbindlich|Priorität|Anwendungsadministrator|Kontenadministrator|Pflichtfeld|Ziffern|Sonderzeichen|Großbuchstaben|Kleinbuchstaben|Passwortmuster|Buchstaben",
  en_US:
    "Mandatory|Priority|Application administrator|Account administrator|Required field|Digits|Symbols|Uppercase letters|Lowercase letters|Password pattern|Letters",
  es_ES:
    "Obligatorio|Prioridad|Administrador de la aplicación|Administrador de cuentas|Campo obligatorio|Dígitos|Símbolos|Mayúsculas|Minúsculas|Patrón de contraseña|Letras",
  ca_ES:
    "Obligatori|Prioritat|Administrador de l’aplicació|Administrador de comptes|Camp obligatori|Dígits|Símbols|Majúscules|Minúscules|Patró de contrasenya|Lletres",
  hu_HU:
    "Kötelező|Prioritás|Alkalmazásadminisztrátor|Fiókadminisztrátor|Kötelező mező|Számjegyek|Szimbólumok|Nagybetűk|Kisbetűk|Jelszóminta|Betűk",
  fr_FR:
    "Obligatoire|Priorité|Administrateur de l’application|Administrateur des comptes|Champ obligatoire|Chiffres|Symboles|Majuscules|Minuscules|Motif du mot de passe|Lettres",
  pl_PL:
    "Obowiązkowe|Priorytet|Administrator aplikacji|Administrator kont|Pole wymagane|Cyfry|Symbole|Wielkie litery|Małe litery|Wzorzec hasła|Litery",
  ru_RU:
    "Обязательно|Приоритет|Администратор приложения|Администратор записей|Обязательное поле|Цифры|Символы|Прописные буквы|Строчные буквы|Шаблон пароля|Буквы",
  nl_NL:
    "Verplicht|Prioriteit|Applicatiebeheerder|Accountbeheerder|Verplicht veld|Cijfers|Symbolen|Hoofdletters|Kleine letters|Wachtwoordpatroon|Letters",
  pt_BR:
    "Obrigatório|Prioridade|Administrador da aplicação|Administrador de contas|Campo obrigatório|Dígitos|Símbolos|Maiúsculas|Minúsculas|Padrão de senha|Letras",
  it_IT:
    "Obbligatorio|Priorità|Amministratore dell’applicazione|Amministratore degli account|Campo obbligatorio|Cifre|Simboli|Maiuscole|Minuscole|Modello della password|Lettere",
  da: "Obligatorisk|Prioritet|Programadministrator|Kontoadministrator|Påkrævet felt|Tal|Symboler|Store bogstaver|Små bogstaver|Adgangskodemønster|Bogstaver",
  fo: "Kravt|Raðfesting|Forritsumsitari|Kontuumsitari|Kravdur teigur|Tøl|Tekn|Stórir bókstavir|Smáir bókstavir|Loyniorðsmynstur|Bókstavir",
  ja_JP:
    "必須|優先度|アプリケーション管理者|アカウント管理者|必須項目|数字|記号|大文字|小文字|パスワードのパターン|英字",
};
export const presetMessages = Object.fromEntries(
  Object.entries(rows).map(([locale, row]) => {
    const values = row.split("|");
    if (values.length !== keys.length)
      throw new Error("Incomplete preset translations");
    return [
      locale,
      Object.fromEntries(keys.map((key, n) => [key, values[n]!])),
    ];
  }),
);
