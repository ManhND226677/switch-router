// Date filter guard shared by repos that accept startDate/endDate query params.
// A malformed date string must never reach Date#toISOString — that throws a
// RangeError ("Invalid time value") and turns a bad query into a 500.
// Returns the ISO string for valid dates, otherwise null (caller skips the
// condition instead of crashing).

export function toValidDateIso(value) {
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}
