import { fmt } from "@/lib/i18n/config";
import { en } from "@/lib/i18n/dictionaries/en";
import type { ErrorKey } from "@/lib/i18n/dictionaries";

type Vars = Record<string, string | number | null | undefined>;

/**
 * Errors whose messages are safe to show users. They carry a dictionary key
 * (d.errors.*) plus variables so the message is rendered in the requester's
 * language; `message` holds the English text for logs and tests. Kept free
 * of Next.js imports so the standalone worker can use them.
 */
export class UserFacingError extends Error {
  constructor(
    public readonly key: ErrorKey,
    public readonly vars: Vars = {},
  ) {
    super(fmt(en.errors[key], vars));
    this.name = "UserFacingError";
  }
}

export class AuthorizationError extends Error {
  constructor(
    public readonly key: ErrorKey = "forbidden",
    public readonly vars: Vars = {},
  ) {
    super(fmt(en.errors[key], vars));
    this.name = "AuthorizationError";
  }
}
