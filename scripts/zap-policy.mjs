// Reviewed scopes are finite URL sets. Exception metadata never becomes executable regex.
const scopes = new Map([
  [
    "^http://host\\.docker\\.internal:3101/(?:|robots\\.txt|sitemap\\.xml)$",
    new Set([
      "http://host.docker.internal:3101/",
      "http://host.docker.internal:3101/robots.txt",
      "http://host.docker.internal:3101/sitemap.xml",
    ]),
  ],
  [
    "^http://host\\.docker\\.internal:3101/api/v1/?$",
    new Set([
      "http://host.docker.internal:3101/api/v1",
      "http://host.docker.internal:3101/api/v1/",
    ]),
  ],
  [
    "^http://host\\.docker\\.internal:3101/$",
    new Set(["http://host.docker.internal:3101/"]),
  ],
]);

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
      !scopes.has(item.url) ||
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
        scopes.get(item.url).has(alert.url),
    );
  });
}
