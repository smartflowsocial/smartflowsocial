/**
 * @vitest-environment jsdom
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

import { themeBootScript } from "~/lib/theme-boot-script";

function installMatchMedia(matchesDark: boolean) {
  window.matchMedia = vi.fn(
    () =>
      ({
        matches: matchesDark,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        addListener: vi.fn(),
        removeListener: vi.fn(),
      }) as unknown as MediaQueryList
  );
}

function runBootScript() {
  const run = new Function(themeBootScript()) as () => void;
  run();
}

describe("theme boot script", () => {
  beforeEach(() => {
    window.localStorage.clear();
    document.documentElement.className = "h-full";
    delete (window as { __SFS_ACCOUNT_THEME__?: unknown })
      .__SFS_ACCOUNT_THEME__;
    document.querySelectorAll('meta[name="theme-color"]').forEach((el) => {
      el.remove();
    });
    const mediaMeta = document.createElement("meta");
    mediaMeta.name = "theme-color";
    mediaMeta.content = "#151618";
    mediaMeta.setAttribute("media", "(prefers-color-scheme: dark)");
    document.head.appendChild(mediaMeta);
    installMatchMedia(true);
  });

  it("sets the dark class without rewriting theme-color meta tags", () => {
    runBootScript();

    expect(document.documentElement).toHaveClass("dark");
    expect(
      document.querySelectorAll('meta[name="theme-color"][media]')
    ).toHaveLength(1);
    expect(document.getElementById("sfs-theme-color")).toBeNull();
  });

  it("uses a stored light preference and leaves the server meta tags", () => {
    window.localStorage.setItem("theme", JSON.stringify("light"));

    runBootScript();

    expect(document.documentElement).not.toHaveClass("dark");
    expect(document.querySelector('meta[name="theme-color"]')).toHaveAttribute(
      "media",
      "(prefers-color-scheme: dark)"
    );
  });

  it("lets a session override win over the account preference", () => {
    (window as { __SFS_ACCOUNT_THEME__?: string }).__SFS_ACCOUNT_THEME__ =
      "dark";
    window.localStorage.setItem("theme_session", JSON.stringify("light"));
    installMatchMedia(true);

    runBootScript();

    expect(document.documentElement).not.toHaveClass("dark");
    expect(document.getElementById("sfs-theme-color")).toBeNull();
  });
});
