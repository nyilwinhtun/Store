// Firestore REST v1 typed-value conversion. The Worker never rewrites a field it
// did not read and validate, so unknown Firestore types are preserved by using
// update masks that name only the mutated leaf fields.

export function decodeValue(value) {
  if (!value || typeof value !== 'object') return null;
  if ('nullValue' in value) return null;
  if ('booleanValue' in value) return Boolean(value.booleanValue);
  if ('integerValue' in value) return Number(value.integerValue);
  if ('doubleValue' in value) return Number(value.doubleValue);
  if ('stringValue' in value) return value.stringValue;
  if ('timestampValue' in value) return value.timestampValue;
  if ('referenceValue' in value) return value.referenceValue;
  if ('bytesValue' in value) return value.bytesValue;
  if ('geoPointValue' in value) return value.geoPointValue;
  if ('mapValue' in value) return decodeFields(value.mapValue.fields || {});
  if ('arrayValue' in value) return (value.arrayValue.values || []).map(decodeValue);
  return null;
}

export function decodeFields(fields) {
  const result = {};
  for (const [key, value] of Object.entries(fields || {})) result[key] = decodeValue(value);
  return result;
}

export function encodeValue(value) {
  if (value === null || value === undefined) return { nullValue: null };
  if (typeof value === 'boolean') return { booleanValue: value };
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new TypeError('Non-finite number cannot be written to Firestore.');
    return Number.isSafeInteger(value) ? { integerValue: String(value) } : { doubleValue: value };
  }
  if (typeof value === 'string') return { stringValue: value };
  if (Array.isArray(value)) {
    const values = value.map(encodeValue);
    return { arrayValue: values.length ? { values } : {} };
  }
  if (typeof value === 'object') return { mapValue: encodeMap(value) };
  throw new TypeError(`Unsupported Firestore value: ${typeof value}`);
}

export function encodeMap(object) {
  const fields = {};
  for (const [key, value] of Object.entries(object)) {
    if (value === undefined) continue;
    fields[key] = encodeValue(value);
  }
  return Object.keys(fields).length ? { fields } : {};
}

export function encodeFields(object) {
  return encodeMap(object).fields || {};
}
