import nodemailer from "nodemailer";
import { createSocket } from "node:dgram";
import { isIP } from "node:net";
import { XMLBuilder, XMLParser, XMLValidator } from "fast-xml-parser";
import { BadRequest } from "@feathersjs/errors";
import type { Vault } from "../security/vault.js";
import { audit, type Database, type Row } from "../db.js";
const fields: Record<string, string[]> = {
  smtp: [
    "enabled",
    "host",
    "port",
    "user",
    "password",
    "from",
    "recipients",
    "secure",
  ],
  syslog: ["enabled", "host", "port"],
  wiki: ["enabled", "url", "user", "password"],
  directory: [
    "ldapEnabled",
    "ldapServer",
    "ldapBase",
    "ldapBindUser",
    "ldapBindPass",
    "ldapAds",
    "ldapTlsEnabled",
    "ldapGroup",
    "ldapDefaultGroup",
    "ldapDefaultProfile",
  ],
  sso: [
    "enabled",
    "secret",
    "defaultGroup",
    "defaultProfile",
    "autoProvision",
    "allowedLogins",
  ],
};
const secrets = new Set(["password", "ldapBindPass", "secret"]);
export class Integrations {
  constructor(
    readonly db: Database,
    readonly vault: Vault,
    readonly legacy: Record<string, unknown>,
  ) {}
  async configuration(name: string): Promise<Row> {
    if (!Object.hasOwn(fields, name))
      throw new BadRequest("Unknown integration");
    const legacy = await this.vault.configuration<Row>(
      "legacy-config",
      this.legacy,
    );
    let fallback: Row = {};
    if (name === "directory") fallback = legacy;
    if (name === "smtp")
      fallback = {
        enabled: legacy.mailEnabled === "1",
        host: legacy.mailServer,
        port: Number(legacy.mailPort ?? 587),
        user: legacy.mailUser,
        password: legacy.mailPass,
        from: legacy.mailFrom,
        recipients: legacy.mailRecipients,
        secure: String(legacy.mailSecurity).toLowerCase() === "ssl",
      };
    if (name === "wiki")
      fallback = {
        enabled: legacy.dokuwikiEnabled === "1",
        url: legacy.dokuwikiUrl,
        user: legacy.dokuwikiUser,
        password: legacy.dokuwikiPass,
      };
    if (name === "syslog")
      fallback = {
        enabled: legacy.syslogRemoteEnabled === "1",
        host: legacy.syslogServer,
        port: Number(legacy.syslogPort ?? 514),
      };
    return this.vault.configuration(`integration/${name}`, fallback);
  }
  async view(name: string): Promise<Row> {
    const data = await this.configuration(name);
    return Object.fromEntries(
      fields[name]!.filter((k) => !secrets.has(k))
        .map((k) => [k, data[k] ?? ""])
        .concat(
          fields[name]!.filter((k) => secrets.has(k)).map((k) => [
            `${k}Configured`,
            !!data[k],
          ]),
        ),
    );
  }
  async save(name: string, input: Row, userId: number): Promise<void> {
    const allowed = fields[name];
    if (!allowed || Object.keys(input).some((k) => !allowed.includes(k)))
      throw new BadRequest("Unknown integration field");
    const data = { ...(await this.configuration(name)), ...input };
    for (const flag of ["enabled", "secure", "autoProvision"])
      if (input[flag] !== undefined && typeof input[flag] !== "boolean")
        throw new BadRequest("Invalid integration flag");
    for (const flag of ["ldapEnabled", "ldapTlsEnabled", "ldapAds"])
      if (input[flag] !== undefined && !["0", "1"].includes(input[flag]))
        throw new BadRequest("Invalid directory flag");
    for (const [key, v] of Object.entries(input))
      if (!(
        typeof v === "boolean" ||
        typeof v === "number" ||
        (typeof v === "string" && v.length <= 4000)
      ))
        throw new BadRequest(`Invalid ${key}`);
    if (name === "smtp") {
      if (
        data.enabled &&
        (!/^[a-zA-Z0-9.:[\]-]+$/.test(String(data.host)) ||
          !Number.isInteger(data.port) ||
          data.port < 1 ||
          data.port > 65535 ||
          !/^[^\s@<>]+@[^\s@<>]+$/.test(String(data.from)))
      )
        throw new BadRequest("Invalid mail settings");
      if (
        data.recipients &&
        String(data.recipients)
          .split(",")
          .some((a) => !/^\s*[^\s@<>]+@[^\s@<>]+\s*$/.test(a))
      )
        throw new BadRequest("Invalid mail recipients");
    }
    if (
      name === "syslog" &&
      data.enabled &&
      (!/^[a-zA-Z0-9.:[\]-]+$/.test(String(data.host)) ||
        !Number.isInteger(data.port) ||
        data.port < 1 ||
        data.port > 65535)
    )
      throw new BadRequest("Invalid syslog settings");
    if (name === "wiki" && data.enabled) {
      const url = new URL(String(data.url));
      if (url.protocol !== "https:" || url.username || url.password || url.hash)
        throw new BadRequest("Wiki requires an explicit HTTPS endpoint");
    }
    if (name === "directory" && data.ldapEnabled === "1") {
      const url = new URL(data.ldapServer);
      if (
        !["ldap:", "ldaps:"].includes(url.protocol) ||
        (url.protocol === "ldap:" && data.ldapTlsEnabled !== "1") ||
        !data.ldapBase ||
        !data.ldapBindUser ||
        !data.ldapBindPass
      )
        throw new BadRequest("Directory TLS and bind credentials are required");
    }
    if (
      name === "sso" &&
      data.enabled &&
      (!data.secret || String(data.secret).length < 43)
    )
      throw new BadRequest("SSO requires a random shared secret");
    if (
      name === "sso" &&
      data.enabled &&
      (![true, false, undefined].includes(data.autoProvision) ||
        String(data.allowedLogins ?? "")
          .split(",")
          .some((s) => s.trim() && !/^[\p{L}\p{N}_.@-]{1,50}$/u.test(s.trim())))
    )
      throw new BadRequest("Invalid SSO identity mapping");
    await this.vault.saveConfiguration(`integration/${name}`, data);
    await audit(this.db, userId, `integration.${name}.edit`);
  }
  async mail(subject: string, message: string): Promise<void> {
    const c = await this.configuration("smtp");
    if (!c.enabled) return;
    await this.sendMail(
      c,
      subject,
      message,
      String(c.recipients)
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean),
    );
  }
  /** Explicit single-recipient delivery, independent of the audit recipient list. */
  async mailTo(
    subject: string,
    message: string,
    recipient: string,
  ): Promise<boolean> {
    const c = await this.configuration("smtp");
    if (!c.enabled) return false;
    await this.sendMail(c, subject, message, [recipient]);
    return true;
  }
  private async sendMail(
    c: Row,
    subject: string,
    message: string,
    recipients: string[],
  ): Promise<void> {
    const transport = nodemailer.createTransport({
      host: String(c.host),
      port: Number(c.port),
      secure: !!c.secure,
      requireTLS: !c.secure,
      tls: { rejectUnauthorized: true },
      ...(c.user
        ? { auth: { user: String(c.user), pass: String(c.password) } }
        : {}),
      connectionTimeout: 5000,
      greetingTimeout: 5000,
      socketTimeout: 10000,
      disableFileAccess: true,
      disableUrlAccess: true,
    });
    try {
      const result = await transport.sendMail({
        from: String(c.from),
        to: recipients,
        subject: subject.replace(/[\r\n]/g, " ").slice(0, 150),
        text: message,
        disableFileAccess: true,
        disableUrlAccess: true,
      });
      if (result.rejected?.length || !result.accepted?.length)
        throw new Error("Mail recipient was not accepted");
    } finally {
      transport.close();
    }
  }
  async syslog(
    action: string,
    userId: number | null,
    target: string | null,
  ): Promise<void> {
    const c = await this.configuration("syslog");
    if (!c.enabled) return;
    const socket = createSocket(isIP(c.host) === 6 ? "udp6" : "udp4"),
      data = Buffer.from(
        `<134>1 ${new Date().toISOString()} nodepass nodepass - audit - ${action.replace(/[^a-zA-Z0-9._-]/g, "")} user=${userId ?? "-"} target=${String(target ?? "-").replace(/[^a-zA-Z0-9._-]/g, "")}`,
      );
    try {
      await new Promise<void>((resolve, reject) => {
        socket.once("error", reject);
        socket.send(data, Number(c.port), String(c.host), (e) =>
          e ? reject(e) : resolve(),
        );
      });
    } finally {
      socket.close();
    }
  }
  async wiki(method: "search" | "page", query: string): Promise<unknown> {
    if (!query || query.length > 200)
      throw new BadRequest("Invalid wiki query");
    const c = await this.configuration("wiki");
    if (!c.enabled) throw new BadRequest("Wiki integration is disabled");
    const url = new URL(String(c.url));
    if (url.protocol !== "https:") throw new BadRequest("Wiki TLS required");
    const builder = new XMLBuilder({ ignoreAttributes: false }),
      body = builder.build({
        methodCall: {
          methodName: method === "search" ? "dokuwiki.search" : "wiki.getPage",
          params: { param: { value: { string: query } } },
        },
      });
    const headers: Record<string, string> = { "content-type": "text/xml" };
    if (c.user)
      headers.authorization = `Basic ${Buffer.from(`${c.user}:${c.password}`).toString("base64")}`;
    const response = await fetch(url, {
      method: "POST",
      headers,
      body,
      redirect: "error",
      signal: AbortSignal.timeout(5000),
    });
    if (!response.ok || !response.body)
      throw new BadRequest("Wiki request failed");
    let size = 0;
    const chunks: Buffer[] = [];
    for await (const chunk of response.body) {
      size += chunk.length;
      if (size > 2 * 1024 ** 2) throw new BadRequest("Wiki response too large");
      chunks.push(Buffer.from(chunk));
    }
    const xml = Buffer.concat(chunks).toString();
    if (/<!DOCTYPE|<!ENTITY/i.test(xml) || XMLValidator.validate(xml) !== true)
      throw new BadRequest("Invalid wiki response");
    return new XMLParser({
      ignoreAttributes: true,
      parseTagValue: false,
      processEntities: true,
    }).parse(xml);
  }
}
