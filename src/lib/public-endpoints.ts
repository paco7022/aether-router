const DEFAULT_PUBLIC_API_BASE_URL = "https://api.aether-ai.dev/v1";
const DEFAULT_PUBLIC_SITE_URL = "https://router-cloud.aether-ai.dev";

function cleanUrl(value: string): string {
  return value.trim().replace(/\/+$/, "");
}

export const PUBLIC_API_BASE_URL = cleanUrl(
  process.env.NEXT_PUBLIC_AETHER_API_BASE_URL || DEFAULT_PUBLIC_API_BASE_URL
);

export const PUBLIC_SITE_URL = cleanUrl(
  process.env.NEXT_PUBLIC_SITE_URL || DEFAULT_PUBLIC_SITE_URL
);

export function publicUrl(path: string): string {
  return `${PUBLIC_SITE_URL}${path.startsWith("/") ? path : `/${path}`}`;
}
