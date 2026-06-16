import path from "path";

export default {
  test: {
    globals: true,
    environment: "node",
    clearMocks: true,
    exclude: [
      "**/node_modules/**",
      "**/.pnpm-store/**",
      "**/.nx/**",
      "**/.sandcastle/**",
      "**/.sandcastle_bk/**",
      "**/dist/**",
    ],
    //globalSetup: "tests/helper/globalSetup.ts",
    setupFiles: [
      //"dotenv/config",
      "tests/helper/setupTests.ts",
      //"tests/helper/setupTestEnvVars.ts",
      //"tests/helper/customMatchers/toHaveBeenCalledWithScopes.ts",
    ],
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "lib"),
    },
  },
};
