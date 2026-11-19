/**
 * Inline script for the document `<head>`.
 *
 * It runs before React hydrates, so it may only change `documentElement`'s
 * class. That element is rendered with `suppressHydrationWarning`. Adding or
 * removing `<meta>` here makes the server HTML disagree with the client and
 * React throws hydration error #418. `ThemeColorMetaSync` updates
 * `theme-color` after hydration.
 */
export function themeBootScript(): string {
  return `(function() {
    function parseStoredTheme(raw) {
      if (!raw) return null;
      var v = raw;
      try { v = JSON.parse(raw); } catch (e) { /* ignore */ }
      return (v === 'system' || v === 'light' || v === 'dark') ? v : null;
    }

    function systemEffectiveTheme() {
      var mql = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)');
      return (mql && mql.matches) ? 'dark' : 'light';
    }

    function applyEffectiveTheme(effective) {
      if (effective === 'dark') document.documentElement.classList.add('dark');
      else document.documentElement.classList.remove('dark');
    }

    var accountPref = window.__SFS_ACCOUNT_THEME__;
    var stored = localStorage.getItem('theme');
    var sessionRaw = localStorage.getItem('theme_session');
    var sessionOverride = parseStoredTheme(sessionRaw);
    var pref;

    if (accountPref === 'system' || accountPref === 'light' || accountPref === 'dark') {
      pref = sessionOverride || accountPref;
    } else {
      pref = parseStoredTheme(stored);
      if (!pref) pref = 'system';
    }

    var effective = (pref === 'system') ? systemEffectiveTheme() : pref;
    applyEffectiveTheme(effective);

    if (pref === 'system' && window.matchMedia) {
      var mql = window.matchMedia('(prefers-color-scheme: dark)');
      if (mql) {
        var handler = function() { applyEffectiveTheme(systemEffectiveTheme()); };
        if (mql.addEventListener) mql.addEventListener('change', handler);
        else if (mql.addListener) mql.addListener(handler);
      }
    }
  })();`;
}
