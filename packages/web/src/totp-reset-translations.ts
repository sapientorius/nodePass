import type { Language } from "@nodepass/contracts";

const keys = [
  "totpReset",
  "totpResetHelp",
  "totpResetSuccess",
  "totpResetPending",
];
const rows: Record<Language, [string, string, string, string]> = {
  de_DE: [
    "2FA-App zurücksetzen",
    "Die App-Verknüpfung und alle Wiederherstellungscodes werden gelöscht. Alle Sitzungen werden abgemeldet. Vorhandene Passkeys bleiben gültig. Ohne Passkey muss vor dem nächsten Tresorzugriff ein neuer Faktor eingerichtet werden.",
    "Die 2FA-App wurde zurückgesetzt.",
    "Deine 2FA-App wurde durch einen Administrator zurückgesetzt. Richte vor dem Tresorzugriff eine Authenticator-App oder einen Passkey ein. Danach kannst du in deinen Sicherheitseinstellungen neue Wiederherstellungscodes erzeugen.",
  ],
  en_US: [
    "Reset 2FA app",
    "The authenticator app and all recovery codes will be removed. All sessions will be signed out. Existing passkeys remain valid. Without a passkey, a new factor must be enrolled before accessing the vault again.",
    "The 2FA app has been reset.",
    "An administrator reset your 2FA app. Enroll an authenticator app or a passkey before accessing the vault. Afterwards, you can generate new recovery codes in your security settings.",
  ],
  es_ES: [
    "Restablecer aplicación 2FA",
    "Se eliminarán la aplicación de autenticación y todos los códigos de recuperación. Se cerrarán todas las sesiones. Las claves de acceso existentes seguirán siendo válidas. Sin una clave de acceso, se deberá configurar un nuevo factor antes de acceder a la bóveda.",
    "Se ha restablecido la aplicación 2FA.",
    "Un administrador ha restablecido tu aplicación 2FA. Configura una aplicación de autenticación o una clave de acceso antes de abrir la bóveda. Después podrás generar nuevos códigos de recuperación en tus ajustes de seguridad.",
  ],
  ca_ES: [
    "Restableix l’aplicació 2FA",
    "S’eliminaran l’aplicació d’autenticació i tots els codis de recuperació. Es tancaran totes les sessions. Les claus d’accés existents continuaran sent vàlides. Sense una clau d’accés, caldrà configurar un factor nou abans d’accedir a la caixa forta.",
    "S’ha restablert l’aplicació 2FA.",
    "Un administrador ha restablert la teva aplicació 2FA. Configura una aplicació d’autenticació o una clau d’accés abans d’obrir la caixa forta. Després podràs generar codis de recuperació nous a la configuració de seguretat.",
  ],
  hu_HU: [
    "2FA-alkalmazás visszaállítása",
    "A hitelesítő alkalmazás és minden helyreállítási kód törlődik. Minden munkamenet kijelentkezik. A meglévő hozzáférési kulcsok érvényesek maradnak. Hozzáférési kulcs nélkül új tényezőt kell beállítani a széf elérése előtt.",
    "A 2FA-alkalmazás visszaállítva.",
    "Egy rendszergazda visszaállította a 2FA-alkalmazását. A széf elérése előtt állítson be hitelesítő alkalmazást vagy hozzáférési kulcsot. Ezután a biztonsági beállításokban új helyreállítási kódokat hozhat létre.",
  ],
  fr_FR: [
    "Réinitialiser l’application 2FA",
    "L’application d’authentification et tous les codes de récupération seront supprimés. Toutes les sessions seront fermées. Les clés d’accès existantes resteront valides. Sans clé d’accès, un nouveau facteur devra être configuré avant d’accéder au coffre.",
    "L’application 2FA a été réinitialisée.",
    "Un administrateur a réinitialisé votre application 2FA. Configurez une application d’authentification ou une clé d’accès avant d’ouvrir le coffre. Vous pourrez ensuite générer de nouveaux codes de récupération dans vos paramètres de sécurité.",
  ],
  pl_PL: [
    "Zresetuj aplikację 2FA",
    "Aplikacja uwierzytelniająca i wszystkie kody odzyskiwania zostaną usunięte. Wszystkie sesje zostaną wylogowane. Istniejące klucze dostępu pozostaną ważne. Bez klucza dostępu przed otwarciem sejfu trzeba skonfigurować nowy składnik.",
    "Aplikacja 2FA została zresetowana.",
    "Administrator zresetował Twoją aplikację 2FA. Przed otwarciem sejfu skonfiguruj aplikację uwierzytelniającą lub klucz dostępu. Następnie możesz wygenerować nowe kody odzyskiwania w ustawieniach bezpieczeństwa.",
  ],
  ru_RU: [
    "Сбросить приложение 2FA",
    "Приложение аутентификации и все коды восстановления будут удалены. Все сеансы будут завершены. Существующие ключи доступа останутся действительными. Без ключа доступа потребуется настроить новый фактор перед открытием хранилища.",
    "Приложение 2FA сброшено.",
    "Администратор сбросил ваше приложение 2FA. Настройте приложение аутентификации или ключ доступа перед открытием хранилища. Затем можно создать новые коды восстановления в настройках безопасности.",
  ],
  nl_NL: [
    "2FA-app herstellen",
    "De authenticator-app en alle herstelcodes worden verwijderd. Alle sessies worden afgemeld. Bestaande toegangssleutels blijven geldig. Zonder toegangssleutel moet een nieuwe factor worden ingesteld voordat de kluis weer toegankelijk is.",
    "De 2FA-app is hersteld.",
    "Een beheerder heeft je 2FA-app hersteld. Stel een authenticator-app of toegangssleutel in voordat je de kluis opent. Daarna kun je nieuwe herstelcodes maken in je beveiligingsinstellingen.",
  ],
  pt_BR: [
    "Redefinir aplicativo 2FA",
    "O aplicativo autenticador e todos os códigos de recuperação serão removidos. Todas as sessões serão encerradas. As chaves de acesso existentes continuarão válidas. Sem uma chave de acesso, será necessário configurar um novo fator antes de acessar o cofre.",
    "O aplicativo 2FA foi redefinido.",
    "Um administrador redefiniu seu aplicativo 2FA. Configure um aplicativo autenticador ou uma chave de acesso antes de abrir o cofre. Depois, você poderá gerar novos códigos de recuperação nas configurações de segurança.",
  ],
  it_IT: [
    "Reimposta l’app 2FA",
    "L’app di autenticazione e tutti i codici di recupero verranno rimossi. Tutte le sessioni saranno disconnesse. Le chiavi di accesso esistenti resteranno valide. Senza una chiave di accesso, sarà necessario configurare un nuovo fattore prima di accedere alla cassaforte.",
    "L’app 2FA è stata reimpostata.",
    "Un amministratore ha reimpostato la tua app 2FA. Configura un’app di autenticazione o una chiave di accesso prima di aprire la cassaforte. In seguito potrai generare nuovi codici di recupero nelle impostazioni di sicurezza.",
  ],
  da: [
    "Nulstil 2FA-app",
    "Godkendelsesappen og alle gendannelseskoder fjernes. Alle sessioner logges ud. Eksisterende adgangsnøgler forbliver gyldige. Uden en adgangsnøgle skal en ny faktor oprettes, før boksen kan åbnes igen.",
    "2FA-appen er nulstillet.",
    "En administrator har nulstillet din 2FA-app. Opret en godkendelsesapp eller adgangsnøgle, før du åbner boksen. Derefter kan du oprette nye gendannelseskoder i dine sikkerhedsindstillinger.",
  ],
  fo: [
    "Nullstilla 2FA-forrit",
    "Váttanarforritið og allar endurskapanarkotur verða strikað. Allar setur verða ritaðar út. Verandi atgongulyklar eru framvegis gildigir. Uttan atgongulykil má ein nýggjur faktor setast upp, áðrenn hválvið kann latast upp aftur.",
    "2FA-forritið er nullstillað.",
    "Ein stjóri hevur nullstillað títt 2FA-forrit. Set eitt váttanarforrit ella ein atgongulykil upp, áðrenn tú letur hválvið upp. Síðan kanst tú gera nýggjar endurskapanarkotur í trygdaruppsetingini.",
  ],
  ja_JP: [
    "2FAアプリをリセット",
    "認証アプリの登録とすべての復旧コードを削除し、すべてのセッションをログアウトします。既存のパスキーは引き続き有効です。パスキーがない場合、保管庫にアクセスする前に新しい認証要素の設定が必要です。",
    "2FAアプリをリセットしました。",
    "管理者が2FAアプリをリセットしました。保管庫を開く前に、認証アプリまたはパスキーを設定してください。その後、セキュリティ設定で新しい復旧コードを生成できます。",
  ],
};
export const totpResetMessages = Object.fromEntries(
  Object.entries(rows).map(([locale, values]) => [
    locale,
    Object.fromEntries(keys.map((key, index) => [key, values[index]])),
  ]),
);
