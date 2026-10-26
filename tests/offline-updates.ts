/** Test transports never contact GitHub; update protocol cases supply their own fixtures. */
export const offlineUpdates: typeof fetch = async () =>
  new Response("Unavailable in isolated tests", { status: 503 });
