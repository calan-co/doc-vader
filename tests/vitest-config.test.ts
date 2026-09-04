import { expect, it } from "vitest";
import config from "../vitest.config.js";

it("caps default Vitest workers for runtime integration tests", () => {
  expect(config.test.maxWorkers).toBe(2);
});
