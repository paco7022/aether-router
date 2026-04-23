// Admin user IDs configurable via ADMIN_USER_IDS env var (comma-separated).
// Falls back to email-based check via ADMIN_EMAILS for backwards compatibility.
const ADMIN_USER_IDS = (process.env.ADMIN_USER_IDS || "")
  .split(",")
  .map((e) => e.trim())
  .filter(Boolean);

const ADMIN_EMAILS = (process.env.ADMIN_EMAILS || "")
  .split(",")
  .map((e) => e.trim().toLowerCase())
  .filter(Boolean);

export function isAdmin(email: string | undefined | null, userId?: string): boolean {
  // Prefer user ID check (immutable, not subject to email change attacks)
  if (userId && ADMIN_USER_IDS.length > 0 && ADMIN_USER_IDS.includes(userId)) {
    return true;
  }
  // Fallback to email check for backwards compatibility
  return !!email && ADMIN_EMAILS.length > 0 && ADMIN_EMAILS.includes(email.toLowerCase());
}
