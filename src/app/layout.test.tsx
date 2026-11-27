import { render, screen } from "@testing-library/react";
import { expect, test, vi } from "vitest";

import RootLayout from "./layout";

vi.mock("next/font/google", () => ({
  Geist: () => ({ variable: "font-sans" }),
  Geist_Mono: () => ({ variable: "font-mono" }),
}));

test("the root layout shows a banner that can't be dismissed", () => {
  render(
    <RootLayout params={Promise.resolve({})}>
      <main>page content</main>
    </RootLayout>,
    { container: document.documentElement },
  );

  const banner = screen.getByRole("alert");
  expect(banner.textContent).toContain("Experimental playground");
  expect(banner.textContent).toContain("only in this browser");
  expect(banner.textContent).toContain("may be lost");
  expect(screen.getByText("page content")).toBeTruthy();
  expect(screen.queryByRole("button")).toBeNull();
});
