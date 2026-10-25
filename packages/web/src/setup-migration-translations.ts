import type { Language } from "@nodepass/contracts";

const rows: Record<Language, [string, string, string, string]> = {
  de_DE: [
    "Bisheriger sysPass-Benutzername",
    "Bisheriges sysPass-Login-Passwort",
    "Verwende einen bestehenden lokalen sysPass-Anwendungsadministrator und dessen bisheriges Login-Passwort. Die Benutzer werden übernommen. Das Master-Passwort gehört in das separate Feld darunter.",
    "Die sysPass-Datenbank ist bereits vorhanden. Fahre mit den bisherigen Admin-Zugangsdaten fort und wähle bei Bedarf erneut die config.xml. Ein weiterer SQL-Import ist nicht erforderlich.",
  ],
  en_US: [
    "Existing sysPass username",
    "Existing sysPass login password",
    "Use an existing local sysPass application administrator and their current login password. Users are retained. Enter the master password in the separate field below.",
    "The sysPass database is already present. Continue with the existing administrator credentials and select config.xml again if needed. Another SQL import is not required.",
  ],
  es_ES: [
    "Usuario actual de sysPass",
    "Contraseña actual de acceso a sysPass",
    "Usa un administrador local de la aplicación sysPass y su contraseña actual de acceso. Se conservan los usuarios. Introduce la contraseña maestra en el campo independiente de abajo.",
    "La base de datos de sysPass ya está disponible. Continúa con las credenciales actuales del administrador y vuelve a seleccionar config.xml si es necesario. No hace falta importar SQL otra vez.",
  ],
  ca_ES: [
    "Usuari actual de sysPass",
    "Contrasenya actual d’accés a sysPass",
    "Utilitza un administrador local de l’aplicació sysPass i la seva contrasenya actual d’accés. Es conserven els usuaris. Introdueix la contrasenya mestra al camp independent de sota.",
    "La base de dades de sysPass ja està disponible. Continua amb les credencials actuals de l’administrador i torna a seleccionar config.xml si cal. No cal tornar a importar SQL.",
  ],
  hu_HU: [
    "Meglévő sysPass-felhasználónév",
    "Meglévő sysPass-bejelentkezési jelszó",
    "Használjon meglévő helyi sysPass-alkalmazásadminisztrátort és annak jelenlegi bejelentkezési jelszavát. A felhasználók megmaradnak. A mesterjelszót az alábbi külön mezőbe írja.",
    "A sysPass adatbázisa már rendelkezésre áll. Folytassa a meglévő adminisztrátori adatokkal, és szükség esetén válassza ki ismét a config.xml fájlt. Újabb SQL-import nem szükséges.",
  ],
  fr_FR: [
    "Identifiant sysPass existant",
    "Mot de passe de connexion sysPass existant",
    "Utilisez un administrateur local de l’application sysPass et son mot de passe de connexion actuel. Les utilisateurs sont conservés. Saisissez le mot de passe maître dans le champ distinct ci-dessous.",
    "La base de données sysPass est déjà présente. Continuez avec les identifiants existants de l’administrateur et sélectionnez à nouveau config.xml si nécessaire. Une nouvelle importation SQL est inutile.",
  ],
  pl_PL: [
    "Obecna nazwa użytkownika sysPass",
    "Obecne hasło logowania sysPass",
    "Użyj istniejącego lokalnego administratora aplikacji sysPass i jego obecnego hasła logowania. Użytkownicy zostaną zachowani. Hasło główne wpisz w oddzielnym polu poniżej.",
    "Baza danych sysPass jest już dostępna. Kontynuuj z obecnymi danymi administratora i w razie potrzeby ponownie wybierz config.xml. Kolejny import SQL nie jest wymagany.",
  ],
  ru_RU: [
    "Существующее имя пользователя sysPass",
    "Текущий пароль входа в sysPass",
    "Используйте существующего локального администратора приложения sysPass и его текущий пароль входа. Пользователи сохраняются. Мастер-пароль введите в отдельное поле ниже.",
    "База данных sysPass уже доступна. Продолжите с существующими данными администратора и при необходимости снова выберите config.xml. Повторный импорт SQL не требуется.",
  ],
  nl_NL: [
    "Bestaande sysPass-gebruikersnaam",
    "Bestaand sysPass-inlogwachtwoord",
    "Gebruik een bestaande lokale sysPass-applicatiebeheerder en het huidige inlogwachtwoord. Gebruikers blijven behouden. Vul het hoofdwachtwoord in het aparte veld hieronder in.",
    "De sysPass-database is al aanwezig. Ga verder met de bestaande beheerdersgegevens en selecteer indien nodig config.xml opnieuw. Opnieuw SQL importeren is niet nodig.",
  ],
  pt_BR: [
    "Nome de usuário atual do sysPass",
    "Senha atual de acesso ao sysPass",
    "Use um administrador local existente da aplicação sysPass e sua senha atual de acesso. Os usuários serão mantidos. Digite a senha mestra no campo separado abaixo.",
    "O banco de dados do sysPass já está disponível. Continue com as credenciais atuais do administrador e selecione config.xml novamente se necessário. Não é preciso importar SQL outra vez.",
  ],
  it_IT: [
    "Nome utente sysPass esistente",
    "Password di accesso sysPass attuale",
    "Usa un amministratore locale esistente dell’applicazione sysPass e la sua password di accesso attuale. Gli utenti vengono mantenuti. Inserisci la password principale nel campo separato sottostante.",
    "Il database sysPass è già presente. Prosegui con le credenziali esistenti dell’amministratore e seleziona nuovamente config.xml se necessario. Non occorre un’altra importazione SQL.",
  ],
  da: [
    "Eksisterende sysPass-brugernavn",
    "Eksisterende sysPass-loginadgangskode",
    "Brug en eksisterende lokal sysPass-applikationsadministrator og den nuværende loginadgangskode. Brugerne bevares. Indtast hovedadgangskoden i det separate felt nedenfor.",
    "sysPass-databasen findes allerede. Fortsæt med de eksisterende administratoroplysninger, og vælg config.xml igen ved behov. En ny SQL-import er ikke nødvendig.",
  ],
  fo: [
    "Verandi sysPass-brúkaranavn",
    "Verandi sysPass-innritingarloyniorð",
    "Brúka ein verandi lokalan sysPass-forritsstjóra og hansara verandi innritingarloyniorð. Brúkararnir verða varðveittir. Skriva høvuðsloyniorðið í serstaka teigin niðanfyri.",
    "sysPass-dátugrunnurin er longu til staðar. Halt fram við verandi innritingarupplýsingum hjá forritsstjóranum og vel config.xml aftur, um neyðugt. Nýggj SQL-innflyting er ikki neyðug.",
  ],
  ja_JP: [
    "既存のsysPassユーザー名",
    "現在のsysPassログインパスワード",
    "既存のローカルsysPassアプリケーション管理者と現在のログインパスワードを使用してください。ユーザーは引き継がれます。マスターパスワードは下の専用欄に入力してください。",
    "sysPassデータベースはすでに存在します。既存の管理者認証情報で続行し、必要に応じてconfig.xmlを再選択してください。SQLを再度インポートする必要はありません。",
  ],
};

const keys = [
  "setupLegacyLogin",
  "setupLegacyPassword",
  "setupLegacyCredentialsHelp",
  "setupLegacyImportedHelp",
];
export const setupMigrationMessages = Object.fromEntries(
  Object.entries(rows).map(([locale, values]) => [
    locale,
    Object.fromEntries(keys.map((key, i) => [key, values[i]!])),
  ]),
);
