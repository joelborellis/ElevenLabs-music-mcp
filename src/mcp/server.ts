import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerResources } from "./resources.js";
import { registerTools, type ToolDeps } from "./tools.js";

export function createMcpServer(deps: ToolDeps): McpServer {
  const server = new McpServer({
    name: deps.config.appName,
    version: deps.config.appVersion,
  });
  registerTools(server, deps);
  registerResources(server, deps);
  return server;
}
