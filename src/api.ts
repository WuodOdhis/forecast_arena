const configuredBaseUrl = import.meta.env?.VITE_API_BASE_URL?.trim();

if (configuredBaseUrl) {
  const parsedBaseUrl = new URL(configuredBaseUrl);
  if (!['https:', 'http:'].includes(parsedBaseUrl.protocol))
    throw new Error('VITE_API_BASE_URL must use HTTP or HTTPS.');
}

const apiBaseUrl = configuredBaseUrl?.replace(/\/+$/, '');

export function apiUrl(path: string): string {
  if (!path.startsWith('/api/')) throw new Error('API paths must start with /api/.');
  return apiBaseUrl ? `${apiBaseUrl}${path}` : path;
}
