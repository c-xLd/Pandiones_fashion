/**
 * Lists models visible to GEMINI_API_KEY with their supported actions, and
 * checks the models configured in the environment. Use it to verify model
 * IDs before setting GEMINI_IMAGE_MODEL / GEMINI_ANALYSIS_MODEL / VIDEO_MODEL.
 *
 *   npm run providers:models
 */
import nextEnv from "@next/env";
import { GoogleGenAI } from "@google/genai";

nextEnv.loadEnvConfig(process.cwd());

async function main() {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    console.error("GEMINI_API_KEY is not set.");
    process.exit(1);
  }
  const ai = new GoogleGenAI({ apiKey });
  const pager = await ai.models.list({ config: { pageSize: 100 } });
  const rows: { name: string; actions: string }[] = [];
  for await (const model of pager) {
    const name = model.name ?? "";
    if (!/gemini|veo|imagen/i.test(name)) continue;
    rows.push({ name: name.replace(/^models\//, ""), actions: (model.supportedActions ?? []).join(", ") });
  }
  rows.sort((a, b) => a.name.localeCompare(b.name));
  console.table(rows);

  for (const [envName, action] of [
    ["GEMINI_IMAGE_MODEL", "generateContent"],
    ["GEMINI_ANALYSIS_MODEL", "generateContent"],
    ["VIDEO_MODEL", "predictLongRunning"],
  ] as const) {
    const id = process.env[envName];
    if (!id) {
      console.log(`${envName}: not set`);
      continue;
    }
    try {
      const info = await ai.models.get({ model: id });
      const ok = !info.supportedActions?.length || info.supportedActions.includes(action);
      console.log(`${envName}=${id}: ${ok ? "OK" : "MISSING ACTION " + action} (${(info.supportedActions ?? []).join(", ")})`);
    } catch (error) {
      console.log(`${envName}=${id}: NOT AVAILABLE — ${error instanceof Error ? error.message.slice(0, 200) : error}`);
    }
  }
}

void main();
