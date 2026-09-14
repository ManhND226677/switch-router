// Date filter guard shared by repos that accept startDate/endDate query params.
// A malformed date string must never reach Date#toISOString — that throws a
// RangeError ("Invalid time value") and turns a bad query into a 500.
// Returns the ISO string for valid dates, otherwise null (caller skips the
// condition instead of crashing).

export function toValidDateIso(value) {
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

/**
 * Inclusive upper bound for a `timestamp <= ?` filter.
 *
 * Every dashboard date picker sends a bare "YYYY-MM-DD" endDate, and
 * `new Date("2026-08-27")` resolves to midnight UTC — so comparing with toValidDateIso
 * silently excludes the whole day the user just picked. Date-only values are
 * therefore stretched to the last millisecond of that UTC day; full timestamps
 * pass through unchanged.
 */
export function toValidDateUpperBoundIso(value) {
  if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
    const d = new Date(`${value}T23:59:59.999Z`);
    return Number.isNaN(d.getTime()) ? null : d.toISOString();
  }
  return toValidDateIso(value);
}
