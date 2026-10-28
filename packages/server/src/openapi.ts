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
        confirmation = path === "/api/v1/auth/confirm",
        account =
          path === "/api/v1/accounts" || path === "/api/v1/accounts/{id}";
      item[method.toLowerCase()] = {
        operationId: `${method.toLowerCase()}_${path.replace(/\W+/g, "_")}`,
        tags: [path.split("/")[3]],
        security: [{ session: [] }],
        parameters: [
          ...parameters,
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
                    schema: confirmation
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
                      : account
                        ? { $ref: "#/components/schemas/AccountInput" }
                        : { type: "object", additionalProperties: true },
                  },
                },
              },
            }
          : {}),
        responses: {
          "200": {
            description:
              "Operation completed; responses never include password hashes or vault keys.",
          },
          "400": { description: "Input validation failed" },
          "401": { description: "Authentication required" },
          "403": {
            description:
              "Operation denied or MFA required. REAUTHENTICATION_REQUIRED requests confirmation of the current session; CONFIRMATION_INVALID rejects confirmation credentials without ending the session.",
          },
          "404": { description: "Resource unavailable" },
          "409": { description: "Version conflict" },
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
      },
      schemas: { AccountInput: accountInput },
    },
  };
}
