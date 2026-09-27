/**
 * Synthetic Gemini API responses shaped like @google/genai
 * GenerateContentResponse objects. TEST FIXTURES ONLY.
 */
export const TINY_PNG_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";

export function imageResponseFixture(overrides: Record<string, unknown> = {}) {
  return {
    responseId: "fixture-response-id",
    modelVersion: "fixture-image-model-001",
    candidates: [
      {
        finishReason: "STOP",
        content: {
          role: "model",
          parts: [
            { text: "thinking about the scene", thought: true },
            { inlineData: { mimeType: "image/png", data: TINY_PNG_BASE64 }, thought: true },
            { text: "Here is the catalog photo." },
            { inlineData: { mimeType: "image/png", data: TINY_PNG_BASE64 } },
          ],
        },
      },
    ],
    usageMetadata: {
      promptTokenCount: 1000,
      candidatesTokenCount: 1300,
      thoughtsTokenCount: 200,
      totalTokenCount: 2500,
      candidatesTokensDetails: [
        { modality: "TEXT", tokenCount: 10 },
        { modality: "IMAGE", tokenCount: 1290 },
      ],
    },
    ...overrides,
  };
}

export const validAnalysisFixture = {
  category: "bralette",
  categoryConfidence: "high",
  dominantColors: [{ name: "black", hex: "#111111", confidence: "high" }],
  fabricAppearance: "sheer mesh with scalloped lace trim",
  details: [
    { element: "lace", description: "floral lace on cups", visibleInImages: [1], confidence: "high" },
    { element: "straps", description: "thin adjustable straps", visibleInImages: [1, 2], confidence: "medium" },
  ],
  silhouette: "triangle cups, unlined",
  construction: "no underwire visible",
  frontBackDistinctions: "back view not provided",
  imageQuality: { overall: "good", issues: [] },
  missingReferenceAngles: ["back", "side"],
  uncertainties: ["closure type not visible"],
};
