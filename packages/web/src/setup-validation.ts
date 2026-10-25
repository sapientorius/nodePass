import { assessPassword } from "./password-policy";

export type SetupMode = "fresh" | "migrate";
export interface SetupInput {
  mode: SetupMode;
  setupToken: string;
  name: string;
  login: string;
  password: string;
  masterPassword: string;
  maintenance: boolean;
}
export type SetupField = Exclude<keyof SetupInput, "mode">;
export interface SetupIssue {
  key:
    | "setupRequiredField"
    | "setupMaxLength"
    | "setupMaxBytes"
    | "setupLoginHint"
    | "setupPasswordHint";
  max?: number;
}

export function setupIssues(input: SetupInput) {
  const issues: Partial<Record<SetupField, SetupIssue>> = {};
  const required = (
    field: Exclude<SetupField, "maintenance">,
    max?: number,
  ) => {
    const value = input[field];
    if (
      !value ||
      (["name", "login", "setupToken"].includes(field) && !value.trim())
    )
      issues[field] = { key: "setupRequiredField" };
    else if (max && value.length > max)
      issues[field] = { key: "setupMaxLength", max };
  };
  required("setupToken");
  required("login", input.mode === "fresh" ? 50 : 100);
  required("password", input.mode === "fresh" ? undefined : 4096);
  if (input.mode === "fresh") {
    required("name", 80);
    if (!issues.login && !/^[\p{L}\p{N}_.@-]{1,50}$/u.test(input.login))
      issues.login = { key: "setupLoginHint" };
    if (!issues.password && !assessPassword(input.password).valid)
      issues.password = { key: "setupPasswordHint" };
  } else {
    required("masterPassword", 4096);
    for (const field of ["password", "masterPassword"] as const)
      if (
        !issues[field] &&
        new TextEncoder().encode(input[field]).length > 4096
      )
        issues[field] = { key: "setupMaxBytes", max: 4096 };
    if (!input.maintenance) issues.maintenance = { key: "setupRequiredField" };
  }
  return issues;
}
