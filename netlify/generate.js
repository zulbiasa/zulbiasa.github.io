// Example for Vercel/Netlify serverless (Node 18+)
import fetch from 'node-fetch';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).send('Only POST');
  const { prompt = '', count = 3, date } = req.body || {};
  const n = Math.max(1, Math.min(8, Number(count) || 3));

  const OPENAI_KEY = process.env.OPENAI_API_KEY;
  if(!OPENAI_KEY) return res.status(500).json({ error: 'Server missing OPENAI_API_KEY' });

  // Create a deterministic system prompt instructing the model to return JSON only.
  const system = `
You are an assistant that creates logbook time entries for a student's daily training log.
Respond with a JSON object ONLY (no explanation) in this exact schema:
{ "entries": [ { "time": "HH:MM", "title": "short title", "description": "one or two sentence description" } ] }

Rules:
- Return exactly up to "count" entries (no more).
- Use 24-hour "HH:MM" format for "time" values.
- Titles should be short (max 6 words). Descriptions should be 1-2 sentences.
- If "prompt" is short or empty, infer reasonable tasks for the given date.
- Ensure JSON is valid (no trailing text).`;

  const userPrompt = `
Date: ${date || 'unknown'}
Count: ${n}
User prompt: "${prompt}"
Generate ${n} entries.
`;

  try{
    const body = {
      model: "gpt-4o-mini", // you can change model to a suitable one you have access to
      messages: [
        { role: "system", content: system },
        { role: "user", content: userPrompt }
      ],
      temperature: 0.6,
      max_tokens: 600
    };

    const r = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${OPENAI_KEY}`
      },
      body: JSON.stringify(body)
    });

    if(!r.ok){
      const txt = await r.text();
      return res.status(502).send('OpenAI error: ' + txt);
    }
    const data = await r.json();
    const content = data?.choices?.[0]?.message?.content || '';

    // Try to parse JSON from the model output robustly
    let parsed = null;
    try {
      parsed = JSON.parse(content);
    } catch (e) {
      // fallback: try to extract JSON substring
      const m = content.match(/\{[\s\S]*\}[\s]*$/);
      if(m) {
        parsed = JSON.parse(m[0]);
      }
    }

    if(!parsed || !Array.isArray(parsed.entries)) {
      return res.status(500).json({ error: 'Invalid AI response', raw: content });
    }

    // Basic sanitization: trim fields and ensure time format HH:MM
    const entries = parsed.entries.slice(0, n).map((it) => {
      const time = (it.time || '').trim();
      const title = (it.title || '').trim();
      const description = (it.description || '').trim();
      // minimal time normalization: if returned "9:00 AM" -> convert to 24h simple
      const normTime = normalizeTimeTo24(time);
      return { time: normTime || '09:00', title: title || '-', description: description || '' };
    });

    return res.json({ entries });

  } catch(err){
    console.error(err);
    return res.status(500).json({ error: err.message || err });
  }
}

// helper: small time normalizer (handles HH:MM, H:MM AM/PM, H AM/PM)
function normalizeTimeTo24(t) {
  if(!t) return '';
  t = t.trim();
  // already HH:MM 24h
  if(/^\d{1,2}:\d{2}$/.test(t)) {
    const [h,m] = t.split(':').map(Number);
    if(h>=0 && h<24 && m>=0 && m<60) return String(h).padStart(2,'0') + ':' + String(m).padStart(2,'0');
  }
  // handle AM/PM
  const ampm = /(\d{1,2})(?::(\d{2}))?\s*([AaPp][Mm])/.exec(t);
  if(ampm){
    let h = parseInt(ampm[1],10);
    let m = ampm[2] ? parseInt(ampm[2],10) : 0;
    const mer = ampm[3].toLowerCase();
    if(mer === 'pm' && h<12) h += 12;
    if(mer === 'am' && h===12) h = 0;
    return String(h).padStart(2,'0') + ':' + String(m).padStart(2,'0');
  }
  // fallback empty
  return '';
}
