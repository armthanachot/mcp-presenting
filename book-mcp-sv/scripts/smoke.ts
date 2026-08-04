import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";

const endpoint = new URL(process.env.MCP_URL ?? "http://127.0.0.1:3100/mcp");
const client = new Client({ name: "book-mcp-smoke", version: "1.0.0" });
const transport = new StreamableHTTPClientTransport(endpoint);

await client.connect(transport as Transport);

try {
  const tools = await client.listTools();
  const search = await client.callTool({
    name: "search_books",
    arguments: { query: "technology", limit: 3, sortBy: "rating", sortOrder: "desc" },
  });
  const statistics = await client.callTool({ name: "get_catalog_statistics", arguments: {} });

  if (search.isError || statistics.isError) throw new Error("A smoke-test tool call returned an MCP error");

  console.log(
    JSON.stringify(
      {
        endpoint: endpoint.href,
        toolCount: tools.tools.length,
        tools: tools.tools.map((tool) => tool.name),
        search,
        statistics,
      },
      null,
      2,
    ),
  );
} finally {
  await client.close();
}
