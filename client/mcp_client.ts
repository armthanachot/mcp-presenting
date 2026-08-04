import OpenAI from "openai";
import { Client } from
  "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from
  "@modelcontextprotocol/sdk/client/streamableHttp.js";

const openai = new OpenAI();

const serverUrl =
  process.env.BOOK_MCP_URL ??
  "https://2d95-2001-fb1-dd-cdca-818f-d68f-166d-39d1.ngrok-free.app/mcp";

const resourceUri =
  "investment://documents/investor_guide_book.pdf";

const readOnlyTools = [
  "search_books",
  "get_book_details",
  "recommend_books",
  "compare_books",
  "find_similar_books",
  "get_catalog_statistics",
];

const mcpClient = new Client({
  name: "book-client",
  version: "1.0.0",
});

const transport = new StreamableHTTPClientTransport(
  new URL(serverUrl),
);

try {
  // เชื่อม MCP Server โดยตรง
  await mcpClient.connect(transport);

  // เรียก resources/read
  const resourceResult = await mcpClient.readResource({
    uri: resourceUri,
  });

  const pdfContent = resourceResult.contents.find(
    (content) =>
      content.mimeType === "application/pdf" &&
      "blob" in content,
  );

  if (!pdfContent || !("blob" in pdfContent)) {
    throw new Error(
      "Resource ไม่ได้ส่ง PDF กลับมาในรูปแบบ Base64 blob",
    );
  }

  const pdfBase64 = pdfContent.blob;

  // ส่ง PDF ให้โมเดล พร้อมเปิด MCP Tools
  const response = await openai.responses.create({
    model: "gpt-5.4",

    instructions:
      "You are a helpful book catalog assistant.",

    input: [
      {
        role: "user",
        content: [
          {
            type: "input_file",
            filename: "investor_guide_book.pdf",
            file_data:
              `data:application/pdf;base64,${pdfBase64}`,
          },
          {
            type: "input_text",
            text:
              "หนังสือ Investor Guide มีกี่หน้า และสรุปว่าเกี่ยวกับอะไร",
          },
        ],
      },
    ],

    tools: [
      {
        type: "mcp",
        server_label: "book-mcp",
        server_description:
          "Search, inspect, compare, and manage the demo book catalog.",
        server_url: serverUrl,

        // ให้โมเดลเห็นเฉพาะ Tool กลุ่มนี้
        allowed_tools: readOnlyTools,

        // Tool เหล่านี้ไม่ต้องขอ approval
        require_approval: {
          never: {
            tool_names: readOnlyTools,
          },
        },
      },
    ],
  });

  // ดูว่า OpenAI เรียก MCP Tool หรือไม่
  for (const item of response.output) {
    if (item.type === "mcp_list_tools") {
      console.log(
        "[MCP] discovered tools:",
        item.tools.map((tool) => tool.name).join(", "),
      );
    }

    if (item.type === "mcp_call") {
      console.log(`[MCP] called: ${item.name}`);

      if (item.error) {
        console.error(`[MCP] error: ${item.error}`);
      } else {
        console.log(`[MCP] result: ${item.output}`);
      }
    }

    if (item.type === "mcp_approval_request") {
      console.log(
        `[MCP] approval required: ${item.name}`,
      );
    }
  }

  console.log(
    `\nAnswer:\n${
      response.output_text ||
      "No final text response was returned."
    }`,
  );
} catch (error: unknown) {
  if (error instanceof Error) {
    console.error(error.message);
    console.error(error.stack);
  } else {
    console.error(error);
  }
} finally {
  // ปิด MCP session
  await mcpClient.close().catch(() => {
    // ป้องกัน close error กลบ error หลัก
  });
}