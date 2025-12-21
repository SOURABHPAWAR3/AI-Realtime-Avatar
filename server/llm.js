import OpenAI from "openai";

let openaiClient = null;

function getOpenAIClient() {
    if (openaiClient) return openaiClient;
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) throw new Error("Missing OPENAI_API_KEY for LLM");
    openaiClient = new OpenAI({ apiKey });
    return openaiClient;
}

// Helper function to safely extract content from OpenAI response
function extractContent(resp) {
    if (
        resp &&
        resp.choices &&
        resp.choices[0] &&
        resp.choices[0].message &&
        resp.choices[0].message.content
    ) {
        return resp.choices[0].message.content;
    }
    return "";
}

// Simple LLM integration using OpenAI Chat Completions
export async function handleLLM(text) {
    const openai = getOpenAIClient();

    const resp = await openai.chat.completions.create({
        model: "gpt-3.5-turbo",
        messages: [{ role: "user", content: String(text) }],
        max_tokens: 300,
    });

    const content = extractContent(resp);
    return content ? content.trim() : `AI reply: ${String(text)}`;
}