let csrf = "";
let sessionRevision = 0;
export interface ApiFailure {
  message: string;
  code?: string;
  step?: string;
  reference?: string;
  details?: Record<string, unknown>;
}
export class ApiError extends Error {
  constructor(readonly failure: ApiFailure) {
    super(failure.message);
  }
}
export function setCsrf(value: string): void {
  if (value !== csrf) sessionRevision++;
  csrf = value;
}
async function request(
  path: string,
  method = "GET",
  data?: unknown,
  headers: Record<string, string> = {},
): Promise<Response> {
  const response = await fetch(`/api/v1/${path}`, {
    method,
    credentials: "same-origin",
    headers: {
      ...(data !== undefined ? { "content-type": "application/json" } : {}),
      ...(csrf ? { "x-csrf-token": csrf } : {}),
      ...headers,
    },
    ...(data !== undefined ? { body: JSON.stringify(data) } : {}),
  });
  if (!response.ok) {
    if (response.status === 401)
      window.dispatchEvent(new Event("nodepass-expired"));
    let failure: ApiFailure = { message: "Request failed" };
    try {
      const result = await response.json();
      if (typeof result.message === "string") failure = result;
    } catch {
      /* Do not expose server error bodies. */
    }
    throw new ApiError(failure);
  }
  return response;
}
export async function api<T = any>(
  path: string,
  method = "GET",
  data?: unknown,
  headers: Record<string, string> = {},
): Promise<T> {
  const revision = sessionRevision;
  const response = await request(path, method, data, headers);
  const result =
    response.status === 204 ? (undefined as T) : ((await response.json()) as T);
  if (revision !== sessionRevision)
    throw new Error("Session changed; request discarded");
  return result;
}
export async function download(path: string, data: unknown): Promise<void> {
  const response = await request(path, "POST", data),
    blob = await response.blob(),
    url = URL.createObjectURL(blob),
    anchor = document.createElement("a");
  anchor.href = url;
  anchor.download =
    /filename="([\w.-]+)"/.exec(
      response.headers.get("content-disposition") ?? "",
    )?.[1] ?? "nodepass-export";
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
export function generatePassword(length = 28): string {
  const alphabet =
    "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$%&*+-=?";
  let result = "";
  const max = Math.floor(256 / alphabet.length) * alphabet.length;
  while (result.length < length)
    for (const byte of crypto.getRandomValues(new Uint8Array(length))) {
      if (byte < max) result += alphabet[byte % alphabet.length];
      if (result.length === length) break;
    }
  return result;
}
