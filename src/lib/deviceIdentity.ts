const DEVICE_ID_KEY = 'minimart-device-id-v1';
const DEVICE_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$/;
let cachedDeviceId = '';

/** Stable per-browser device identifier used only for adjustment audit records. */
export function getDeviceId(): string {
  if (cachedDeviceId) return cachedDeviceId;
  try {
    const stored = localStorage.getItem(DEVICE_ID_KEY);
    if (stored && DEVICE_ID_PATTERN.test(stored)) {
      cachedDeviceId = stored;
      return stored;
    }
    const created = `dev-${crypto.randomUUID()}`;
    localStorage.setItem(DEVICE_ID_KEY, created);
    cachedDeviceId = created;
    return created;
  } catch {
    const fallback = `dev-${crypto.randomUUID()}`;
    cachedDeviceId = fallback;
    return fallback;
  }
}
