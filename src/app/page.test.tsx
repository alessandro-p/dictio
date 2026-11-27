import { render, screen } from "@testing-library/react";
import { expect, test } from "vitest";

import Home from "./page";

test("the home page names the app and offers a way to start", () => {
  render(<Home />);

  expect(
    screen.getByRole("heading", { level: 1, name: "dictio" }),
  ).toBeTruthy();
  expect(screen.getByRole("button", { name: "Get started" })).toBeTruthy();
});
