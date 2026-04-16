// Admin emails configurable via ADMIN_EMAILS env var (comma-separated).
// Falls back to the hardcoded list if the env var is not set.
const ADMIN_EMAILS = (process.env.ADMIN_EMAILS || "lordspaco117@gmail.com")
  .split(",")
  .map((e) => e.trim().toLowerCase())
  .filter(Boolean);

export function isAdmin(email: string | undefined | null): boolean {
  return !!email && ADMIN_EMAILS.includes(email.toLowerCase());
}
