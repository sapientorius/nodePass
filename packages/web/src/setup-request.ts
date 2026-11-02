import { api, ApiError } from "./api";

/** Bound each HTTP exchange, not the duration of a server-side migration job. */
export async function setupRequest<T = any>(
  path: string,
  method = "GET",
  data?: unknown,
  headers: Record<string, string> = {},
): Promise<T> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 60000);
  try {
    return await api<T>(path, method, data, headers, controller.signal);
  } catch (error) {
    if (controller.signal.aborted)
      throw new ApiError({
        code: "SETUP_RESPONSE_TIMEOUT",
        message:
          "No setup response was received within 60 seconds. The server may still be processing the import. Reload the page to check the installation state before retrying. Keep the database and data volume.",
      });
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}
