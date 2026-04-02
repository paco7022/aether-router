const ADMIN_EMAILS = ["lordspaco117@gmail.com"];

export function isAdmin(email: string | undefined | null): boolean {
  return !!email && ADMIN_EMAILS.includes(email.toLowerCase());
}
