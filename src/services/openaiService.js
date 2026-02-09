const { OpenAI } = require('openai');
const { OPENAI_API_KEY, GPT_MODEL } = require('../config');

if (!OPENAI_API_KEY) {
  throw new Error('OPENAI_API_KEY is not set. Please configure environment variables.');
}

const openai = new OpenAI({
  apiKey: OPENAI_API_KEY,
  timeout: 120000,
  // Manual retry logic below handles retryable statuses explicitly.
  maxRetries: 0
});

function toSafeRetryCount(value, fallback = 3) {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 1) return fallback;
  return Math.floor(n);
}

function toSafeMaxTokens(value, fallback = 900) {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 1) return fallback;
  return Math.floor(n);
}

function getStatusCode(err) {
  return err?.status ?? err?.statusCode ?? err?.response?.status ?? null;
}

function isRetryableError(err) {
  const status = getStatusCode(err);
  // Network/runtime errors may not have an HTTP status and are often transient.
  if (!status) return true;
  return status === 429 || status >= 500;
}

function extractTextContent(content) {
  if (typeof content === 'string') return content.trim();
  if (Array.isArray(content)) {
    const text = content
      .map((part) => (typeof part?.text === 'string' ? part.text : ''))
      .join('')
      .trim();
    return text;
  }
  return '';
}

async function askChatGPT(messages, temperatureOrOptions = 0.7, retries = 3) {
  // Supports signature: (messages, temperature, retries) OR (messages, { temperature, retries, json, max_tokens })
  if (!Array.isArray(messages) || messages.length === 0) {
    throw new Error('askChatGPT expects a non-empty messages array');
  }

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
  const retryCount = toSafeRetryCount(retries);
  const maxTokens = toSafeMaxTokens(options.max_tokens);

  for (let attempt = 1; attempt <= retryCount; attempt++) {
    try {
      console.log(`OpenAI request attempt ${attempt}/${retryCount}`);

      const requestBody = {
        model: GPT_MODEL,
        messages,
        temperature,
        max_tokens: maxTokens
      };
      if (options.json === true) {
        requestBody.response_format = { type: 'json_object' };
      }

      const response = await openai.chat.completions.create(requestBody);

      const content = extractTextContent(response?.choices?.[0]?.message?.content);
      if (!content) {
        throw new Error('Empty response from OpenAI');
      }

      console.log('OpenAI request successful');
      return content;
    } catch (err) {
      const status = getStatusCode(err);
      console.error(
        `OpenAI error (attempt ${attempt}/${retryCount}, status ${status ?? 'n/a'}):`,
        err?.message || err
      );
      lastError = err;

      if (attempt < retryCount && isRetryableError(err)) {
        const delay = Math.min(1000 * Math.pow(2, attempt - 1), 10000);
        console.log(`Waiting ${delay}ms before retry...`);
        await new Promise(resolve => setTimeout(resolve, delay));
      } else if (attempt < retryCount) {
        break;
      }
    }
  }

  throw new Error(`Failed after ${retryCount} attempts. Last error: ${lastError?.message || 'unknown error'}`);
}

module.exports = {
  askChatGPT
};
