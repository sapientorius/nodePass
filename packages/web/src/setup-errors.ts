import type { ApiFailure } from "./api";

const germanAdminReasons: Record<string, string> = {
  not_found:
    "In der importierten sysPass-Datenbank wurde kein Benutzer mit diesem Anmeldenamen gefunden. Verwende den sysPass-Anmeldenamen, nicht den Anzeigenamen. Prüfe auch, ob der Export den aktuellen Benutzerstand enthält.",
  ambiguous:
    "In der importierten sysPass-Datenbank gibt es mehrere Benutzer mit diesem Anmeldenamen. Für die Übernahme wird ein eindeutig zuordenbarer lokaler Anwendungsadministrator benötigt.",
  disabled:
    "Dieser Benutzer ist in der importierten sysPass-Datenbank gesperrt. Verwende einen aktiven lokalen sysPass-Anwendungsadministrator oder einen aktuellen Export mit freigeschaltetem Benutzer.",
  not_application_admin:
    "Dieser Benutzer hat in der importierten sysPass-Datenbank keine Anwendungsadmin-Rechte. Kontenadmin-Rechte allein reichen nicht aus. Verwende einen lokalen sysPass-Anwendungsadministrator.",
  external_auth:
    "Dieser Benutzer ist in der importierten sysPass-Datenbank als LDAP-Benutzer markiert. Die Übernahme benötigt einen lokalen sysPass-Anwendungsadministrator mit dessen lokalem Login-Passwort.",
  password_rejected:
    "Der lokale sysPass-Anwendungsadministrator wurde gefunden und hat die erforderlichen Rechte. Sein Login-Passwort konnte jedoch nicht gegen den importierten Passwort-Hash bestätigt werden. Maßgeblich ist das Login-Passwort zum Zeitpunkt des Exports. Das Master-Passwort wird erst danach separat geprüft.",
};

const german: Record<string, string> = {
  SETUP_ADMIN_REQUIRED:
    "Die bisherigen sysPass-Admin-Zugangsdaten konnten nicht bestätigt werden. Verwende den bestehenden Benutzernamen und das bisherige Login-Passwort eines aktiven lokalen sysPass-Anwendungsadministrators. Die Benutzer werden übernommen; neue nodePass-Zugangsdaten berechtigen nicht zur Übernahme.",
  DUMP_SYNTAX:
    "Der SQL-Export enthält eine nicht unterstützte oder unvollständige Anweisung. Bitte einen vollständigen, entpackten SQL-Datenbankexport mit INSERT INTO … VALUES hochladen.",
  DUMP_ENCODING:
    "Der Export enthält Binärdaten oder ungültiges UTF-8. Bitte erneut mit --default-character-set=utf8mb4 --hex-blob exportieren. Binärdaten müssen als Hexwerte vorliegen.",
  DUMP_SIZE:
    "Der SQL-Export überschreitet 64 MiB. Für größere Datenbanken bitte die direkte Datenbankübernahme verwenden.",
  DUMP_OPERATION:
    "Der Export enthält eine nicht unterstützte SQL-Anweisung. Bekannte Export-Metadaten werden übersprungen; Datenänderungen und unbekannte Befehle können nicht stillschweigend ausgelassen werden.",
  DUMP_ALTER:
    "Der Export enthält eine nicht unterstützte Strukturänderung. Index- und Fremdschlüsseldefinitionen sowie passende AUTO_INCREMENT-Angaben werden bereits berücksichtigt. Andere ALTER-TABLE-Änderungen können nicht ungeprüft übersprungen werden.",
  DUMP_TABLE:
    "Der Export enthält unbekannte Tabellen oder Views. Unterstützt wird das ursprüngliche Schema von sysPass 3.2.11.",
  DUMP_COLUMNS:
    "Der Export enthält unbekannte, doppelte oder ungültige Spalten. Bitte das Schema von sysPass 3.2.11 verwenden.",
  DUMP_HEX:
    "Der Export enthält einen ungültigen Hexwert. Bitte erneut mit --hex-blob exportieren.",
  DUMP_ROWS:
    "Der Export überschreitet 200.000 Datensätze pro Tabelle. Bitte die direkte Datenbankübernahme verwenden.",
  DUMP_EMPTY:
    "Der SQL-Export enthält keine importierbaren Datensätze. Bitte die gesamte Datenbank einschließlich Daten exportieren.",
  CONFIG_XML:
    "Die config.xml ist kein gültiges XML oder überschreitet 1 MB. Bitte die ursprüngliche sysPass-Datei hochladen. Dokumenttypen und Entitätsdefinitionen sind nicht erlaubt.",
  CONFIG_ROOT:
    "In der Konfiguration fehlt das <config>-Wurzelelement. Bitte die ursprüngliche sysPass config.xml hochladen.",
  CONFIG_VALUE:
    "Die Struktur eines Konfigurationswertes wird nicht unterstützt. Bitte die ursprüngliche sysPass config.xml hochladen.",
  SETUP_DATABASE_UNAVAILABLE:
    "Die Datenbank ist nicht erreichbar oder die Verbindung wurde unterbrochen. Bitte Datenbankcontainer und Verbindungseinstellungen prüfen.",
  SETUP_DATABASE_ACCESS:
    "Der Datenbankzugriff wurde verweigert. Bitte Zugangsdaten und Datenbankberechtigungen prüfen.",
  SETUP_DUPLICATE_DATA:
    "Der Export enthält doppelte Werte für einen eindeutigen Datenbankschlüssel. Bitte einen vollständigen, konsistenten sysPass-Export verwenden.",
  SETUP_DATA_LENGTH:
    "Ein Wert im Export überschreitet die unterstützte Spaltenlänge. Bitte das Schema von sysPass 3.2.11 prüfen.",
  SETUP_REQUIRED_VALUE:
    "Im Export fehlt ein erforderlicher Datenbankwert oder eine Spalte. Bitte einen vollständigen sysPass-Export verwenden.",
  SETUP_DATA_ENCODING:
    "Ein Wert hat einen inkompatiblen Datentyp oder eine ungültige Kodierung. Bitte erneut mit UTF-8 und --hex-blob exportieren.",
  SETUP_STORAGE_ACCESS:
    "Das Datenverzeichnis ist nicht beschreibbar. Bitte Berechtigungen und Einbindung des Datenvolumes prüfen.",
  SETUP_STORAGE_FULL:
    "Das Datenvolume ist voll. Bitte vor einem erneuten Versuch Speicherplatz freigeben.",
  SETUP_INTERNAL:
    "Die Einrichtung konnte nicht abgeschlossen werden. Die Fehlerreferenz hilft bei der Zuordnung in den Anwendungslogs.",
  FILE_READ:
    "Die Datei konnte nicht gelesen werden. Bitte die Datei erneut auswählen.",
};

export function setupErrorMessage(failure: ApiFailure, locale: string): string {
  const reason = failure.details?.reason;
  if (
    locale === "de_DE" &&
    failure.code === "SETUP_ADMIN_REQUIRED" &&
    typeof reason === "string" &&
    Object.hasOwn(germanAdminReasons, reason)
  )
    return germanAdminReasons[reason]!;
  return locale === "de_DE" && failure.code && german[failure.code]
    ? german[failure.code]!
    : failure.message;
}

export function setupErrorContext(failure: ApiFailure, locale: string): string {
  const labels: Record<string, string> =
    locale === "de_DE"
      ? {
          line: "SQL-Zeile",
          row: "Datensatz/Batch ab",
          table: "Tabelle",
          column: "Spalte",
          columns: "Spalten",
          id: "ID",
          userId: "Benutzer-ID",
          operation: "SQL-Befehl",
        }
      : {
          line: "SQL line",
          row: "Row/batch from",
          table: "Table",
          column: "Column",
          columns: "Columns",
          id: "ID",
          userId: "User ID",
          operation: "SQL command",
        };
  return Object.entries(failure.details ?? {})
    .filter(([key]) => Object.hasOwn(labels, key))
    .map(
      ([key, value]) =>
        `${labels[key]}: ${Array.isArray(value) ? value.join(", ") : String(value)}`,
    )
    .join(" · ");
}
