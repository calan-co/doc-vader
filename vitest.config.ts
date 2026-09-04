import path from "path";

const requestedMaxWorkers = Number.parseInt(
  process.env.VITEST_MAX_WORKERS ?? "2",
  10,
);
const maxWorkers =
  Number.isFinite(requestedMaxWorkers) && requestedMaxWorkers > 0
    ? requestedMaxWorkers
    : 2;

export default {
  test: {
    globals: true,
    environment: "node",
    clearMocks: true,
    maxWorkers,
    fileParallelism: process.platform !== "win32",
    exclude: [
      "**/node_modules/**",
      "**/.pnpm-store/**",
      "**/.nx/**",
      "**/.sandcastle/**",
      "**/.sandcastle_bk/**",
      "**/dist/**",
    ],
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "lib"),
    },
  },
};
