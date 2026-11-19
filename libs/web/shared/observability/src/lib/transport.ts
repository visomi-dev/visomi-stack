// Each endpoint is pinned to location.origin. CORS mode lets browsers send a
// verifiable Origin with no-referrer, and redirects remain forbidden.
export const telemetryPost = {
  method: 'POST',
  credentials: 'omit',
  referrerPolicy: 'no-referrer',
  mode: 'cors',
  redirect: 'error',
  keepalive: true,
} as const;
