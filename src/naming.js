// naming.js — filename construction + collision-safe naming.

/**
 * Sanitize a string for safe use inside a filename:
 * strips characters Windows/Drive dislike and collapses whitespace to single underscores.
 */
export function sanitize(str) {
  return String(str)
    .trim()
    .replace(/[^a-zA-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

/** YYYY-MM-DD for a given Date (defaults to now), in local time. */
export function formatDate(date = new Date()) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/**
 * Build the base filename (no extension), e.g. "2026-07-24_Stripe_Product_Manager".
 */
export function buildBaseName({ company, role, date = new Date() }) {
  return `${formatDate(date)}_${sanitize(company)}_${sanitize(role)}`;
}

/**
 * Given a base name and a set/array of names already in use (with or without
 * extension, both are handled), return a collision-free base name — appending
 * "_v2", "_v3", ... as needed.
 */
export function resolveCollision(baseName, existingNames = []) {
  const taken = new Set(
    Array.from(existingNames, (n) => String(n).replace(/\.pdf$|\.docx?$/i, ''))
  );

  if (!taken.has(baseName)) return baseName;

  let version = 2;
  let candidate = `${baseName}_v${version}`;
  while (taken.has(candidate)) {
    version += 1;
    candidate = `${baseName}_v${version}`;
  }
  return candidate;
}

/** Convenience: base name + ".pdf" */
export function toPdfFilename(baseName) {
  return `${baseName}.pdf`;
}
