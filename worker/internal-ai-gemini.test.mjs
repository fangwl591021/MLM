import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

const workerSource = await readFile(new URL("./worker.js", import.meta.url), "utf8");
const testModuleSource = workerSource.replace("function geminiRequestFromResponsesPayload(payload) {", "export function geminiRequestFromResponsesPayload(payload) {");
const worker = await import(`data:text/javascript;base64,${Buffer.from(testModuleSource).toString("base64")}`);

test("converts Responses OCR input into Gemini multimodal structured output", () => {
  const request = worker.geminiRequestFromResponsesPayload({
    input: [{ role: "user", content: [{ type: "input_text", text: "辨識名片" }, { type: "input_image", image_url: "data:image/png;base64,aGVsbG8=" }] }],
    max_output_tokens: 1800,
    tools: [{ type: "web_search" }],
    text: { format: { schema: { type: "object", additionalProperties: false, properties: { name: { type: "string" } } } } },
  });
  assert.equal(request.contents[0].parts[0].text, "辨識名片");
  assert.deepEqual(request.contents[0].parts[1], { inlineData: { mimeType: "image/png", data: "aGVsbG8=" } });
  assert.equal(request.generationConfig.maxOutputTokens, 1800);
  assert.equal(request.generationConfig.responseMimeType, "application/json");
  assert.equal(request.generationConfig.responseJsonSchema.additionalProperties, undefined);
  assert.deepEqual(request.tools, [{ googleSearch: {} }]);
});