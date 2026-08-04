import OpenAI from "openai";

const client = new OpenAI();
const serverUrl = process.env.BOOK_MCP_URL
    ?? "https://461a-2001-fb1-dd-cdca-e9f6-c85a-554a-3707.ngrok-free.app/mcp";

const readOnlyTools = [
    "search_books",
    "get_book_details",
    "recommend_books",
    "compare_books",
    "find_similar_books",
    "get_catalog_statistics",
];

/**
 * คุณสามารถใช้เครื่องมือเหล่านี้ได้:

1. **ค้นหาหนังสือ**: ค้นหาหนังสือตามคำค้น หมวดหมู่ ผู้เขียน ภาษา และราคา
2. **ดูรายละเอียดหนังสือ**: เข้าถึงข้อมูลฉบับเต็มของหนังสือแต่ละเล่ม
3. **แนะนำหนังสือ**: รับคำแนะนำหนังสือตามหัวข้อ หมวดหมู่ และระดับคะแนน
4. **เปรียบเทียบหนังสือ**: เปรียบเทียบหนังสือระหว่างกัน
5. **ค้นหาหนังสือที่คล้ายกัน**: ค้นหาหนังสือที่มีหมวดหมู่หรือผู้เขียนเหมือนกัน
6. **สถิติของหนังสือ**: ดูสถิติเกี่ยวกับหนังสือและหมวดหมู่
7. **สร้างหนังสือใหม่**: เพิ่มหนังสือใหม่ลงในฐานข้อมูล
8. **แก้ไขหนังสือ**: ปรับปรุงข้อมูลของหนังสือที่มีอยู่แล้ว
9. **ลบหนังสือ**: ลบหนังสือออกจากฐานข้อมูล

1. ธุรกิจ (Business) - 2000 เล่ม
2. ข้อมูล (Data) - 2000 เล่ม
3. การออกแบบ (Design) - 2000 เล่ม
4. นิยาย (Fiction) - 2000 เล่ม
5. การเงิน (Finance) - 2000 เล่ม
6. ประวัติศาสตร์ (History) - 2000 เล่ม
7. การเป็นผู้นำ (Leadership) - 2000 เล่ม
8. วิทยาศาสตร์ (Science) - 2000 เล่ม
9. การพัฒนาตนเอง (Self Development) - 2000 เล่ม
10. เทคโนโลยี (Technology) - 2000 เล่ม
 */
try {
    const response = await client.responses.create({
        model: "gpt-5.4",
        instructions: [
            "You are a helpful book catalog assistant.",
        ].join(" "),
        tools: [
            {
                type: "mcp",
                server_label: "book-mcp",
                server_description: "Search, inspect, compare, and manage the demo book catalog.",
                server_url: serverUrl,
                require_approval: {
                    never: {
                        tool_names: readOnlyTools,
                    },
                },
            }
        ],
        input: "อยากได้หนังสือการเงินมาอ่านสัก 2 เล่ม แนะนำหน่อย",
    });

    

    for (const item of response.output) {
        if (item.type === "mcp_list_tools") {
            console.log(`[MCP] discovered tools: ${item.tools.map((tool) => tool.name).join(", ")}`);
        }
        if (item.type === "mcp_call") {
            console.log(`[MCP] called: ${item.name}`);
            if (item.error) console.error(`[MCP] error: ${item.error}`);
            else console.log(`[MCP] result: ${item.output}`);
        }
        if (item.type === "mcp_approval_request") {
            console.log(`[MCP] approval required: ${item.name}`);
        }
    }

    console.log(`\nAnswer:\n${response.output_text || "No final text response was returned."}`);
} catch (error) {
    console.error(error);
}
