const { OpenAI } = require('openai');
const { OPENAI_API_KEY, GPT_MODEL } = require('../config');

const openai = new OpenAI({ 
  apiKey: OPENAI_API_KEY,
  timeout: 120000,
  maxRetries: 3
});

async function askChatGPT(messages, temperatureOrOptions = 0.7, retries = 3) {
  // Supports signature: (messages, temperature, retries) OR (messages, { temperature, retries, json, max_tokens })
  let lastError;
  let temperature = 0.7;
  let options = {};

  if (typeof temperatureOrOptions === 'object') {
    options = temperatureOrOptions || {};
    temperature = options.temperature ?? 0.7;
    retries = options.retries ?? retries;
  } else {
    temperature = temperatureOrOptions;
  }

  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      console.log(`OpenAI request attempt ${attempt}/${retries}`);

      const requestBody = {
        model: GPT_MODEL,
        messages,
        temperature,
        max_tokens: options.max_tokens ?? 900
      };
      if (options.json === true) {
        requestBody.response_format = { type: 'json_object' };
      }

      const response = await openai.chat.completions.create(requestBody);

      const content = response.choices[0].message.content?.trim();
      if (!content) {
        throw new Error('Empty response from OpenAI');
      }

      console.log('OpenAI request successful');
      return content;
    } catch (err) {
      console.error(`OpenAI error (attempt ${attempt}/${retries}):`, err);
      lastError = err;

      if (attempt < retries) {
        const delay = Math.min(1000 * Math.pow(2, attempt - 1), 10000);
        console.log(`Waiting ${delay}ms before retry...`);
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }
  }

  throw new Error(`Failed after ${retries} attempts. Last error: ${lastError.message}`);
}

module.exports = {
  askChatGPT
};
