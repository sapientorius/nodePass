import { zxcvbn, zxcvbnOptions } from "@zxcvbn-ts/core";
import * as common from "@zxcvbn-ts/language-common";
import * as english from "@zxcvbn-ts/language-en";
import { defaultPolicy, type SecurityPolicy } from "@nodepass/contracts";

zxcvbnOptions.setOptions({
  graphs: common.adjacencyGraphs,
  dictionary: { ...common.dictionary, ...english.dictionary },
  translations: english.translations,
});

export function assessPassword(
  password: string,
  policy: Pick<SecurityPolicy, "minLength" | "minScore"> = defaultPolicy,
) {
  const length = Array.from(password).length;
  const withinBounds =
    length <= 128 && new TextEncoder().encode(password).length <= 512;
  const score = password && withinBounds ? zxcvbn(password).score : 0;
  return {
    length,
    score,
    valid:
      withinBounds && length >= policy.minLength && score >= policy.minScore,
  };
}
