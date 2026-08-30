import path from "path";

export default {
  test: {
    globals: true,
    environment: "node",
    clearMocks: true,
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
