import OpenAI from "openai";
import { writeFile } from "node:fs/promises";
import { Client } from
  "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from
  "@modelcontextprotocol/sdk/client/streamableHttp.js";

const openai = new OpenAI();

const serverUrl =
  process.env.BOOK_MCP_URL ??
  "https://d5f5-2001-fb1-dc-2561-b53d-bc07-665b-699e.ngrok-free.app/mcp";

const resourceUri =
  "investment://documents/investor_guide_book.pdf";
// "shelf://documents/path.txt";

const readOnlyTools = [
  // "search_books",
  // "get_book_details",
  // "recommend_books",
  // "compare_books",
  // "find_similar_books",
  // "get_catalog_statistics",
  "search_books",
  "get_book_details",
  "recommend_books",
  "compare_books",
  "find_similar_books",
  "get_catalog_statistics",
  "create_book",
  "update_book",
  "delete_book"
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

  const searchPrompt = await mcpClient.getPrompt({ //เป็นการสร้าง prompt โดยการโยน parameter ให้มันไป form format ออกมาให้จาก template ที่เราสร้างไว้ เมื่อได้ prompt มาแล้วก็ส่งให้ openAI ต่อ
    name: "search book",
    arguments: {
      mode: "category",
      input: "Finance",
      limit: "3",
    },
  });

  console.log(JSON.stringify(searchPrompt.messages, null, 2));

  const searchPromptText = searchPrompt.messages
    .map((message) =>
      message.content.type === "text"
        ? message.content.text
        : ""
    )
    .filter(Boolean)
    .join("\n\n");

  // เรียก resources/read
  const resourceResult = await mcpClient.readResource({
    uri: resourceUri,
  });

  const pdfContent = resourceResult.contents.find(
    (content) =>
      content.mimeType === "application/pdf" &&
      // content.mimeType === "text/plain" &&
      "blob" in content,
  );

  if (!pdfContent || !("blob" in pdfContent)) {
    throw new Error(
      // "Resource ไม่ได้ส่ง PDF กลับมาในรูปแบบ Base64 blob",
      "Resource ไม่ได้ส่ง TXT กลับมาในรูปแบบ Base64 blob",
    );
  }

  const b64 = pdfContent.blob;

  // ส่ง PDF ให้โมเดล พร้อมเปิด MCP Tools
  const response = await openai.responses.create({
    model: "gpt-5.5",
    instructions:
      "You are a helpful book catalog assistant.", //กฎ กติกา ทั่วไป
    input: [
      {
        /**
         * system เป็นกฎระดับสูง มีความสำคัญสูงสุด ที่บังคับให้ปฏิบ้ติตามเท่านั้น
         * developer ใช้สำหรับการกำหนดบทบาท หรือ behavior การกำหนดขอบเขตงาน ซึ่งก็จะคล้ายๆกับ instruction ในกรณีทีเป็น string เพียงแค่อันนี้อยู่ในรูปแบบของ input แต่สามารถใส่ input ประเภทอื่นได้ เช่น link เอกสาร เป็นกฎของ app หรือ developer
         * user ใช้สำหรับงานทั่วไป เปรียบเสมือน message / file / คำถาม จากผู้ใช้งานจริงฃ
         */
        role: "user",
        content: [
          {
            type: "input_file",
            filename: "investor_guide_book.pdf",
            file_data:
              `data:application/pdf;base64,${b64}`,
          },
          {
            type: "input_image",
            image_url: "https://encrypted-tbn0.gstatic.com/images?q=tbn:ANd9GcTiSyKXXIxe007wIK-yu9lbybMBeN4idPnUgr8EgBA1FrMvAPTvzM2vtLWS&s=10",
            detail: "auto",
          },
          {
            type: "input_file",
            file_url: "https://s201.q4cdn.com/141608511/files/doc_financials/2027/Q227/NVDA-F2Q27-Quarterly-Presentation-final-1.pdf",
            detail: "auto"
          },
          {
            type: "input_text",
            text:
              `
            ตอบคำถามต่อไปนี้
            1. หนังสือ Investor Guide มีกี่หน้า และสรุปว่าเกี่ยวกับอะไร
            2. if i finished the book from 1, what the next book should i read in part of "Finance"? answer only the book name (only book in our catalog)

            จากข้อ 2 ถ้าไม่มีหนังสือในหมวดหมู่ Finance ให้หาหนังสือไหนก็ได้ในคลังมาแนะนำ สัก 3 เล่ม

            3. ${searchPromptText}
            4. ช่วยอธิบายรูปที่ input ไป ขอแบบสั้นๆได้ใจความ
            5. อธิบาย F2Q27 ของ NVDA ในส่วนของ Revenue หน่อย สั้นๆ อยู่หน้า 3
              `,
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
    `\nAnswer:\n${response.output_text ||
    "No final text response was returned."
    }`,
  );

  //generate image code here
  const imageResponse = await openai.images.generate({
    model: "gpt-image-2-2026-04-21",
    prompt:
      "A cute black cat with a round body, fluffy fur, sparkling adorable eyes, pastel cuties 3D style, soft pastel colors, charming toy-like character, clean background.",
    size: "1024x1024",
    quality: "medium",
    output_format: "png",
    n: 1,
  });

  const generatedImage = imageResponse.data?.[0]?.b64_json;

  if (!generatedImage) {
    throw new Error("Image generation did not return base64 image data.");
  }

  const imagePath = new URL(
    "./black-cat-pastel-cuties-3d.png",
    import.meta.url,
  );

  await writeFile(imagePath, Buffer.from(generatedImage, "base64"));

  console.log(`\nGenerated image saved to: ${imagePath.pathname}`);
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
