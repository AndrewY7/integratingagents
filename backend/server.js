require('dotenv').config({ override: true });
console.log('API Key Loaded:', !!process.env.OPENAI_API_KEY);
const express = require('express');
const axios = require('axios');
const cors = require('cors');
const rateLimit = require('express-rate-limit'); 

const app = express();
app.use(express.json());

const allowedOrigins = [
  'http://localhost:3000',      
  'https://andrewy7.github.io',
  'https://andrewy7.github.io/bchai/',
];

const corsOptions = {
  origin: allowedOrigins,
  methods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  credentials: true,
};

app.use(cors(corsOptions));
app.options('*', cors(corsOptions));

const limiter = rateLimit({
  windowMs: 1 * 60 * 1000, 
  max: 100, 
  message: {
    error: 'Too many requests from this IP, please try again after a minute.',
  },
});

app.use('/api/', limiter);

async function callOpenAIWithRetry(prompt, retries = 3) {
  try {
    console.log(`callOpenAIWithRetry: Attempting OpenAI API call. Retries left: ${retries}`);
    const response = await axios.post(
      'https://api.openai.com/v1/chat/completions',
      {
        model: 'gpt-3.5-turbo', 
        messages: [{ role: 'user', content: prompt }],
        max_tokens: 300, 
        temperature: 0.7,
      },
      {
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
        },
      }
    );
    console.log('callOpenAIWithRetry: OpenAI API call successful');
    return response.data;
  } catch (error) {
    if (error.response && error.response.status === 429 && retries > 0) {
      const retryAfter = error.response.headers['retry-after']
        ? parseInt(error.response.headers['retry-after'], 10) * 1000
        : 1000;
      console.warn(`callOpenAIWithRetry: Rate limit exceeded. Retrying after ${retryAfter} ms...`);
      await new Promise((resolve) => setTimeout(resolve, retryAfter));
      return await callOpenAIWithRetry(prompt, retries - 1);
    } else {
      console.error(`callOpenAIWithRetry: Failed to call OpenAI API. Error: ${error.message}`);
      throw error;
    }
  }
}

app.post('/api/generate-chart', async (req, res) => {
  const { prompt, expectedFields } = req.body;

  if (!process.env.OPENAI_API_KEY) {
    console.error('Error: OPENAI_API_KEY is not set.');
    res.status(500).json({ error: 'Server configuration error: OpenAI API key is missing.' });
    return;
  }

  if (!prompt || !expectedFields || !Array.isArray(expectedFields)) {
    console.error('Error: Invalid request payload.');
    res.status(400).json({ error: 'Invalid request payload. "prompt" and "expectedFields" are required.' });
    return;
  }

  console.log(`Incoming request from ${req.ip} at ${new Date().toISOString()}`);
  console.log('Received prompt:', prompt);
  console.log('Expected fields:', expectedFields);

  try {
    const response = await callOpenAIWithRetry(prompt);
    console.log('OpenAI API response:', JSON.stringify(response, null, 2));

    const assistantMessage = response.choices[0].message.content;
    console.log('Assistant message:', assistantMessage);

    const { chartSpec, description } = parseAssistantResponse(assistantMessage, expectedFields);
    console.log('Parsed response:', JSON.stringify({ chartSpec, description }, null, 2));

    if (!chartSpec && !description) {
      throw new Error('Failed to generate chart specification and description');
    }

    res.json({ chartSpec, description });
  } catch (error) {
    console.error('Error in /api/generate-chart:', error);

    if (error.response) {
      const status = error.response.status;
      const errorData = error.response.data;

      console.error('Error calling OpenAI API:', JSON.stringify(errorData, null, 2));

      if (status === 429) {
        res.status(429).json({
          error: 'Rate limit exceeded. Please wait and try again later.',
          details: errorData,
        });
      } else {
        res.status(status).json({
          error: 'An error occurred while generating the chart.',
          details: errorData,
        });
      }
    } else {
      res.status(500).json({
        error: 'An unexpected error occurred.',
        details: error.message,
      });
    }
  }
});

function parseAssistantResponse(responseText, expectedFields) {
  try {
    const parsedResponse = JSON.parse(responseText);
    if (parsedResponse.chartSpec && parsedResponse.description) {
      if (!parsedResponse.chartSpec.$schema.includes('vega-lite/v5')) {
        throw new Error('Vega-Lite specification is not using version 5.');
      }

      const encoding = parsedResponse.chartSpec.encoding;

      if (encoding) {
        const fieldsToCheck = ['x', 'y', 'color', 'tooltip', 'detail', 'shape', 'size', 'opacity'];

        for (let enc of fieldsToCheck) {
          if (encoding[enc]) {
            if (encoding[enc].field && !expectedFields.includes(encoding[enc].field)) {
              throw new Error(`Unexpected field in encoding.${enc}: ${encoding[enc].field}`);
            }
          }
        }
      }

      return {
        chartSpec: parsedResponse.chartSpec,
        description: parsedResponse.description,
      };
    } else {
      throw new Error('Missing chartSpec or description in the response.');
    }
  } catch (error) {
    console.error('Error parsing assistant response:', error);
    return { chartSpec: null, description: 'Failed to parse the assistant response. Please try a different query.' };
  }
}

app.use((err, req, res, next) => {
  if (err instanceof SyntaxError && err.status === 400 && 'body' in err) {
    console.error('Bad JSON:', err.message);
    return res.status(400).json({ error: 'Bad JSON format' });
  }
  console.error('Unhandled error:', err);
  res.status(500).json({ error: 'Internal Server Error' });
});

const PORT = process.env.PORT || 5001;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});