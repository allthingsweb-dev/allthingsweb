import type { ServerUser } from "@stackframe/stack";

/**
 * Client-safe user type containing only serializable properties
 * needed by dashboard components.
 */
export type ClientUser = {
  id: string;
  displayName: string | null;
  primaryEmail: string | null;
};

/**
 * Extracts only the client-safe properties from a Stack Auth ServerUser.
 * This prevents serialization errors when passing user data to client components.
 */
export function toClientUser(user: ServerUser): ClientUser {
  return {
    id: user.id,
    displayName: user.displayName,
    primaryEmail: user.primaryEmail,
  };
}
