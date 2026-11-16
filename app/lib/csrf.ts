/**
 * Browser-safe CSRF entry. Do not import server modules from this file.
 * Actions use `withCSRFProtection` from `~/lib/csrf.server`.
 */
export function withCSRFProtection(): never {
  throw new Error(
    "withCSRFProtection is server-only. Import it from ~/lib/csrf.server."
  );
}
