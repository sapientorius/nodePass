import type { Language } from "@nodepass/contracts";

const notices: Record<Language, string> = {
  de_DE:
    "Der Import wurde nur mit sysPass 3.2.11 getestet. Versionsangaben in config.xml blockieren den Import nicht. Datenbankstruktur und verschlüsselte Daten werden vor der Übernahme geprüft.",
  en_US:
    "Import has only been tested with sysPass 3.2.11. Version metadata in config.xml does not block import. Database structure and encrypted data are checked before migration.",
  es_ES:
    "La importación solo se ha probado con sysPass 3.2.11. Las versiones de config.xml no bloquean la importación. La estructura de la base de datos y los datos cifrados se comprueban antes de migrar.",
  ca_ES:
    "La importació només s’ha provat amb sysPass 3.2.11. Les versions de config.xml no bloquegen la importació. L’estructura de la base de dades i les dades xifrades es comproven abans de migrar.",
  hu_HU:
    "Az importálást csak a sysPass 3.2.11 verzióval teszteltük. A config.xml verzióadatai nem tiltják az importálást. Az adatbázis szerkezetét és a titkosított adatokat az áttelepítés előtt ellenőrizzük.",
  fr_FR:
    "L’importation a uniquement été testée avec sysPass 3.2.11. Les versions dans config.xml ne bloquent pas l’importation. La structure de la base de données et les données chiffrées sont vérifiées avant la migration.",
  pl_PL:
    "Import przetestowano tylko z sysPass 3.2.11. Wersje w config.xml nie blokują importu. Struktura bazy danych i zaszyfrowane dane są sprawdzane przed migracją.",
  ru_RU:
    "Импорт проверен только с sysPass 3.2.11. Версии в config.xml не блокируют импорт. Структура базы данных и зашифрованные данные проверяются перед переносом.",
  nl_NL:
    "Importeren is alleen getest met sysPass 3.2.11. Versiegegevens in config.xml blokkeren de import niet. De databasestructuur en versleutelde gegevens worden vóór de migratie gecontroleerd.",
  pt_BR:
    "A importação foi testada apenas com sysPass 3.2.11. As versões em config.xml não bloqueiam a importação. A estrutura do banco de dados e os dados criptografados são verificados antes da migração.",
  it_IT:
    "L’importazione è stata testata solo con sysPass 3.2.11. Le versioni in config.xml non bloccano l’importazione. La struttura del database e i dati crittografati vengono verificati prima della migrazione.",
  da: "Import er kun testet med sysPass 3.2.11. Versionsoplysninger i config.xml blokerer ikke importen. Databasestrukturen og krypterede data kontrolleres før migreringen.",
  fo: "Innflyting er bert roynd við sysPass 3.2.11. Útgávuupplýsingar í config.xml forða ikki innflyting. Bygnaðurin í dátugrunninum og bronglaðar dátur verða kannað undan flytingini.",
  ja_JP:
    "インポートはsysPass 3.2.11でのみテスト済みです。config.xmlのバージョン情報でインポートが拒否されることはありません。移行前にデータベース構造と暗号化データを検証します。",
};

export const setupCompatibilityMessages = Object.fromEntries(
  Object.entries(notices).map(([locale, notice]) => [
    locale,
    { setupCompatibilityNotice: notice },
  ]),
);
