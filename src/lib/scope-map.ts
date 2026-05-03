/**
 * Static map: which MCP method (and tool name, for tools/call) requires which
 * OAuth scope. Single source of truth — change here to add or rename a scope.
 *
 * Returning null means "no specific scope required" (any valid token passes).
 * Note: a valid token is still required at the HTTP boundary (v0.6 invariant);
 * scope-free here only skips the further check.
 */
export interface McpRequest {
  method: string;
  /** Set when method === "tools/call". The name from params.name. */
  toolName?: string;
}

const TOOL_SCOPES: Readonly<Record<string, string>> = Object.freeze({
  log_observation: "sky-tonight:log:write",
  recall_log: "sky-tonight:log:read",
});

export function requiredScope(req: McpRequest): string | null {
  if (req.method !== "tools/call") return null;
  if (!req.toolName) return null;
  return TOOL_SCOPES[req.toolName] ?? null;
}
