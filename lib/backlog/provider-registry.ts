/**
 * Provider Registry and Factory
 *
 * Manages BacklogAutomationProvider instances for different vendors.
 * Provides factory methods for creating and retrieving providers.
 */

import type { BacklogAutomationProvider } from "./provider.js";
import { GitHubBacklogAutomationProvider } from "./providers/github.js";
import type { ForgeProvider } from "../work-management/index.js";

export class ProviderRegistry {
  private static providers: Map<string, BacklogAutomationProvider> = new Map();
  private static initialized = false;

  /**
   * Initialize the registry with default providers.
   */
  static initialize(): void {
    if (this.initialized) {
      return;
    }

    // Register GitHub provider as default
    this.register("github", new GitHubBacklogAutomationProvider());

    this.initialized = true;
  }

  /**
   * Register a provider instance for a vendor.
   */
  static register(vendor: string, provider: BacklogAutomationProvider): void {
    this.providers.set(vendor, provider);
  }

  /**
   * Get a registered provider by vendor name.
   * Throws if provider is not registered.
   */
  static getProvider(vendor: string): BacklogAutomationProvider {
    this.initialize();

    const provider = this.providers.get(vendor);
    if (!provider) {
      throw new Error(`No provider registered for vendor: ${vendor}`);
    }

    return provider;
  }

  /**
   * Create a new GitHub provider with optional auth token.
   */
  static createGitHubProvider(authToken?: string): GitHubBacklogAutomationProvider {
    return new GitHubBacklogAutomationProvider(authToken);
  }

  /**
   * List all registered vendors.
   */
  static listVendors(): string[] {
    this.initialize();
    return Array.from(this.providers.keys());
  }

  /**
   * Reset registry (mainly for testing).
   */
  static reset(): void {
    this.providers.clear();
    this.initialized = false;
  }
}

/**
 * Helper to get provider for a given forge type.
 * Used in scan-executor to initialize the provider.
 */
export function getProviderForForge(
  forge: ForgeProvider,
  authToken?: string,
): BacklogAutomationProvider {
  if (forge === "github") {
    return new GitHubBacklogAutomationProvider(authToken);
  }

  // Fail fast for unsupported forges (Phase C+ will add GitLab, Bitbucket, etc.)
  throw new Error(
    `Unsupported forge: ${forge}. Supported forges: github. Phase C will add GitLab, Bitbucket, and others.`,
  );
}
