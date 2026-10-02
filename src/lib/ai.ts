import { google } from "@ai-sdk/google";
import { openai } from "@ai-sdk/openai";
import { groq } from "@ai-sdk/groq";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";

// OpenCode Go subscription — key from https://opencode.ai/auth (subscribe to Go).
// Per the OpenCode docs, Go uses the /zen/go/v1 endpoint path and expects clients
// to identify themselves with a user agent + a stable session ID header.
const OPENCODE_MODEL = "deepseek-v4.1-flash";
const OPENCODE_GO_BASE_URL = "https://opencode.ai/zen/go/v1";

function openCodeGoModel(sessionId: string) {
  const provider = createOpenAICompatible({
    name: "opencode-go",
    baseURL: OPENCODE_GO_BASE_URL,
    apiKey: process.env.OPENCODE_API_KEY ?? "",
    headers: {
      "User-Agent": "lead-portal/1.0",
      "x-opencode-session": sessionId,
    },
  });
  return provider(OPENCODE_MODEL);
}

export function pickModel(sessionId: string) {
  if (process.env.OPENCODE_API_KEY) {
    return openCodeGoModel(sessionId);
  }
  if (process.env.OPENAI_API_KEY) {
    return openai(process.env.AI_MODEL ?? "gpt-4o-mini");
  }
  if (process.env.GOOGLE_GENERATIVE_AI_API_KEY) {
    return google(process.env.AI_MODEL ?? "gemini-2.5-flash");
  }
  if (process.env.GROQ_API_KEY) {
    return groq(process.env.AI_MODEL ?? "llama-3.3-70b-versatile");
  }
  return null;
}

export const NO_AI_KEY_MESSAGE =
  "No AI key configured. Add OPENCODE_API_KEY (OpenCode Go subscription — https://opencode.ai/auth) to .env.local (and Vercel), then restart. OpenAI / Google / Groq keys also work as fallbacks.";
