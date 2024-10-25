const axios = require('axios');

// OpenAI Communication Functions
async function callOpenAIWithRetry(messages, functions, retries = 3) {
  try {
    console.log(`callOpenAIWithRetry: Attempting OpenAI API call. Retries left: ${retries}`);
    const response = await axios.post(
      'https://api.openai.com/v1/chat/completions',
      {
        model: 'gpt-4',  // Changed from 'gpt-4o-mini' to 'gpt-4'
        messages: messages,
        functions: functions,
        function_call: 'auto',
        max_tokens: 500,
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
      return await callOpenAIWithRetry(messages, functions, retries - 1);
    }
    console.error(`callOpenAIWithRetry: Failed to call OpenAI API. Error: ${error.message}`);
    if (error.response) {
      console.error('Error details:', JSON.stringify(error.response.data, null, 2));
    }
    throw error;
  }
}

// Function Definitions for OpenAI
const functions = [
  {
    name: 'generate_vega_spec',
    description: 'Generates a Vega-Lite v5 specification for data visualization',
    parameters: {
      type: 'object',
      properties: {
        user_query: {
          type: 'string',
          description: 'The user query requesting a visualization'
        },
        dataset_info: {
          type: 'object',
          description: 'Information about the dataset including columns and types'
        }
      },
      required: ['user_query', 'dataset_info']
    }
  },
  {
    name: 'compute_statistic',
    description: 'Computes statistical measures on the dataset, including counts and correlations.',
    parameters: {
      type: 'object',
      properties: {
        operation: {
          type: 'string',
          enum: ['mean', 'median', 'sum', 'min', 'max', 'correlation', 'count'],
          description: 'The statistical operation to perform.',
        },
        field: {
          type: 'string',
          description: 'The field/column to analyze.',
        },
        field2: {
          type: 'string',
          description: 'The second field for correlation calculation.',
        },
        groupBy: {
          type: 'string',
          description: 'Field name to group results by.',
        },
        filters: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              field: { type: 'string' },
              operator: { type: 'string', enum: ['==', '!=', '>', '<', '>=', '<='] },
              value: { type: ['string', 'number'] },
            },
            required: ['field', 'operator', 'value'],
          },
          description: 'Optional filters to apply before computing the statistic.',
        },
      },
      required: ['operation', 'field']
    }
  }
];

// System Prompt
const systemPrompt = `You are an AI assistant that helps analyze data and create visualizations. Follow these EXACT formats for responses:

FORMAT 1 - STATISTICS ONLY:
If the query only asks for numerical analysis/statistics, return:
{
  "output": <computed value or object>,
  "description": "Brief description of the analysis"
}

FORMAT 2 - VISUALIZATION ONLY:
If the query only asks for a chart/visualization, return:
{
  "chartSpec": <vega-lite-specification>,
  "description": "Brief description of the visualization"
}

FORMAT 3 - COMBINED ANALYSIS:
If the query asks for both visualization AND statistics, return:
{
  "chartSpec": <vega-lite-specification>,
  "description": "Brief description of both the visualization and statistics",
  "output": <computed value or object>
}

FREQUENCY/COUNT ANALYSIS RULES:
When showing breakdowns, counts, or distributions of categorical variables:
1. For visualization, use generate_vega_spec with:
   - mark: "bar"
   - encoding: use "count()" aggregate for y-axis
2. For numerical summary, use compute_statistic with:
   - operation: "count"
   - field: <categorical field>
   - groupBy: <same categorical field>

Example queries and responses:

1. Query: "Show a breakdown of cars by origin"
   Required sequence:
   a) Call generate_vega_spec with:
      {
        "mark": "bar",
        "encoding": {
          "x": {"field": "Origin", "type": "nominal"},
          "y": {"aggregate": "count"}
        },
        "title": "Car Count by Origin"
      }
   b) Call compute_statistic with:
      {
        "operation": "count",
        "field": "Origin",
        "groupBy": "Origin"
      }
   c) Return:
      {
        "chartSpec": <from generate_vega_spec>,
        "description": "Distribution of cars by origin",
        "output": <counts from compute_statistic>
      }

CORRELATION ANALYSIS RULES:
For relationships between two numerical variables:
1. Use generate_vega_spec for scatter plot
2. Use compute_statistic with:
   {
     "operation": "correlation",
     "field": "variable1",
     "field2": "variable2"
   }

Always end with a final response in one of the three formats above.
Never leave the response without a proper JSON structure.`;

module.exports = {
  callOpenAIWithRetry,
  functions,
  systemPrompt
};