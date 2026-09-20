require('dotenv').config();

async function getFetch() {
  if (typeof globalThis.fetch === 'function') {
    return globalThis.fetch.bind(globalThis);
  }

  try {
    const mod = require('node-fetch');
    return (mod.default || mod).bind(mod.default || mod);
  } catch (err) {
    throw new Error('No fetch available. Use Node 18+ or install node-fetch.');
  }
}

async function sendPrompt(prompt) {
  const fetch = await getFetch();
  const key = process.env.OPENAI_API_KEY;
  if (!key) throw new Error('OPENAI_API_KEY not set');
  const model = process.env.OPENAI_MODEL || 'gpt-4o-mini';

  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      model,
      messages: [{ role: 'user', content: prompt }],
      max_tokens: 800
    })
  });

  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`OpenAI error: ${res.status} ${txt}`);
  }
  const data = await res.json();
  const content = data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content;
  return content || JSON.stringify(data);
}

if (require.main === module) {
  const prompt = process.argv.slice(2).join(' ') || 'Say hello';
  sendPrompt(prompt).then(r => console.log(r)).catch(err => { console.error(err.message || err); process.exit(1); });
}

module.exports = { sendPrompt };
