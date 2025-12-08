// netlify/generate.js or api/generate.js
const { GoogleGenAI } = require("@google/genai");

// This automatically uses the GEMINI_API_KEY environment variable
const ai = new GoogleGenAI({}); 

// Define the required structured output
const schema = {
  type: "array",
  description: "A list of logbook entries, max 8",
  items: {
    type: "object",
    properties: {
      time: {
        type: "string",
        description: "A 24-hour time string for the entry, like '09:00' or '14:30'."
      },
      entry: {
        type: "string",
        description: "A short, descriptive title for the task (Entry)."
      },
      description: {
        type: "string",
        description: "A detailed, technical description of the work done (Description)."
      }
    },
    required: ["time", "entry", "description"]
  }
};

// Netlify/Vercel specific handler function
exports.handler = async (event, context) => {
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: "Method Not Allowed" };
  }
  
  try {
    const { prompt, maxEntries } = JSON.parse(event.body);
    
    const systemInstruction = `You are a professional logbook entry generator for university student. Based on the user's daily summary, break the work down into ${maxEntries} or fewer time-sequenced, distinct log entries. Use technical and professional language suitable for a daily work log. The total time covered should be around 8 hours.`;

    const response = await ai.models.generateContent({
      model: "gemini-2.5-flash",
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      config: {
        systemInstruction: systemInstruction,
        responseMimeType: "application/json",
        responseSchema: schema,
      },
    });

    const jsonText = response.text.trim();
    const entries = JSON.parse(jsonText); 

    return {
      statusCode: 200,
      headers: { 
          "Content-Type": "application/json",
          // Essential for GitHub Pages to talk to Netlify/Vercel
          "Access-Control-Allow-Origin": "*" 
      },
      body: JSON.stringify({ entries: entries }),
    };

  } catch (error) {
    console.error("AI Generation Error:", error);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: "Failed to generate entries from AI." }),
    };
  }
};