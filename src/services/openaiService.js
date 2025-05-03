const { OpenAI } = require('openai');
const { OPENAI_API_KEY } = require('../config');

const openai = new OpenAI({ apiKey: OPENAI_API_KEY, opts: {
    timeout: 30000,
    maxRetries: 3
  } 
});

async function askChatGPT(messages, temperature = 0.7) {
  // messages: [{role: 'user', content: '...'}, {role: 'system', content: '...'}]
  try {
    const response = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages,
      temperature
    });
    return response.choices[0].message.content.trim();
  } catch (err) {
    console.error('OpenAI error:', err);
    throw err;
  }
}

module.exports = {
  askChatGPT
};
