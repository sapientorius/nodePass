import { cp, mkdir } from "node:fs/promises";
const root = new URL("../", import.meta.url);
await mkdir(new URL("packages/server/dist/server/resources/", root), {
  recursive: true,
});
await cp(
  new URL("packages/server/resources/", root),
  new URL("packages/server/dist/server/resources/", root),
  { recursive: true },
);
