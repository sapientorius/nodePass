import { XMLParser, XMLValidator } from "fast-xml-parser";
import { SetupInputError } from "../migration/errors.js";
export type LegacyConfig = Record<string, string | string[]>;
export function parseConfig(xml: string): LegacyConfig {
  if (
    Buffer.byteLength(xml) > 1_000_000 ||
    /<!DOCTYPE|<!ENTITY/i.test(xml) ||
    XMLValidator.validate(xml) !== true
  )
    throw new SetupInputError(
      "CONFIG_XML",
      "Invalid XML configuration. Upload the original sysPass config.xml (up to 1 MB); document types and entities are not allowed.",
    );
  const parsed = new XMLParser({
    ignoreAttributes: true,
    parseTagValue: false,
    processEntities: true,
  }).parse(xml) as { config?: Record<string, unknown> };
  if (!parsed.config || typeof parsed.config !== "object")
    throw new SetupInputError(
      "CONFIG_ROOT",
      "Missing configuration root. Upload the sysPass config.xml with a <config> root element.",
    );
  const result: LegacyConfig = Object.create(null) as LegacyConfig;
  for (const [key, value] of Object.entries(parsed.config)) {
    if (!/^[a-zA-Z][a-zA-Z0-9_]{0,49}$/.test(key))
      throw new SetupInputError(
        "CONFIG_VALUE",
        "Invalid configuration key. Upload the original sysPass config.xml.",
      );
    if (typeof value === "string" || typeof value === "number")
      result[key] = String(value);
    else if (value && typeof value === "object" && "item" in value) {
      const items = (value as { item: unknown }).item;
      if (!(
        typeof items === "string" ||
        (Array.isArray(items) && items.every((v) => typeof v === "string"))
      ))
        throw new SetupInputError(
          "CONFIG_VALUE",
          "Invalid configuration list. Upload the original sysPass config.xml.",
        );
      result[key] = typeof items === "string" ? [items] : (items as string[]);
    } else
      throw new SetupInputError(
        "CONFIG_VALUE",
        "Unsupported configuration value. Upload the original sysPass config.xml.",
      );
  }
  return result;
}
