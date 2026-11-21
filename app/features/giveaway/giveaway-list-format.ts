/**
 * List labels that must match on the server and in the browser.
 * `toLocaleDateString(undefined)` uses the machine locale and timezone, so
 * Node (UTC) and a London browser disagree and React throws hydration error 418.
 */

export function formatGiveawayListDay(
  iso: string,
  timeZone: string,
  locale: string
): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat(locale, {
    timeZone,
    month: "short",
    day: "numeric",
  }).format(date);
}

export function formatGiveawayCount(value: number, locale: string): string {
  return new Intl.NumberFormat(locale).format(value);
}
