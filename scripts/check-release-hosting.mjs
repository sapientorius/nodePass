import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { repository } from "./release-policy.mjs";

// Public metadata only: never grant the publishing workflow an administration token.
const get = async (path) => {
  const response = await fetch(
    `https://api.github.com/repos/${repository}/${path}`,
    {
      headers: { Accept: "application/vnd.github+json" },
      signal: AbortSignal.timeout(20000),
    },
  );
  if (!response.ok)
    throw new Error(
      `Cannot verify release hosting: ${path} (${response.status})`,
    );
  return response.json();
};
export function validateHosting(branch, rules, environment, policies) {
  const required = rules.find(
    (rule) => rule.type === "required_status_checks",
  )?.parameters;
  if (
    !branch.protected ||
    !rules.some((rule) => rule.type === "pull_request") ||
    !required?.strict_required_status_checks_policy ||
    !required.required_status_checks?.some(
      (check) =>
        check.context === "Required release checks" &&
        check.integration_id === 15368,
    )
  )
    throw new Error(
      "main must require pull requests and strict Required release checks from GitHub Actions",
    );
  if (
    !environment.protection_rules?.some(
      (rule) => rule.type === "required_reviewers" && rule.reviewers?.length,
    ) ||
    !environment.deployment_branch_policy?.custom_branch_policies
  )
    throw new Error(
      "A protected release environment with required reviewers is required",
    );
  if (
    !policies.branch_policies?.length ||
    policies.branch_policies.some(
      (policy) => policy.type !== "tag" || policy.name !== "nodepass-v*",
    )
  )
    throw new Error("The release environment must allow only nodepass-v* tags");
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  const [branch, rules, environment, policies] = await Promise.all([
    get("branches/main"),
    get("rules/branches/main"),
    get("environments/release"),
    get("environments/release/deployment-branch-policies"),
  ]);
  validateHosting(branch, rules, environment, policies);
  console.log(
    "Required main rules and release approval environment verified. Separately verify administrator bypass is disabled and immutable releases are enabled.",
  );
}
