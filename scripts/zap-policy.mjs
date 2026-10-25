export function evaluateAlerts(alerts, exceptions, now = new Date()) {
  if (!Array.isArray(alerts) || !Array.isArray(exceptions))
    throw new Error("Invalid ZAP report or exceptions");
  const ranks = { Informational: 0, Low: 1, Medium: 2, High: 3 };
  for (const item of exceptions) {
    if (
      !item.alertRef ||
      !item.name ||
      !item.reason ||
      !item.owner ||
      !item.url ||
      !item.expiresAt ||
      !Number.isFinite(Date.parse(item.expiresAt))
    )
      throw new Error("Incomplete ZAP exception");
  }
  return alerts.filter((alert) => {
    const risk = ranks[alert.risk];
    if (
      risk === undefined ||
      typeof alert.alertRef !== "string" ||
      typeof alert.url !== "string"
    )
      throw new Error("Unknown ZAP alert format");
    if (risk < 2) return false;
    return !exceptions.some(
      (item) =>
        Date.parse(item.expiresAt) > now.getTime() &&
        alert.alertRef === item.alertRef &&
        alert.name === item.name &&
        new RegExp(item.url).test(alert.url),
    );
  });
}
