import type { Language } from "@nodepass/contracts";

const rows: Record<Language, [string, string, string]> = {
  de_DE: [
    "Exportpasswort",
    "Ursprüngliches sysPass-Masterpasswort",
    "Das Exportpasswort entschlüsselt die XML-Datei; bei unverschlüsselten Dateien bleibt es leer. Für die Kontopasswörter aus sysPass wird zusätzlich das ursprüngliche Masterpasswort benötigt. Bei nodePass-Exporten kann das Masterpasswort leer bleiben.",
  ],
  en_US: [
    "Export password",
    "Original sysPass master password",
    "The export password decrypts the XML file; leave it empty for unencrypted files. Account passwords from sysPass also require the original master password. For nodePass exports, the master password can remain empty.",
  ],
  es_ES: [
    "Contraseña de exportación",
    "Contraseña maestra original de sysPass",
    "La contraseña de exportación descifra el archivo XML; déjela vacía si no está cifrado. Las contraseñas de las cuentas de sysPass también requieren la contraseña maestra original. Para exportaciones de nodePass, la contraseña maestra puede quedar vacía.",
  ],
  ca_ES: [
    "Contrasenya d’exportació",
    "Contrasenya mestra original de sysPass",
    "La contrasenya d’exportació desxifra el fitxer XML; deixeu-la buida si no està xifrat. Les contrasenyes dels comptes de sysPass també requereixen la contrasenya mestra original. Per a exportacions de nodePass, la contrasenya mestra pot quedar buida.",
  ],
  hu_HU: [
    "Exportálási jelszó",
    "Eredeti sysPass mesterjelszó",
    "Az exportálási jelszó fejti vissza az XML-fájlt; titkosítatlan fájlnál hagyja üresen. A sysPass-fiókok jelszavaihoz az eredeti mesterjelszó is szükséges. nodePass-exportnál a mesterjelszó üresen hagyható.",
  ],
  fr_FR: [
    "Mot de passe d’exportation",
    "Mot de passe maître sysPass d’origine",
    "Le mot de passe d’exportation déchiffre le fichier XML ; laissez-le vide pour les fichiers non chiffrés. Les mots de passe des comptes sysPass nécessitent aussi le mot de passe maître d’origine. Pour les exports nodePass, le mot de passe maître peut rester vide.",
  ],
  pl_PL: [
    "Hasło eksportu",
    "Oryginalne hasło główne sysPass",
    "Hasło eksportu odszyfrowuje plik XML; pozostaw je puste dla plików niezaszyfrowanych. Hasła kont sysPass wymagają również oryginalnego hasła głównego. Dla eksportów nodePass hasło główne może pozostać puste.",
  ],
  ru_RU: [
    "Пароль экспорта",
    "Исходный мастер-пароль sysPass",
    "Пароль экспорта расшифровывает XML-файл; для незашифрованных файлов оставьте его пустым. Для паролей учётных записей sysPass также нужен исходный мастер-пароль. Для экспорта nodePass мастер-пароль можно не указывать.",
  ],
  nl_NL: [
    "Exportwachtwoord",
    "Oorspronkelijk sysPass-hoofdwachtwoord",
    "Het exportwachtwoord ontsleutelt het XML-bestand; laat het leeg voor onversleutelde bestanden. Accountwachtwoorden uit sysPass vereisen ook het oorspronkelijke hoofdwachtwoord. Voor nodePass-exports mag het hoofdwachtwoord leeg blijven.",
  ],
  pt_BR: [
    "Senha de exportação",
    "Senha mestra original do sysPass",
    "A senha de exportação descriptografa o arquivo XML; deixe-a vazia para arquivos não criptografados. As senhas das contas do sysPass também exigem a senha mestra original. Para exportações do nodePass, a senha mestra pode ficar vazia.",
  ],
  it_IT: [
    "Password di esportazione",
    "Password principale originale di sysPass",
    "La password di esportazione decifra il file XML; lasciarla vuota per i file non cifrati. Le password degli account sysPass richiedono anche la password principale originale. Per le esportazioni nodePass, la password principale può rimanere vuota.",
  ],
  da: [
    "Eksportadgangskode",
    "Oprindelig sysPass-hovedadgangskode",
    "Eksportadgangskoden dekrypterer XML-filen; lad den være tom for ukrypterede filer. Kontoadgangskoder fra sysPass kræver også den oprindelige hovedadgangskode. Ved nodePass-eksport kan hovedadgangskoden være tom.",
  ],
  fo: [
    "Útflutningsloyniorð",
    "Upprunaligt sysPass-høvuðsloyniorð",
    "Útflutningsloyniorðið avkrypterar XML-fíluna; lat tað standa tómt fyri ókrypteraðar fílur. Kontuloyniorð úr sysPass krevja eisini upprunaliga høvuðsloyniorðið. Fyri nodePass-útflutning kann høvuðsloyniorðið standa tómt.",
  ],
  ja_JP: [
    "エクスポート用パスワード",
    "元のsysPassマスターパスワード",
    "エクスポート用パスワードでXMLファイルを復号します。暗号化されていないファイルでは空欄にしてください。sysPassのアカウントパスワードには元のマスターパスワードも必要です。nodePassのエクスポートではマスターパスワードを空欄にできます。",
  ],
};
export const transferMessages = Object.fromEntries(
  Object.entries(rows).map(([locale, values]) => [
    locale,
    Object.fromEntries(
      [
        "importExportPassword",
        "importMasterPassword",
        "importPasswordHelp",
      ].map((key, index) => [key, values[index]!]),
    ),
  ]),
);
