import { accountInput, version } from "@nodepass/contracts";
type Route = { path: string; methods: string[] };
/** The same route registry that handles requests supplies the public route inventory. */
export function openApi(
  routes: Route[],
  origin: string,
): Record<string, unknown> {
  const paths: Record<string, Record<string, unknown>> = {};
  for (const route of [
    ...routes,
    ...[
      "accounts",
      "categories",
      "clients",
      "tags",
      "users",
      "groups",
      "profiles",
      "fields",
    ].flatMap((name) => [
      { path: `/api/v1/${name}`, methods: ["GET", "POST"] },
      { path: `/api/v1/${name}/:id`, methods: ["GET", "PATCH", "DELETE"] },
    ]),
  ]) {
    if (!route.path.startsWith("/api/v1/") || route.path.includes("/openapi"))
      continue;
    const path = route.path.replace(/:(\w+)/g, "{$1}"),
      parameters = [...path.matchAll(/\{(\w+)\}/g)].map((m) => ({
        name: m[1],
        in: "path",
        required: true,
        schema: { type: "string" },
      }));
    const item = paths[path] ?? {};
    for (const method of route.methods) {
      if (["HEAD", "OPTIONS"].includes(method)) continue;
      const write = !["GET", "HEAD"].includes(method),
        users = path === "/api/v1/users" || path === "/api/v1/users/{id}",
        members = path === "/api/v1/groups/{id}/members",
        confirmation = path === "/api/v1/auth/confirm",
        restoreConfirmation =
          /^\/api\/v1\/backup-restores\/\{id\}\/confirm$/.test(path),
        restoreStatus = /^\/api\/v1\/backup-restores\/\{id\}\/status$/.test(
          path,
        ),
        account =
          path === "/api/v1/accounts" || path === "/api/v1/accounts/{id}";
      item[method.toLowerCase()] = {
        operationId: `${method.toLowerCase()}_${path.replace(/\W+/g, "_")}`,
        tags: [path.split("/")[3]],
        security: restoreStatus ? [{ backupJobToken: [] }] : [{ session: [] }],
        parameters: [
          ...parameters,
          ...(members
            ? [
                {
                  name: "membership",
                  in: "query",
                  required: true,
                  schema: { type: "string", enum: ["primary", "additional"] },
                },
              ]
            : []),
          ...((path === "/api/v1/backups" || members) && method === "GET"
            ? [
                {
                  name: "skip",
                  in: "query",
                  schema: { type: "integer", minimum: 0, default: 0 },
                },
                {
                  name: "limit",
                  in: "query",
                  schema: {
                    type: "integer",
                    minimum: 1,
                    maximum: 100,
                    default: 25,
                  },
                },
              ]
            : []),
          ...(write
            ? [
                {
                  name: "X-CSRF-Token",
                  in: "header",
                  required: true,
                  schema: { type: "string" },
                },
              ]
            : []),
        ],
        ...(write && method !== "DELETE"
          ? {
              requestBody: {
                required: true,
                content: {
                  "application/json": {
                    schema:
                      confirmation || restoreConfirmation
                        ? {
                            oneOf: [
                              {
                                type: "object",
                                required: ["password"],
                                properties: {
                                  password: {
                                    type: "string",
                                    minLength: 1,
                                    maxLength: 4096,
                                  },
                                },
                                additionalProperties: false,
                              },
                              {
                                type: "object",
                                required: ["code"],
                                properties: {
                                  code: {
                                    type: "string",
                                    minLength: 1,
                                    maxLength: 100,
                                  },
                                },
                                additionalProperties: false,
                              },
                              {
                                type: "object",
                                required: ["challenge", "response"],
                                properties: {
                                  challenge: { type: "string" },
                                  response: { type: "object" },
                                },
                                additionalProperties: false,
                              },
                            ],
                          }
                        : path === "/api/v1/backup-schedule"
                          ? { $ref: "#/components/schemas/BackupScheduleInput" }
                          : /^\/api\/v1\/backup-restores\/\{id\}\/upload$/.test(
                                path,
                              )
                            ? {
                                type: "object",
                                additionalProperties: false,
                                required: ["offset", "content", "final"],
                                properties: {
                                  offset: {
                                    type: "integer",
                                    minimum: 0,
                                    maximum: 4294967296,
                                  },
                                  content: {
                                    type: "string",
                                    contentEncoding: "base64",
                                    maxLength: 11184812,
                                  },
                                  final: { type: "boolean" },
                                },
                              }
                            : /^\/api\/v1\/backup-restores\/\{id\}\/check$/.test(
                                  path,
                                )
                              ? {
                                  type: "object",
                                  additionalProperties: false,
                                  required: ["key"],
                                  properties: {
                                    key: {
                                      type: "string",
                                      writeOnly: true,
                                      minLength: 44,
                                      maxLength: 44,
                                      description:
                                        "Original 32-byte deployment key in canonical Base64. Used in memory only.",
                                    },
                                  },
                                }
                              : /^\/api\/v1\/backup-restores\/\{id\}\/commit$/.test(
                                    path,
                                  )
                                ? {
                                    type: "object",
                                    additionalProperties: false,
                                    required: ["confirmation", "authorization"],
                                    properties: {
                                      confirmation: {
                                        type: "string",
                                        description:
                                          "Exact DELETE AND RESTORE <database> string from the job.",
                                      },
                                      authorization: {
                                        type: "string",
                                        writeOnly: true,
                                        description:
                                          "Single-use grant from this job's confirm endpoint, valid for five minutes.",
                                      },
                                    },
                                  }
                                : path === "/api/v1/backup-restores"
                                  ? {
                                      type: "object",
                                      additionalProperties: false,
                                      properties: {
                                        name: {
                                          type: "string",
                                          description:
                                            "Managed backup filename. Omit to start a chunked upload.",
                                        },
                                      },
                                    }
                                  : path === "/api/v1/backup-jobs"
                                    ? {
                                        type: "object",
                                        additionalProperties: false,
                                      }
                                    : account
                                      ? {
                                          $ref: "#/components/schemas/AccountInput",
                                        }
                                      : {
                                          type: "object",
                                          additionalProperties: true,
                                        },
                  },
                },
              },
            }
          : {}),
        responses: {
          "200": {
            description: members
              ? "Group members, ordered by name, login and ID. Requires application administrator status or mgmUsers. Includes disabled users; additional memberships exclude the primary group."
              : "Operation completed; responses never include password hashes or vault keys.",
            ...(members
              ? {
                  content: {
                    "application/json": {
                      schema: {
                        type: "object",
                        required: ["total", "limit", "skip", "data"],
                        properties: {
                          total: { type: "integer" },
                          limit: { type: "integer" },
                          skip: { type: "integer" },
                          data: {
                            type: "array",
                            items: { $ref: "#/components/schemas/GroupMember" },
                          },
                        },
                      },
                    },
                  },
                }
              : {}),
            ...(users
              ? {
                  content: {
                    "application/json": {
                      schema:
                        method === "GET" && path === "/api/v1/users"
                          ? {
                              type: "array",
                              items: {
                                $ref: "#/components/schemas/UserSummary",
                              },
                            }
                          : { $ref: "#/components/schemas/UserSummary" },
                    },
                  },
                }
              : {}),
          },
          ...((["/api/v1/backup-jobs", "/api/v1/backup-restores"].includes(
            path,
          ) &&
            method === "POST") ||
          /\/backup-restores\/\{id\}\/(check|commit)$/.test(path)
            ? {
                "202": {
                  description:
                    "Asynchronous job accepted. Poll the corresponding status endpoint.",
                },
              }
            : {}),
          "400": { description: "Input validation failed" },
          "401": { description: "Authentication required" },
          "403": {
            description:
              "Operation denied or MFA required. MFA_REQUIRED requires multi-factor verification or enrollment. REAUTHENTICATION_REQUIRED requests confirmation of the current session; CONFIRMATION_INVALID rejects confirmation credentials without ending the session.",
          },
          "404": { description: "Resource unavailable" },
          "409": { description: "Version conflict" },
          "503": {
            description:
              "Unavailable or MAINTENANCE: application data access is blocked during restore/recovery. Health and capability-protected restore status remain available.",
          },
        },
      };
    }
    paths[path] = item;
  }
  return {
    openapi: "3.1.0",
    info: {
      title: "nodePass API",
      version,
      description:
        "Same-origin REST API. Secrets are available only through explicit audited operations. Use the session CSRF value and exact Origin header for mutations. JSON-RPC compatibility remains at /api.php.",
    },
    servers: [{ url: origin }],
    paths,
    components: {
      securitySchemes: {
        session: { type: "apiKey", in: "cookie", name: "nodepass" },
        backupJobToken: {
          type: "apiKey",
          in: "header",
          name: "X-Backup-Job-Token",
          description:
            "Random status-only capability returned when a restore job is created. Expires 24 hours after completion; never authorizes a mutation.",
        },
      },
      schemas: {
        BackupScheduleInput: {
          type: "object",
          additionalProperties: false,
          required: ["enabled", "days", "time", "timezone", "keep"],
          properties: {
            enabled: { type: "boolean" },
            days: { type: "integer", minimum: 1, maximum: 365 },
            time: { type: "string", pattern: "^(?:[01]\\d|2[0-3]):[0-5]\\d$" },
            timezone: {
              type: "string",
              maxLength: 100,
              description: "IANA timezone",
            },
            keep: {
              type: "integer",
              minimum: 1,
              maximum: 365,
              description: "Retention applies only to automatic backups.",
            },
          },
        },
        AccountInput: accountInput,
        GroupReference: {
          type: "object",
          readOnly: true,
          required: ["id", "name"],
          properties: { id: { type: "integer" }, name: { type: "string" } },
        },
        GroupMember: {
          type: "object",
          additionalProperties: false,
          required: ["id", "name", "login"],
          properties: {
            id: { type: "integer" },
            name: { type: "string" },
            login: { type: "string" },
          },
        },
        UserSummary: {
          type: "object",
          description:
            "Management metadata is returned only to application administrators or users with mgmUsers. It is read-only; writes always recheck current authorization.",
          properties: {
            primaryGroup: {
              oneOf: [
                { $ref: "#/components/schemas/GroupReference" },
                { type: "null" },
              ],
              readOnly: true,
            },
            additionalGroups: {
              type: "array",
              items: { $ref: "#/components/schemas/GroupReference" },
              readOnly: true,
            },
            management: { $ref: "#/components/schemas/UserManagement" },
          },
        },
        UserManagement: {
          type: "object",
          readOnly: true,
          required: ["canEdit", "canResetPassword"],
          properties: {
            canEdit: { type: "boolean" },
            canResetPassword: {
              type: "boolean",
              description:
                "Requires application administrator status or both mgmUsers and mgmUsersResetPassword, plus target scope. Missing reset permission is denied.",
            },
            reason: {
              type: "string",
              enum: [
                "permission",
                "self",
                "administrator",
                "groups",
                "profile",
              ],
            },
          },
        },
      },
    },
  };
}
