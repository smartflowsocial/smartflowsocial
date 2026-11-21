/**
 * @vitest-environment jsdom
 */
import { render, screen } from "@testing-library/react";
import { renderToString } from "react-dom/server";
import { beforeEach, describe, expect, it } from "vitest";

import { useHydratedLocalBoolean } from "~/lib/hooks/useHydratedLocalBoolean";

const KEY = "dashboard-desktop-sidebar-open";

function Probe() {
  const [open] = useHydratedLocalBoolean(KEY, true);
  return <div>{open ? "open" : "closed"}</div>;
}

describe("useHydratedLocalBoolean", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("renders the default on the server when storage says otherwise", () => {
    localStorage.setItem(KEY, "false");

    expect(renderToString(<Probe />)).toContain("open");
  });

  it("applies the stored value after hydration", () => {
    localStorage.setItem(KEY, "false");

    render(<Probe />);

    expect(screen.getByText("closed")).toBeInTheDocument();
  });
});
