import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

// Unmount what each test rendered, so no test sees another's DOM.
afterEach(() => {
  cleanup();
});
