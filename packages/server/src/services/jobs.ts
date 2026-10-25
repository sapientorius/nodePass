import { getSetting, putSetting, type Database } from "../db.js";
import type { Integrations } from "./integrations.js";
export async function deliverBatch(
  db: Database,
  integrations: Pick<Integrations, "syslog" | "mail">,
): Promise<void> {
  const last = await getSetting(db, "notificationCursor", 0);
  const events = await db("nodepass_audit")
    .where("id", ">", last)
    .orderBy("id")
    .limit(50);
  for (const event of events) {
    await integrations.syslog(event.action, event.userId, event.target);
    if (/auth\.failed|security\.|accounts\.export|setup\./.test(event.action))
      await integrations.mail(
        "nodePass · " + event.action,
        "Event: " +
          event.action +
          "\nUser: " +
          (event.userId ?? "-") +
          "\nTarget: " +
          (event.target ?? "-") +
          "\nTime: " +
          event.date.toISOString(),
      );
    await putSetting(db, "notificationCursor", Number(event.id));
  }
  await db("nodepass_challenges").where("expiresAt", "<", Date.now()).delete();
  await db("nodepass_limits")
    .where("resetAt", "<", Date.now() - 86400000)
    .delete();
  await db("nodepass_sessions")
    .where("createdAt", "<", Date.now() - 86400000)
    .delete();
}
/** One process, at-least-once delivery; never advance the cursor after failed delivery. */
export function jobs(
  db: Database,
  integrations: Integrations,
): () => Promise<void> {
  let active: Promise<void> | undefined,
    stopped = false;
  const tick = () => {
    if (active || stopped) return;
    active = deliverBatch(db, integrations)
      .catch(() => {
        console.error(JSON.stringify({ event: "background.delivery.failed" }));
      })
      .finally(() => {
        active = undefined;
      });
  };
  const timer = setInterval(tick, 30000);
  timer.unref();
  return async () => {
    stopped = true;
    clearInterval(timer);
    await active;
  };
}
