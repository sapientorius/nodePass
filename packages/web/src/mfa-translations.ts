import type { Language } from "@nodepass/contracts";

const rows: Record<Language, [string, string, string, string]> = {
  de_DE: [
    "Gib den aktuellen Code aus deiner Authenticator-App ein.",
    "Gib einen deiner gespeicherten Wiederherstellungscodes ein. Jeder Code ist nur einmal gültig.",
    "Im Notfall: Wiederherstellungscode verwenden",
    "Zurück zum Authenticator-Code",
  ],
  en_US: [
    "Enter the current code from your authenticator app.",
    "Enter one of your saved recovery codes. Each code can only be used once.",
    "Emergency access: use a recovery code",
    "Back to authenticator code",
  ],
  es_ES: [
    "Introduce el código actual de tu aplicación de autenticación.",
    "Introduce uno de tus códigos de recuperación guardados. Cada código solo se puede usar una vez.",
    "En caso de emergencia: usar un código de recuperación",
    "Volver al código de la aplicación",
  ],
  ca_ES: [
    "Introdueix el codi actual de la teva aplicació d’autenticació.",
    "Introdueix un dels teus codis de recuperació desats. Cada codi només es pot fer servir una vegada.",
    "En cas d’emergència: fes servir un codi de recuperació",
    "Torna al codi de l’aplicació",
  ],
  hu_HU: [
    "Adja meg a hitelesítő alkalmazásban látható aktuális kódot.",
    "Adja meg az egyik elmentett helyreállítási kódját. Minden kód csak egyszer használható.",
    "Vészhelyzetben: helyreállítási kód használata",
    "Vissza a hitelesítő alkalmazás kódjához",
  ],
  fr_FR: [
    "Saisissez le code actuel de votre application d’authentification.",
    "Saisissez l’un de vos codes de récupération enregistrés. Chaque code ne peut être utilisé qu’une fois.",
    "En cas d’urgence : utiliser un code de récupération",
    "Revenir au code de l’application",
  ],
  pl_PL: [
    "Wpisz aktualny kod z aplikacji uwierzytelniającej.",
    "Wpisz jeden z zapisanych kodów odzyskiwania. Każdego kodu można użyć tylko raz.",
    "W sytuacji awaryjnej: użyj kodu odzyskiwania",
    "Wróć do kodu z aplikacji",
  ],
  ru_RU: [
    "Введите текущий код из приложения аутентификации.",
    "Введите один из сохранённых кодов восстановления. Каждый код можно использовать только один раз.",
    "Экстренный доступ: использовать код восстановления",
    "Вернуться к коду из приложения",
  ],
  nl_NL: [
    "Voer de huidige code uit je authenticator-app in.",
    "Voer een van je opgeslagen herstelcodes in. Elke code kan maar één keer worden gebruikt.",
    "In noodgevallen: gebruik een herstelcode",
    "Terug naar de authenticatorcode",
  ],
  pt_BR: [
    "Digite o código atual do seu aplicativo autenticador.",
    "Digite um dos seus códigos de recuperação salvos. Cada código só pode ser usado uma vez.",
    "Em caso de emergência: usar um código de recuperação",
    "Voltar ao código do autenticador",
  ],
  it_IT: [
    "Inserisci il codice attuale della tua app di autenticazione.",
    "Inserisci uno dei codici di recupero salvati. Ogni codice può essere usato una sola volta.",
    "In caso di emergenza: usa un codice di recupero",
    "Torna al codice dell’app",
  ],
  da: [
    "Indtast den aktuelle kode fra din godkendelsesapp.",
    "Indtast en af dine gemte gendannelseskoder. Hver kode kan kun bruges én gang.",
    "I nødstilfælde: brug en gendannelseskode",
    "Tilbage til koden fra appen",
  ],
  fo: [
    "Skriva núverandi kotuna úr váttanarforritinum.",
    "Skriva eina av tínum goymdu endurskapanarkotum. Hvør kota kann bara nýtast eina ferð.",
    "Í neyðstøðu: nýt eina endurskapanarkotu",
    "Aftur til kotuna úr váttanarforritinum",
  ],
  ja_JP: [
    "認証アプリに表示されている現在のコードを入力してください。",
    "保存した復旧コードのいずれかを入力してください。各コードは一度だけ使えます。",
    "緊急時：復旧コードを使用",
    "認証アプリのコードに戻る",
  ],
};

export const mfaMessages = Object.fromEntries(
  Object.entries(rows).map(([locale, values]) => [
    locale,
    Object.fromEntries(
      [
        "mfaTotpHelp",
        "mfaRecoveryHelp",
        "useRecoveryCode",
        "useAuthenticatorCode",
      ].map((key, index) => [key, values[index]!]),
    ),
  ]),
);
