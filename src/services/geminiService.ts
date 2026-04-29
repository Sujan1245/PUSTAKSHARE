import { GoogleGenAI, Type } from "@google/genai";

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

export interface BookInsight {
  summary: string;
  keyThemes: string[];
  readingComplexity: string;
  socialImpactValue: string;
}

export async function getBookInsight(title: string, author: string, genre: string): Promise<BookInsight> {
  try {
    const response = await ai.models.generateContent({
      model: "gemini-3-flash-preview",
      contents: `Provide structural insights for the book "${title}" by ${author} (Genre: ${genre}). Focus on its value for student/community sharing.`,
      config: {
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            summary: { type: Type.STRING, description: "A concise 2-sentence summary." },
            keyThemes: { 
              type: Type.ARRAY, 
              items: { type: Type.STRING },
              description: "Top 3 themes."
            },
            readingComplexity: { type: Type.STRING, description: "Beginner, Intermediate, or Advanced." },
            socialImpactValue: { type: Type.STRING, description: "How this book impacts society or a community." }
          },
          required: ["summary", "keyThemes", "readingComplexity", "socialImpactValue"]
        }
      }
    });

    if (!response.text) {
      throw new Error("No response from AI");
    }

    return JSON.parse(response.text);
  } catch (error) {
    console.error("Gemini Insight Error:", error);
    return {
      summary: "Could not generate summary at this time.",
      keyThemes: ["Service temporarily unavailable"],
      readingComplexity: "N/A",
      socialImpactValue: "N/A"
    };
  }
}
