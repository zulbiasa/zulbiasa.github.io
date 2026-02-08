
// Netlify Function for Gemini API
// No need for 'node-fetch' in Node 18+ on Netlify
export default async function handler(req, context) {
    console.log("Function invoked");

    // Only allow POST
    if (req.method !== 'POST') {
        console.log("Method not POST:", req.method);
        return new Response('Method Not Allowed', { status: 405 });
    }

    // Parse body
    let body;
    try {
        body = await req.json();
        console.log("Body parsed:", JSON.stringify(body));
    } catch (e) {
        console.error("JSON parse error:", e);
        return new Response('Invalid JSON: ' + e.message, { status: 400 });
    }

    const { prompt = '', count = 3, date } = body;
    const n = Math.max(1, Math.min(8, Number(count) || 3));

    const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
    if (!GEMINI_API_KEY) {
        console.error("Missing GEMINI_API_KEY");
        return new Response(JSON.stringify({ error: 'Server missing GEMINI_API_KEY' }), {
            status: 500,
            headers: { 'Content-Type': 'application/json' }
        });
    }

    // System instructions + User Prompt
    const systemInstruction = `
You are an assistant that creates logbook time entries for a student's daily training log.
Respond with a JSON object ONLY (no markdown formatting, no code blocks, no explanation) in this exact schema:
{ "entries": [ { "time": "HH:MM", "title": "short title", "description": "one or two sentence description" } ] }

Rules:
- Return exactly ${n} entries.
- Use 24-hour "HH:MM" format for "time" values.
- Titles should be short (max 6 words). Descriptions should be 1-2 sentences.
- If "prompt" is short or empty, infer reasonable tasks for the given date.
- Ensure JSON is valid.
`;

    const userContent = `
Date: ${date || 'unknown'}
User prompt: "${prompt}"
Generate ${n} entries.
`;

    const finalPrompt = systemInstruction + "\n\n" + userContent;

    try {
        // Use specific version to avoid 'not found' errors with aliases
        const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash-001:generateContent?key=${GEMINI_API_KEY}`;
        console.log("Sending request to Gemini...");

        // Call Gemini API
        const response = await fetch(geminiUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                contents: [{
                    parts: [{ text: finalPrompt }]
                }],
                generationConfig: {
                    responseMimeType: "application/json"
                }
            })
        });

        if (!response.ok) {
            const errText = await response.text();
            console.error("Gemini API Error:", response.status, errText);
            return new Response(JSON.stringify({ error: 'Gemini API Error: ' + errText, status: response.status }), {
                status: 502,
                headers: { 'Content-Type': 'application/json' }
            });
        }

        const data = await response.json();
        console.log("Gemini response received");

        // Parse Gemini Response
        const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;

        if (!text) {
            console.error("No content in Gemini response:", JSON.stringify(data));
            return new Response(JSON.stringify({ error: 'No content from AI', raw: data }), {
                status: 500,
                headers: { 'Content-Type': 'application/json' }
            });
        }

        let parsed;
        try {
            parsed = JSON.parse(text);
        } catch (e) {
            console.error("Failed to parse AI JSON:", text);
            return new Response(JSON.stringify({ error: 'Failed to parse AI JSON', raw: text }), {
                status: 500,
                headers: { 'Content-Type': 'application/json' }
            });
        }

        if (!parsed || !Array.isArray(parsed.entries)) {
            console.error("Invalid AI schema:", JSON.stringify(parsed));
            return new Response(JSON.stringify({ error: 'Invalid AI schema', raw: text }), {
                status: 500,
                headers: { 'Content-Type': 'application/json' }
            });
        }

        // Sanitize
        const entries = parsed.entries.slice(0, n).map(it => ({
            time: normalizeTimeTo24(it.time || ''),
            title: (it.title || '').trim(),
            description: (it.description || '').trim()
        }));

        return new Response(JSON.stringify({ entries }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' }
        });

    } catch (err) {
        console.error("Global Catch Error:", err);
        return new Response(JSON.stringify({ error: err.message, stack: err.stack }), {
            status: 500,
            headers: { 'Content-Type': 'application/json' }
        });
    }
}

function normalizeTimeTo24(t) {
    if (!t) return '09:00';
    t = t.trim();
    // already HH:MM 24h
    if (/^\d{1,2}:\d{2}$/.test(t)) {
        const [h, m] = t.split(':').map(Number);
        if (h >= 0 && h < 24 && m >= 0 && m < 60) return String(h).padStart(2, '0') + ':' + String(m).padStart(2, '0');
    }
    // handle AM/PM
    const ampm = /(\d{1,2})(?::(\d{2}))?\s*([AaPp][Mm])/.exec(t);
    if (ampm) {
        let h = parseInt(ampm[1], 10);
        let m = ampm[2] ? parseInt(ampm[2], 10) : 0;
        const mer = ampm[3].toLowerCase();
        if (mer === 'pm' && h < 12) h += 12;
        if (mer === 'am' && h === 12) h = 0;
        return String(h).padStart(2, '0') + ':' + String(m).padStart(2, '0');
    }
    return '09:00';
}
