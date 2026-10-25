import { BadRequest, Forbidden, FeathersError } from "@feathersjs/errors";

/** Only static messages and bounded metadata may cross the setup/log boundary. */
export class SetupInputError extends BadRequest {
  constructor(
    readonly setupCode: string,
    message: string,
    details: Record<string, unknown> = {},
  ) {
    super(message, details);
  }
}
export class SetupAccessError extends Forbidden {
  constructor(
    readonly setupCode: string,
    message: string,
    details: Record<string, unknown> = {},
  ) {
    super(message, details);
  }
}

/** Setup-token protected diagnostics; no account identifiers or hash values. */
export const setupAdminMessages = {
  not_found:
    "No user with this login exists in the imported sysPass database. Enter the sysPass login name, not the display name. The imported export may contain an older user state.",
  ambiguous:
    "More than one user matches this login in the imported sysPass database. An unambiguous local application administrator is required.",
  disabled:
    "This user is disabled in the imported sysPass database. Use an active local sysPass application administrator or a current export with the intended user enabled.",
  not_application_admin:
    "This user is not an application administrator in the imported sysPass database. Account administrator rights alone are insufficient. Use a local sysPass application administrator.",
  external_auth:
    "This user is marked as an LDAP user in the imported sysPass database. The takeover requires a local sysPass application administrator and its local login password.",
  password_rejected:
    "The local sysPass application administrator was found and has the required rights, but its login password could not be verified against the imported password hash. Use the login password from the time of the export. The master password is checked separately afterwards.",
} as const;

/** Fixed SQL keywords only; never echo arbitrary tokens from an uploaded dump. */
export const dumpOperations: ReadonlySet<string> = new Set([
  "START",
  "BEGIN",
  "COMMIT",
  "ROLLBACK",
  "ALTER",
  "INSERT",
  "UPDATE",
  "DELETE",
  "REPLACE",
  "SELECT",
  "LOAD",
  "CREATE",
  "DROP",
  "CALL",
  "GRANT",
  "REVOKE",
  "DELIMITER",
  "UNKNOWN",
]);

const driverFailures: Record<string, [string, string]> = {
  ECONNREFUSED: [
    "SETUP_DATABASE_UNAVAILABLE",
    "The database is unreachable. Check the database container and connection settings.",
  ],
  ECONNRESET: [
    "SETUP_DATABASE_UNAVAILABLE",
    "The database connection was interrupted. Check the database container.",
  ],
  ETIMEDOUT: [
    "SETUP_DATABASE_UNAVAILABLE",
    "The database connection timed out. Check the database container and connection settings.",
  ],
  ER_ACCESS_DENIED_ERROR: [
    "SETUP_DATABASE_ACCESS",
    "Database access was denied. Check the configured database credentials and permissions.",
  ],
  ER_DBACCESS_DENIED_ERROR: [
    "SETUP_DATABASE_ACCESS",
    "Access to the target database was denied. Check the database permissions.",
  ],
  ER_DUP_ENTRY: [
    "SETUP_DUPLICATE_DATA",
    "The dump contains duplicate values for a unique database key. Use a consistent, complete sysPass export.",
  ],
  ER_DATA_TOO_LONG: [
    "SETUP_DATA_LENGTH",
    "A dump value exceeds the supported column size. Check that the dump uses the sysPass 3.2.11 schema.",
  ],
  ER_BAD_NULL_ERROR: [
    "SETUP_REQUIRED_VALUE",
    "A required database value is missing from the dump. Use a complete sysPass export.",
  ],
  ER_NO_DEFAULT_FOR_FIELD: [
    "SETUP_REQUIRED_VALUE",
    "A required database column is missing from the dump. Use a complete sysPass export.",
  ],
  ER_TRUNCATED_WRONG_VALUE: [
    "SETUP_DATA_ENCODING",
    "A dump value has an incompatible database type or encoding. Export again with UTF-8 and --hex-blob.",
  ],
  ER_TRUNCATED_WRONG_VALUE_FOR_FIELD: [
    "SETUP_DATA_ENCODING",
    "A dump value has an incompatible database type or encoding. Export again with UTF-8 and --hex-blob.",
  ],
  EACCES: [
    "SETUP_STORAGE_ACCESS",
    "The application cannot access its data directory. Check the data volume permissions.",
  ],
  EROFS: [
    "SETUP_STORAGE_ACCESS",
    "The data directory is read-only. Mount a writable data volume.",
  ],
  ENOSPC: [
    "SETUP_STORAGE_FULL",
    "The data volume is full. Free disk space before retrying.",
  ],
};

export function setupFailure(error: unknown) {
  const e =
    error && typeof error === "object"
      ? (error as { code?: unknown; data?: unknown })
      : {};
  const driver =
    typeof e.code === "string" ? driverFailures[e.code] : undefined;
  const input =
    error instanceof SetupInputError || error instanceof SetupAccessError;
  const validation =
    error instanceof FeathersError && error.code >= 400 && error.code < 500;
  const details: Record<string, unknown> = {};
  if (validation && e.data && typeof e.data === "object") {
    for (const [key, value] of Object.entries(e.data)) {
      if (
        error instanceof SetupAccessError &&
        key === "reason" &&
        typeof value === "string" &&
        Object.hasOwn(setupAdminMessages, value)
      )
        details.reason = value;
      if (
        key === "operation" &&
        typeof value === "string" &&
        dumpOperations.has(value)
      )
        details.operation = value;
      if (
        ["id", "userId", "line", "row"].includes(key) &&
        Number.isSafeInteger(value) &&
        Number(value) >= 0
      )
        details[key] = value;
      if (
        ["table", "column"].includes(key) &&
        typeof value === "string" &&
        /^[A-Za-z_][A-Za-z0-9_]{0,63}$/.test(value)
      )
        details[key] = value;
      if (key === "columns" && Array.isArray(value))
        details.columns = value
          .filter(
            (v): v is string =>
              typeof v === "string" &&
              /^[A-Za-z_][A-Za-z0-9_]{0,63}\.[A-Za-z_][A-Za-z0-9_]{0,63}$/.test(
                v,
              ),
          )
          .slice(0, 50);
    }
  }
  return {
    code: input
      ? error.setupCode
      : (driver?.[0] ?? (validation ? "SETUP_VALIDATION" : "SETUP_INTERNAL")),
    message:
      input || validation
        ? error.message
        : (driver?.[1] ??
          "The setup could not be completed. Check the application logs using the error reference."),
    ...(Object.keys(details).length ? { details } : {}),
  };
}
