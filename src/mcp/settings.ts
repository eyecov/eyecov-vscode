/**
 * MCP-related settings. Uses a config-like interface so unit tests can pass
 * a simple { get(key) } object without vscode.
 */

export interface WorkspaceConfigLike {
  get(key: string): unknown;
}

/**
 * Whether the MCP server should be registered. Default true when unset.
 */
export function isMcpServerEnabled(config: WorkspaceConfigLike): boolean {
  const v = config.get("enableMcpServer");
  return (v ?? true) === true;
}

/**
 * Whether to prewarm the coverage cache in the background.
 * Default true when unset.
 */
export function isPrewarmCoverageCacheEnabled(
  config: WorkspaceConfigLike,
): boolean {
  const v = config.get("prewarmCoverageCache");
  return (v ?? true) === true;
}
