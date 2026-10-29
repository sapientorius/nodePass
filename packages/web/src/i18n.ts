import { createI18n } from "vue-i18n";
import { confirmationMessages } from "./confirmation-translations";
import { sessionMessages } from "./session-translations";
import { eventMessages } from "./event-translations";
import { profilePermissionMessages } from "./profile-permission-translations";
import { updateMessages } from "./update-translations";
import { releaseMessages } from "./release-translations";
import type { Language } from "@nodepass/contracts";
import { extraMessages } from "./translations";
import { presetMessages } from "./preset-translations";
import { controlMessages } from "./control-translations";
import { fieldMessages } from "./field-translations";
import { setupMessages } from "./setup-translations";
import { setupErrorMessages } from "./setup-error-translations";
import { setupCompatibilityMessages } from "./setup-compatibility-translations";
import { setupMigrationMessages } from "./setup-migration-translations";
import { shareMessages } from "./share-translations";
import { userGroupMessages } from "./user-group-translations";
import { accountAccessMessages } from "./account-access-translations";
import { userManagementMessages } from "./user-management-translations";
import { backupMessages } from "./backup-translations";
export const languageOptions = [
  { label: "Deutsch", value: "de_DE" },
  { label: "English", value: "en_US" },
  { label: "Español", value: "es_ES" },
  { label: "Català", value: "ca_ES" },
  { label: "Magyar", value: "hu_HU" },
  { label: "Français", value: "fr_FR" },
  { label: "Polski", value: "pl_PL" },
  { label: "Русский", value: "ru_RU" },
  { label: "Nederlands", value: "nl_NL" },
  { label: "Português", value: "pt_BR" },
  { label: "Italiano", value: "it_IT" },
  { label: "Dansk", value: "da" },
  { label: "Føroyskt", value: "fo" },
  { label: "日本語", value: "ja_JP" },
];
const backToLoginLabels: Record<Language, string> = {
  de_DE: "Zurück zur Anmeldung",
  en_US: "Back to sign in",
  es_ES: "Volver al inicio de sesión",
  ca_ES: "Torna a l’inici de sessió",
  hu_HU: "Vissza a bejelentkezéshez",
  fr_FR: "Retour à la connexion",
  pl_PL: "Powrót do logowania",
  ru_RU: "Вернуться ко входу",
  nl_NL: "Terug naar aanmelden",
  pt_BR: "Voltar para o login",
  it_IT: "Torna all’accesso",
  da: "Tilbage til login",
  fo: "Aftur til innriting",
  ja_JP: "ログイン画面に戻る",
};
const keys =
  "accounts|favorites|categories|clients|tags|users|groups|profiles|settings|security|events|backups|signIn|signOut|login|password|search|create|save|cancel|name|url|notes|category|client|group|copy|reveal|history|files|permissions|shares|empty|subtitle|welcome|loginHelp|passkey|code|continue|setup|setupHelp|setupToken|masterPassword|migrate|fresh|maintenance|light|dark|list|cards|all|delete|edit|generate|language|theme|expiry|confirm|close|error|loading|mfa|totp|enroll|secret|download|upload|export|import".split(
    "|",
  );
const rows: Record<Language, string> = {
  de_DE:
    "Konten|Favoriten|Kategorien|Kunden|Tags|Benutzer|Gruppen|Profile|Einstellungen|Sicherheit|Aktivitäten|Sicherungen|Anmelden|Abmelden|Benutzername|Passwort|Konten durchsuchen …|Neues Konto|Speichern|Abbrechen|Name|Adresse|Notizen|Kategorie|Kunde|Gruppe|Kopieren|Anzeigen|Verlauf|Dateien|Berechtigungen|Freigaben|Noch keine Einträge|Ein sicherer Ort für alles Vertrauliche.|Willkommen zurück.|Melde dich an, um deinen Tresor zu öffnen.|Mit Passkey anmelden|Bestätigungscode|Weiter|nodePass einrichten|Richte nodePass ein oder importiere deine sysPass Daten.|Einrichtungstoken|Bisheriges Master-Passwort|sysPass importieren|Neu installieren|sysPass ist gestoppt und ich habe eine eigene Sicherung erstellt.|Hell|Dunkel|Liste|Karten|Alle|Löschen|Bearbeiten|Generieren|Sprache|Darstellung|Ablauf|Bestätigen|Schließen|Die Aktion konnte nicht abgeschlossen werden.|Wird geladen …|Anmeldeschutz|Authenticator-App|Einrichten|Geheimnis|Herunterladen|Hochladen|Exportieren|Importieren",
  en_US:
    "Accounts|Favorites|Categories|Customers|Tags|Users|Groups|Profiles|Settings|Security|Activity|Backups|Sign in|Sign out|Username|Password|Search your accounts …|New account|Save|Cancel|Name|Address|Notes|Category|Customer|Group|Copy|Reveal|History|Files|Permissions|Shares|No entries yet|A secure home for everything confidential.|Welcome back.|Sign in to open your vault.|Sign in with a passkey|Verification code|Continue|Set up nodePass|Set up nodePass or import your sysPass data.|Setup token|Previous master password|Import sysPass|Fresh installation|sysPass is stopped and I have created my own backup.|Light|Dark|List|Cards|All|Delete|Edit|Generate|Language|Appearance|Expiry|Confirm|Close|The action could not be completed.|Loading …|Login protection|Authenticator app|Set up|Secret|Download|Upload|Export|Import",
  es_ES:
    "Cuentas|Favoritos|Categorías|Clientes|Etiquetas|Usuarios|Grupos|Perfiles|Ajustes|Seguridad|Actividad|Copias de seguridad|Iniciar sesión|Cerrar sesión|Usuario|Contraseña|Buscar cuentas …|Nueva cuenta|Guardar|Cancelar|Nombre|Dirección|Notas|Categoría|Cliente|Grupo|Copiar|Mostrar|Historial|Archivos|Permisos|Enlaces compartidos|Todavía no hay entradas|Un lugar seguro para todo lo confidencial.|Te damos la bienvenida.|Inicia sesión para abrir tu bóveda.|Acceder con una clave de acceso|Código de verificación|Continuar|Configurar nodePass|Configura nodePass o importa tus datos de sysPass.|Token de configuración|Contraseña maestra anterior|Importar sysPass|Instalación nueva|sysPass está detenido y he creado mi propia copia de seguridad.|Claro|Oscuro|Lista|Tarjetas|Todos|Eliminar|Editar|Generar|Idioma|Apariencia|Caducidad|Confirmar|Cerrar|No se pudo completar la acción.|Cargando …|Protección de acceso|Aplicación de autenticación|Configurar|Secreto|Descargar|Subir|Exportar|Importar",
  ca_ES:
    "Comptes|Preferits|Categories|Clients|Etiquetes|Usuaris|Grups|Perfils|Configuració|Seguretat|Activitat|Còpies de seguretat|Inicia sessió|Tanca sessió|Usuari|Contrasenya|Cerca comptes …|Compte nou|Desa|Cancel·la|Nom|Adreça|Notes|Categoria|Client|Grup|Copia|Mostra|Historial|Fitxers|Permisos|Enllaços compartits|Encara no hi ha entrades|Un lloc segur per a tot allò confidencial.|Et donem la benvinguda.|Inicia sessió per obrir la caixa forta.|Accedeix amb una clau d’accés|Codi de verificació|Continua|Configura nodePass|Configura nodePass o importa les teves dades de sysPass.|Token de configuració|Contrasenya mestra anterior|Importa sysPass|Instal·lació nova|sysPass està aturat i he creat una còpia de seguretat pròpia.|Clar|Fosc|Llista|Targetes|Tots|Suprimeix|Edita|Genera|Idioma|Aparença|Caducitat|Confirma|Tanca|No s’ha pogut completar l’acció.|S’està carregant …|Protecció d’accés|Aplicació d’autenticació|Configura|Secret|Baixa|Puja|Exporta|Importa",
  hu_HU:
    "Fiókok|Kedvencek|Kategóriák|Ügyfelek|Címkék|Felhasználók|Csoportok|Profilok|Beállítások|Biztonság|Tevékenység|Biztonsági mentések|Bejelentkezés|Kijelentkezés|Felhasználónév|Jelszó|Fiókok keresése …|Új fiók|Mentés|Mégse|Név|Cím|Jegyzetek|Kategória|Ügyfél|Csoport|Másolás|Megjelenítés|Előzmények|Fájlok|Jogosultságok|Megosztások|Még nincsenek bejegyzések|Biztonságos hely minden bizalmas adatnak.|Üdvözöljük újra!|Jelentkezzen be a széf megnyitásához.|Bejelentkezés hozzáférési kulccsal|Ellenőrzőkód|Folytatás|A nodePass beállítása|Állítsa be a nodePass rendszert, vagy importálja sysPass-adatait.|Beállítási token|Korábbi mesterjelszó|sysPass importálása|Új telepítés|A sysPass le van állítva, és saját biztonsági mentést készítettem.|Világos|Sötét|Lista|Kártyák|Összes|Törlés|Szerkesztés|Generálás|Nyelv|Megjelenés|Lejárat|Megerősítés|Bezárás|A művelet nem fejezhető be.|Betöltés …|Bejelentkezés védelme|Hitelesítő alkalmazás|Beállítás|Titok|Letöltés|Feltöltés|Exportálás|Importálás",
  fr_FR:
    "Comptes|Favoris|Catégories|Clients|Étiquettes|Utilisateurs|Groupes|Profils|Paramètres|Sécurité|Activité|Sauvegardes|Se connecter|Se déconnecter|Identifiant|Mot de passe|Rechercher des comptes …|Nouveau compte|Enregistrer|Annuler|Nom|Adresse|Notes|Catégorie|Client|Groupe|Copier|Afficher|Historique|Fichiers|Autorisations|Partages|Aucune entrée pour le moment|Un espace sûr pour toutes vos données confidentielles.|Heureux de vous revoir.|Connectez-vous pour ouvrir votre coffre.|Se connecter avec une clé d’accès|Code de vérification|Continuer|Configurer nodePass|Configurez nodePass ou importez vos données sysPass.|Jeton de configuration|Ancien mot de passe maître|Importer sysPass|Nouvelle installation|sysPass est arrêté et j’ai créé ma propre sauvegarde.|Clair|Sombre|Liste|Cartes|Tous|Supprimer|Modifier|Générer|Langue|Apparence|Expiration|Confirmer|Fermer|Impossible de terminer cette action.|Chargement …|Protection de connexion|Application d’authentification|Configurer|Secret|Télécharger|Envoyer|Exporter|Importer",
  pl_PL:
    "Konta|Ulubione|Kategorie|Klienci|Tagi|Użytkownicy|Grupy|Profile|Ustawienia|Bezpieczeństwo|Aktywność|Kopie zapasowe|Zaloguj się|Wyloguj się|Nazwa użytkownika|Hasło|Szukaj kont …|Nowe konto|Zapisz|Anuluj|Nazwa|Adres|Notatki|Kategoria|Klient|Grupa|Kopiuj|Pokaż|Historia|Pliki|Uprawnienia|Udostępnienia|Brak wpisów|Bezpieczne miejsce na poufne dane.|Witaj ponownie.|Zaloguj się, aby otworzyć sejf.|Zaloguj się kluczem dostępu|Kod weryfikacyjny|Kontynuuj|Konfiguracja nodePass|Skonfiguruj nodePass lub zaimportuj swoje dane sysPass.|Token konfiguracji|Poprzednie hasło główne|Importuj sysPass|Nowa instalacja|sysPass jest zatrzymany i utworzyłem własną kopię zapasową.|Jasny|Ciemny|Lista|Karty|Wszystkie|Usuń|Edytuj|Generuj|Język|Wygląd|Ważność|Potwierdź|Zamknij|Nie można wykonać operacji.|Wczytywanie …|Ochrona logowania|Aplikacja uwierzytelniająca|Skonfiguruj|Sekret|Pobierz|Prześlij|Eksportuj|Importuj",
  ru_RU:
    "Учётные записи|Избранное|Категории|Клиенты|Метки|Пользователи|Группы|Профили|Настройки|Безопасность|Действия|Резервные копии|Войти|Выйти|Имя пользователя|Пароль|Поиск записей …|Новая запись|Сохранить|Отмена|Название|Адрес|Заметки|Категория|Клиент|Группа|Копировать|Показать|История|Файлы|Разрешения|Общий доступ|Записей пока нет|Надёжное место для конфиденциальных данных.|С возвращением.|Войдите, чтобы открыть хранилище.|Войти с ключом доступа|Код подтверждения|Продолжить|Настройка nodePass|Настройте nodePass или импортируйте данные sysPass.|Токен настройки|Прежний мастер-пароль|Импортировать sysPass|Новая установка|sysPass остановлен, и я создал собственную резервную копию.|Светлая|Тёмная|Список|Карточки|Все|Удалить|Изменить|Создать|Язык|Оформление|Срок действия|Подтвердить|Закрыть|Не удалось выполнить действие.|Загрузка …|Защита входа|Приложение аутентификации|Настроить|Секрет|Скачать|Загрузить|Экспорт|Импорт",
  nl_NL:
    "Accounts|Favorieten|Categorieën|Klanten|Labels|Gebruikers|Groepen|Profielen|Instellingen|Beveiliging|Activiteit|Back-ups|Aanmelden|Afmelden|Gebruikersnaam|Wachtwoord|Accounts doorzoeken …|Nieuw account|Opslaan|Annuleren|Naam|Adres|Notities|Categorie|Klant|Groep|Kopiëren|Tonen|Geschiedenis|Bestanden|Rechten|Delen|Nog geen items|Een veilige plek voor alles wat vertrouwelijk is.|Welkom terug.|Meld je aan om je kluis te openen.|Aanmelden met een toegangssleutel|Verificatiecode|Doorgaan|nodePass instellen|Stel nodePass in of importeer je sysPass-gegevens.|Installatietoken|Vorig hoofdwachtwoord|sysPass importeren|Nieuwe installatie|sysPass is gestopt en ik heb zelf een back-up gemaakt.|Licht|Donker|Lijst|Kaarten|Alle|Verwijderen|Bewerken|Genereren|Taal|Weergave|Vervaldatum|Bevestigen|Sluiten|De actie kon niet worden voltooid.|Laden …|Aanmeldbeveiliging|Authenticator-app|Instellen|Geheim|Downloaden|Uploaden|Exporteren|Importeren",
  pt_BR:
    "Contas|Favoritos|Categorias|Clientes|Etiquetas|Usuários|Grupos|Perfis|Configurações|Segurança|Atividade|Backups|Entrar|Sair|Usuário|Senha|Pesquisar contas …|Nova conta|Salvar|Cancelar|Nome|Endereço|Notas|Categoria|Cliente|Grupo|Copiar|Mostrar|Histórico|Arquivos|Permissões|Compartilhamentos|Ainda não há registros|Um lugar seguro para tudo que é confidencial.|Boas-vindas de volta.|Entre para abrir seu cofre.|Entrar com uma chave de acesso|Código de verificação|Continuar|Configurar o nodePass|Configure o nodePass ou importe seus dados do sysPass.|Token de configuração|Senha mestra anterior|Importar sysPass|Nova instalação|O sysPass está parado e criei meu próprio backup.|Claro|Escuro|Lista|Cartões|Todos|Excluir|Editar|Gerar|Idioma|Aparência|Validade|Confirmar|Fechar|Não foi possível concluir a ação.|Carregando …|Proteção de acesso|Aplicativo autenticador|Configurar|Segredo|Baixar|Enviar|Exportar|Importar",
  it_IT:
    "Account|Preferiti|Categorie|Clienti|Etichette|Utenti|Gruppi|Profili|Impostazioni|Sicurezza|Attività|Backup|Accedi|Esci|Nome utente|Password|Cerca account …|Nuovo account|Salva|Annulla|Nome|Indirizzo|Note|Categoria|Cliente|Gruppo|Copia|Mostra|Cronologia|File|Permessi|Condivisioni|Nessuna voce presente|Un posto sicuro per tutti i dati riservati.|Bentornato.|Accedi per aprire la cassaforte.|Accedi con una chiave di accesso|Codice di verifica|Continua|Configura nodePass|Configura nodePass o importa i tuoi dati sysPass.|Token di configurazione|Password principale precedente|Importa sysPass|Nuova installazione|sysPass è fermo e ho creato una mia copia di sicurezza.|Chiaro|Scuro|Elenco|Schede|Tutti|Elimina|Modifica|Genera|Lingua|Aspetto|Scadenza|Conferma|Chiudi|Impossibile completare l’azione.|Caricamento …|Protezione accesso|App di autenticazione|Configura|Segreto|Scarica|Carica|Esporta|Importa",
  da: "Konti|Favoritter|Kategorier|Kunder|Mærker|Brugere|Grupper|Profiler|Indstillinger|Sikkerhed|Aktivitet|Sikkerhedskopier|Log ind|Log ud|Brugernavn|Adgangskode|Søg i konti …|Ny konto|Gem|Annuller|Navn|Adresse|Noter|Kategori|Kunde|Gruppe|Kopiér|Vis|Historik|Filer|Tilladelser|Delinger|Ingen poster endnu|Et sikkert sted til alt fortroligt.|Velkommen tilbage.|Log ind for at åbne din boks.|Log ind med en adgangsnøgle|Bekræftelseskode|Fortsæt|Konfigurer nodePass|Konfigurer nodePass, eller importer dine sysPass-data.|Opsætningstoken|Tidligere hovedadgangskode|Importer sysPass|Ny installation|sysPass er stoppet, og jeg har oprettet min egen sikkerhedskopi.|Lys|Mørk|Liste|Kort|Alle|Slet|Rediger|Generer|Sprog|Udseende|Udløb|Bekræft|Luk|Handlingen kunne ikke gennemføres.|Indlæser …|Loginbeskyttelse|Godkendelsesapp|Konfigurer|Hemmelighed|Download|Upload|Eksportér|Importér",
  fo: "Kontur|Yndis|Bólkar|Kundar|Merki|Brúkarar|Brúkarabólkar|Vangamyndir|Uppseting|Trygd|Virksemi|Trygdaravrit|Rita inn|Rita út|Brúkaranavn|Loyniorð|Leita í kontum …|Nýggj konta|Goym|Angra|Navn|Bústaður|Notur|Bólkur|Kundi|Brúkarabólkur|Avrita|Vís|Søga|Fílur|Heimildir|Deilingar|Eingin færsla enn|Eitt trygt stað til trúnaðarupplýsingar.|Vælkomin aftur.|Rita inn fyri at lata hválvið upp.|Rita inn við atgongulykli|Váttanarkota|Halt fram|Set nodePass upp|Set nodePass upp ella flyt tínar sysPass-dátur inn.|Uppsetingartekin|Fyrra høvuðsloyniorð|Flyt sysPass inn|Nýggj innlegging|sysPass er steðgað, og eg havi gjørt mítt egna trygdaravrit.|Ljóst|Myrkt|Listi|Kort|Øll|Strika|Broyt|Ger|Mál|Útsjónd|Gildislok|Vátta|Lat aftur|Gerðin kundi ikki fullførast.|Lesur …|Innritingartrygd|Váttanarforrit|Set upp|Loyndarmál|Tak niður|Legg upp|Flyt út|Flyt inn",
  ja_JP:
    "アカウント|お気に入り|カテゴリー|顧客|タグ|ユーザー|グループ|プロファイル|設定|セキュリティ|操作履歴|バックアップ|ログイン|ログアウト|ユーザー名|パスワード|アカウントを検索 …|新しいアカウント|保存|キャンセル|名前|アドレス|メモ|カテゴリー|顧客|グループ|コピー|表示|変更履歴|ファイル|権限|共有|まだ登録されていません|機密情報のための安全な保管場所。|おかえりなさい。|ログインして保管庫を開きます。|パスキーでログイン|確認コード|続ける|nodePassの初期設定|nodePassを設定するか、sysPassのデータをインポートします。|設定トークン|以前のマスターパスワード|sysPassをインポート|新規インストール|sysPassを停止し、自分でバックアップを作成しました。|ライト|ダーク|一覧|カード|すべて|削除|編集|生成|言語|外観|有効期限|確認|閉じる|操作を完了できませんでした。|読み込み中 …|ログイン保護|認証アプリ|設定する|機密情報|ダウンロード|アップロード|エクスポート|インポート",
};
export const messages = Object.fromEntries(
  Object.entries(rows).map(([locale, row]) => {
    const values = row.split("|");
    if (values.length !== keys.length)
      throw new Error(
        `Incomplete translation: ${locale} (${values.length}/${keys.length})`,
      );
    return [
      locale,
      {
        ...Object.fromEntries(keys.map((key, i) => [key, values[i]!])),
        ...extraMessages[locale],
        ...presetMessages[locale],
        ...controlMessages[locale],
        ...fieldMessages[locale],
        ...setupMessages[locale],
        ...setupErrorMessages[locale],
        ...setupCompatibilityMessages[locale],
        ...setupMigrationMessages[locale],
        ...shareMessages[locale],
        ...updateMessages[locale],
        ...releaseMessages[locale],
        ...userGroupMessages[locale],
        ...accountAccessMessages[locale],
        ...profilePermissionMessages[locale],
        ...userManagementMessages[locale],
        ...backupMessages[locale],
        ...confirmationMessages[locale],
        ...sessionMessages[locale],
        ...eventMessages[locale],
        backToLogin: backToLoginLabels[locale as Language],
      },
    ];
  }),
);
export const i18n = createI18n({
  legacy: true,
  locale: "de_DE",
  fallbackLocale: false,
  messages,
  missingWarn: true,
});
