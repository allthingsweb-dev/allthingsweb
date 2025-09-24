/**
 * Utility functions for constructing user display names
 */

/**
 * Constructs a display name from an email address
 * Examples:
 * - "john.doe@example.com" -> "John Doe"
 * - "johndoe@example.com" -> "Johndoe"
 * - "john_doe@example.com" -> "John Doe"
 * - "john-doe@example.com" -> "John Doe"
 */
export function constructDisplayNameFromEmail(email: string): string {
  // Extract the local part (before @)
  const localPart = email.split("@")[0];

  if (!localPart) {
    return "User";
  }

  // Replace dots, underscores, and hyphens with spaces
  const normalized = localPart.replace(/[._-]/g, " ");

  // Capitalize each word
  return normalized
    .split(" ")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(" ");
}

/**
 * Gets the best display name for a user, falling back to email-based name construction
 */
export function getUserDisplayName(user: {
  displayName?: string | null;
  primaryEmail?: string | null;
  name?: string | null;
}): string {
  // Prefer displayName if available
  if (user.displayName?.trim()) {
    return user.displayName.trim();
  }

  // Fall back to name field if available
  if (user.name?.trim()) {
    return user.name.trim();
  }

  // Construct from email if available
  if (user.primaryEmail?.trim()) {
    return constructDisplayNameFromEmail(user.primaryEmail.trim());
  }

  return "Anonymous";
}
