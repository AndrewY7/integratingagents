require('dotenv').config({ override: true });
console.log('API Key Loaded:', !!process.env.OPENAI_API_KEY);
const express = require('express');
const axios = require('axios');
const cors = require('cors');
const rateLimit = require('express-rate-limit');

const app = express();
app.use(express.json({ limit: '50mb' }));

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
  max: 50,
  handler: (req, res) => {
    console.error('Rate limit exceeded for IP:', req.ip);
    res.status(429).json({
      error: 'Too many requests. Please wait before trying again.',
      retryAfter: Math.ceil(60 - Date.now() / 1000 % 60)
    });
  }
});

app.use('/api/', limiter);

// Utility functions for validation and debugging
const serverUtils = {
  validateVegaSpec: (spec) => {
    const requiredProps = ['mark', 'encoding', '$schema'];
    const issues = [];
    
    if (!spec) {
      return { isValid: false, issues: ['Specification is null or undefined'] };
    }
    
    requiredProps.forEach(prop => {
      if (!spec[prop]) {
        issues.push(`Missing required property: ${prop}`);
      }
    });
    
    if (spec.$schema !== 'https://vega.github.io/schema/vega-lite/v5.json') {
      issues.push('Invalid or missing Vega-Lite schema version');
    }
    
    if (spec.encoding) {
      const hasValidChannel = Object.keys(spec.encoding).some(channel => 
        ['x', 'y', 'color', 'size', 'shape'].includes(channel)
      );
      if (!hasValidChannel) {
        issues.push('No valid encoding channels found');
      }
    }
    
    return {
      isValid: issues.length === 0,
      issues
    };
  },

  debugDataset: (data) => {
    if (!data || !Array.isArray(data)) {
      return {
        isValid: false,
        issues: ['Dataset is not an array or is null']
      };
    }

    const sample = data.slice(0, 5);
    const columnTypes = {};
    const issues = [];

    if (sample.length > 0) {
      const columns = Object.keys(sample[0]);
      
      columns.forEach(col => {
        const values = sample.map(row => row[col]);
        const types = new Set(values.map(val => typeof val));
        columnTypes[col] = Array.from(types);
        
        if (types.size > 1) {
          issues.push(`Mixed types in column "${col}": ${Array.from(types).join(', ')}`);
        }
      });
    }

    return {
      isValid: issues.length === 0,
      issues,
      debugInfo: {
        totalRows: data.length,
        sampleData: sample,
        columnTypes
      }
    };
  }
};

function print_red(...strings) {
  console.log('\x1b[31m%s\x1b[0m', strings.join(' '));
}

function print_blue(...strings) {
  console.log('\x1b[34m%s\x1b[0m', strings.join(' '));
}

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
    description: 'Computes statistical measures on the dataset, optionally grouped by a category.',
    parameters: {
      type: 'object',
      properties: {
        operation: {
          type: 'string',
          enum: ['mean', 'median', 'sum', 'min', 'max', 'average'],
          description: 'The statistical operation to perform.',
        },
        field: {
          type: 'string',
          description: 'The name of the field/column on which to perform the operation.',
        },
        groupBy: {
          type: 'string',
          description: 'Optional field name to group results by. For example, "origin" to get statistics per origin.',
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
      required: ['operation', 'field'],
    },
  },
];

async function callOpenAIWithRetry(messages, functions, retries = 3) {
  try {
    console.log(`callOpenAIWithRetry: Attempting OpenAI API call. Retries left: ${retries}`);
    const response = await axios.post(
      'https://api.openai.com/v1/chat/completions',
      {
        model: 'gpt-4o-mini',
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

let dataset = null;

function getDatasetInfo(data) {
  if (!data || data.length === 0) {
    console.error('getDatasetInfo: Data is empty or undefined');
    return null;
  }

  const columns = Object.keys(data[0]);
  const dataTypes = {};
  const sampleValues = {};

  columns.forEach((col) => {
    const values = data.map((row) => row[col]);
    dataTypes[col] = inferVegaLiteType(values);
    sampleValues[col] = values.slice(0, 3);
  });

  return { columns, dataTypes, sampleValues };
}

function inferVegaLiteType(values) {
  const sampleSize = 30;
  const spread = Math.floor(values.length / 3);
  const sampleValues = [
    ...values.slice(0, sampleSize),
    ...values.slice(spread, spread + sampleSize),
    ...values.slice(-sampleSize)
  ].filter(v => v !== null && v !== undefined);

  if (sampleValues.length === 0) return 'nominal';

  // Try parsing as numbers first
  const numberValues = sampleValues.map(v => parseFloat(v));
  if (numberValues.every(v => !isNaN(v))) {
    return 'quantitative';
  }

  // Try parsing as dates
  const dateValues = sampleValues.map(v => new Date(v));
  if (dateValues.every(v => !isNaN(v.getTime()))) {
    return 'temporal';
  }

  // Check for ordinal data
  const uniqueValues = new Set(sampleValues);
  if (uniqueValues.size <= Math.min(10, sampleValues.length * 0.2)) {
    return 'ordinal';
  }

  return 'nominal';
}

const systemPrompt = `You are an AI assistant that can generate Vega-Lite v5 chart specifications and perform data analysis on the provided dataset based on user queries.

For statistical queries that involve grouping or categories:
1. Use the compute_statistic function with the groupBy parameter when:
   - Comparing statistics across categories (e.g., "average by origin")
   - Computing metrics for different groups
   - Analyzing patterns across categories

2. Structure your compute_statistic calls like this:
   - For grouped averages: 
     {
       "operation": "mean",
       "field": "field_to_analyze",
       "groupBy": "category_field"
     }
   - For filtered statistics:
     {
       "operation": "mean",
       "field": "field_to_analyze",
       "filters": [{"field": "filter_field", "operator": "==", "value": "filter_value"}]
     }

Always return your final answer in JSON format:
- For calculations: {"output": "..." }
- For visualizations: {"chartSpec": { /* Vega-Lite spec */ }, "description": "..." }

Example queries and their parameter mapping:
- "What is the average MPG for cars from each origin?"
  => compute_statistic with {operation: "mean", field: "mpg", groupBy: "origin"}
- "What is the median budget for PG-13 movies?"
  => compute_statistic with {operation: "median", field: "Production Budget", filters: [{field: "Content Rating", operator: "==", value: "PG-13"}]}

Do not include any text outside the JSON response.`;

app.post('/api/generate-response', async (req, res) => {
  const { userQuery, data } = req.body;

  console.log('Received Request Body:', JSON.stringify(req.body, null, 2));

  if (!process.env.OPENAI_API_KEY) {
    print_red('Error: OPENAI_API_KEY is not set.');
    res.status(500).json({ error: 'Server configuration error: OpenAI API key is missing.' });
    return;
  }

  // Validate Request Payload
  if (!userQuery || !data || !Array.isArray(data)) {
    print_red('Error: Invalid request payload.');
    console.error('Received payload:', req.body);
    res.status(400).json({
      error: 'Invalid request payload. "userQuery" and "data" are required.',
    });
    return;
  }

  // Validate dataset
  const dataValidation = serverUtils.debugDataset(data);
  if (!dataValidation.isValid) {
    console.error('Data validation failed:', dataValidation.issues);
    res.status(400).json({
      error: 'Invalid dataset structure',
      details: dataValidation.issues
    });
    return;
  }

  const datasetInfo = getDatasetInfo(data);
  if (!datasetInfo) {
    print_red('Error: Failed to generate datasetInfo from provided data.');
    res.status(400).json({
      error: 'Invalid dataset. Unable to extract dataset information.',
    });
    return;
  }

  dataset = data;

  console.log(`Incoming request from ${req.ip} at ${new Date().toISOString()}`);
  console.log('User Query:', userQuery);
  console.log('Dataset Info:', JSON.stringify(datasetInfo, null, 2));

  const messages = [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: userQuery }
  ];

  try {
    let response = await callOpenAIWithRetry(messages, functions);
    let message = response.choices[0].message;

    const MAX_ITERATIONS = 5;
    let iterations = 0;

    while (message.function_call && iterations < MAX_ITERATIONS) {
      iterations++;

      const functionName = message.function_call.name;
      let functionArgs;
      try {
        functionArgs = JSON.parse(message.function_call.arguments);
      } catch (parseError) {
        print_red('Error parsing function call arguments:', parseError);
        res.status(400).json({ error: 'Invalid function call arguments.' });
        return;
      }

      print_blue(`Calling function: ${functionName}`);
      let functionResponse;

      if (functionName === 'generate_vega_spec') {
        functionResponse = await generateVegaSpec(functionArgs);
      } else if (functionName === 'compute_statistic') {
        functionResponse = computeStatistic(functionArgs);
      } else {
        throw new Error(`Unknown function: ${functionName}`);
      }

      console.log(`Function ${functionName} response:`, functionResponse);

      messages.push(message);
      messages.push({
        role: 'function',
        name: functionName,
        content: JSON.stringify(functionResponse),
      });

      if (functionResponse.success === false) {
        print_red(`Function ${functionName} failed with message: ${functionResponse.output}`);
        messages.push({
          role: 'system',
          content: 'The function execution failed. Do not retry. Provide a final answer or inform the user to try a different query.',
        });
      }

      response = await callOpenAIWithRetry(messages, functions);
      message = response.choices[0].message;

      if (!message.content && !message.function_call) {
        print_red('Assistant did not return a final message.');
        break;
      }
    }

    if (!message.content) {
      print_red('Assistant did not return a final message.');
      res.status(500).json({ error: 'Assistant did not return a final message.' });
      return;
    }

    let sanitizedContent = message.content.trim();
    if (sanitizedContent.startsWith('```json')) {
      sanitizedContent = sanitizedContent.replace(/^```json\s*/, '').replace(/```$/, '').trim();
    }

    let finalResponse;
    try {
      finalResponse = JSON.parse(sanitizedContent);
      
      if (finalResponse.chartSpec) {
        const specValidation = serverUtils.validateVegaSpec(finalResponse.chartSpec);
        if (!specValidation.isValid) {
          console.error('Vega spec validation failed:', specValidation.issues);
          throw new Error(`Invalid chart specification: ${specValidation.issues.join(', ')}`);
        }
      }
      
      console.log('Parsed final response:', finalResponse);
    } catch (e) {
      print_red('Error parsing assistant response as JSON:', e);
      console.error('Error parsing assistant response as JSON:', e);
      finalResponse = { error: 'Failed to parse assistant response.' };
    }

    res.json(finalResponse);
  } catch (error) {
    print_red('Error in /api/generate-response:', error);

    if (error.response) {
      const status = error.response.status;
      const errorData = error.response.data;

      print_red('Error details:', JSON.stringify(errorData, null, 2));

      if (status === 429) {
        res.status(429).json({
          error: 'Rate limit exceeded. Please wait and try again later.',
          details: errorData,
        });
      } else {
        res.status(status).json({
          error: 'An error occurred while processing your request.',
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

async function generateVegaSpec({ user_query, dataset_info }) {
  const prompt = `You are an AI assistant that generates Vega-Lite v5 specifications based on user queries and dataset information.

Given the dataset information below, generate a Vega-Lite specification that effectively visualizes the data. 

Dataset Information:
${JSON.stringify(dataset_info, null, 2)}

User Query: ${user_query}

Guidelines for different chart types:

1. For Scatter Plots:
- Use "point" mark
- Set appropriate axis titles
- Add tooltip with relevant fields
- Consider adding a trendline for relationship analysis
- Example: 
{
  "mark": "point",
  "encoding": {
    "x": {"field": "x_field", "type": "quantitative", "title": "X Label"},
    "y": {"field": "y_field", "type": "quantitative", "title": "Y Label"},
    "tooltip": [{"field": "x_field"}, {"field": "y_field"}]
  }
}

2. For Bar Charts:
- Use "bar" mark
- For averages, include "aggregate": "mean" in encoding
- Sort bars by value when appropriate
- Example:
{
  "mark": "bar",
  "encoding": {
    "x": {"field": "category", "type": "nominal"},
    "y": {"field": "value", "type": "quantitative", "aggregate": "mean"},
    "tooltip": [{"field": "category"}, {"aggregate": "mean", "field": "value"}]
  }
}

3. For Histograms:
- Use "bar" mark
- Include "bin": true for the x-axis field
- Add tooltip showing bin ranges and counts
- Example:
{
  "mark": "bar",
  "encoding": {
    "x": {"field": "value", "type": "quantitative", "bin": true},
    "y": {"aggregate": "count"},
    "tooltip": [
      {"field": "value", "bin": true, "title": "Range"},
      {"aggregate": "count", "title": "Count"}
    ]
  }
}

General Requirements:
- Include "$schema": "https://vega.github.io/schema/vega-lite/v5.json"
- Always provide clear axis titles
- Add tooltips for interactivity
- Use appropriate colors when needed
- Handle currency fields by removing "$" and "," if present
- Add a title to the chart

Response Format:
{
  "chartSpec": {/* Vega-Lite specification */},
  "description": "Brief description of the visualization and any relevant statistics"
}

Generate a complete Vega-Lite specification for the given query.`;

  try {
    const response = await callOpenAIWithRetry([{ role: 'user', content: prompt }], []);
    const assistantMessage = response.choices[0].message.content;

    if (!assistantMessage) {
      return { error: 'Received empty response from OpenAI.', success: false };
    }

    let parsedResponse;
    try {
      parsedResponse = JSON.parse(assistantMessage);

      if (parsedResponse.chartSpec) {
        parsedResponse.chartSpec.$schema = "https://vega.github.io/schema/vega-lite/v5.json";
        parsedResponse.chartSpec.data = { values: [] };
        
        if (!parsedResponse.chartSpec.config) {
          parsedResponse.chartSpec.config = {
            axis: {
              labelFontSize: 12,
              titleFontSize: 14
            },
            title: {
              fontSize: 16,
              anchor: "start"
            }
          };
        }

        const validation = serverUtils.validateVegaSpec(parsedResponse.chartSpec);
        if (!validation.isValid) {
          throw new Error(`Invalid chart specification: ${validation.issues.join(', ')}`);
        }

        return { ...parsedResponse, success: true };
      } else {
        throw new Error('Generated specification is missing chartSpec property');
      }
    } catch (parseError) {
      console.error('Error parsing generateVegaSpec response:', parseError);
      return { error: 'Failed to generate a valid chart specification.', success: false };
    }
  } catch (error) {
    console.error('Error in generateVegaSpec:', error);
    return {
      error: 'An error occurred while generating the Vega-Lite specification.',
      success: false,
    };
  }
}

function computeStatistic({ operation, field, filters, groupBy }) {
  if (!dataset || dataset.length === 0) {
    return { output: 'Dataset is empty or not loaded.', success: false };
  }

  const normalizeFieldName = (name) => name.toLowerCase().replace(/[\s_]/g, '');
  
  // Normalize and find the actual field names
  const availableFields = Object.keys(dataset[0]);
  
  // Find the main field for calculation
  const normalizedSearchField = normalizeFieldName(field);
  const actualField = availableFields.find(f => normalizeFieldName(f) === normalizedSearchField);

  // Find the groupBy field if provided
  let actualGroupByField = null;
  if (groupBy) {
    const normalizedGroupField = normalizeFieldName(groupBy);
    actualGroupByField = availableFields.find(f => normalizeFieldName(f) === normalizedGroupField);
  }

  if (!actualField) {
    console.log('Available fields:', availableFields);
    console.log('Requested field:', field);
    return { 
      output: `Field "${field}" not found. Available fields are: ${availableFields.join(', ')}`,
      success: false 
    };
  }

  // Apply filters first
  let filteredData = dataset;
  if (filters && Array.isArray(filters)) {
    filters.forEach((filter) => {
      const { field: filterField, operator, value } = filter;
      // Normalize the filter field name
      const normalizedFilterField = normalizeFieldName(filterField);
      const actualFilterField = availableFields.find(f => normalizeFieldName(f) === normalizedFilterField);
      
      if (!actualFilterField) {
        console.log(`Filter field ${filterField} not found`);
        return;
      }

      filteredData = filteredData.filter((item) => {
        const itemValue = item[actualFilterField];
        // Convert both values to lowercase for string comparison
        const compareValue = typeof value === 'string' ? value.toLowerCase() : value;
        const compareItemValue = typeof itemValue === 'string' ? itemValue.toLowerCase() : itemValue;
        
        switch (operator) {
          case '==':
            return compareItemValue == compareValue;
          case '!=':
            return compareItemValue != compareValue;
          case '>':
            return parseFloat(itemValue) > parseFloat(value);
          case '<':
            return parseFloat(itemValue) < parseFloat(value);
          case '>=':
            return parseFloat(itemValue) >= parseFloat(value);
          case '<=':
            return parseFloat(itemValue) <= parseFloat(value);
          default:
            return true;
        }
      });
    });
  }

  // If groupBy is specified, calculate statistics for each group
  if (actualGroupByField) {
    const groups = {};
    filteredData.forEach(item => {
      const groupValue = item[actualGroupByField];
      if (!groups[groupValue]) {
        groups[groupValue] = [];
      }
      const val = item[actualField];
      const numericVal = typeof val === 'string' ? parseFloat(val.replace(/[$,]/g, '')) : parseFloat(val);
      if (!isNaN(numericVal)) {
        groups[groupValue].push(numericVal);
      }
    });

    const results = {};
    for (const [groupValue, values] of Object.entries(groups)) {
      if (values.length === 0) continue;

      switch (operation) {
        case 'mean':
          results[groupValue] = values.reduce((a, b) => a + b, 0) / values.length;
          break;
        case 'median':
          values.sort((a, b) => a - b);
          const mid = Math.floor(values.length / 2);
          results[groupValue] = values.length % 2 !== 0 ? 
            values[mid] : (values[mid - 1] + values[mid]) / 2;
          break;
        case 'sum':
          results[groupValue] = values.reduce((a, b) => a + b, 0);
          break;
        case 'min':
          results[groupValue] = Math.min(...values);
          break;
        case 'max':
          results[groupValue] = Math.max(...values);
          break;
      }
      // Round the result to 2 decimal places
      results[groupValue] = Number(results[groupValue].toFixed(2));
    }

    return {
      output: results,
      success: true,
      operation: operation,
      field: actualField,
      groupBy: actualGroupByField,
      filters: filters || []
    };
  }

  // If no groupBy, calculate single statistic
  const values = filteredData
    .map((item) => {
      const val = item[actualField];
      return typeof val === 'string' ? parseFloat(val.replace(/[$,]/g, '')) : parseFloat(val);
    })
    .filter((val) => !isNaN(val));

  if (values.length === 0) {
    return { 
      output: `No valid numerical data available for field "${actualField}"`,
      success: false 
    };
  }

  let result;
  switch (operation) {
    case 'mean':
      result = values.reduce((a, b) => a + b, 0) / values.length;
      break;
    case 'median':
      values.sort((a, b) => a - b);
      const mid = Math.floor(values.length / 2);
      result = values.length % 2 !== 0 ? values[mid] : (values[mid - 1] + values[mid]) / 2;
      break;
    case 'sum':
      result = values.reduce((a, b) => a + b, 0);
      break;
    case 'min':
      result = Math.min(...values);
      break;
    case 'max':
      result = Math.max(...values);
      break;
    default:
      return { output: `Invalid operation: ${operation}`, success: false };
  }

  result = Number(result.toFixed(2));

  return {
    output: result,
    success: true,
    operation: operation,
    field: actualField,
    filters: filters || [],
    processedCount: values.length,
    totalCount: filteredData.length
  };
}

app.use((err, req, res, next) => {
if (err instanceof SyntaxError && err.status === 400 && 'body' in err) {
  print_red('Bad JSON:', err.message);
  return res.status(400).json({ error: 'Bad JSON format' });
}
print_red('Unhandled error:', err);
res.status(500).json({ 
  error: 'Internal Server Error',
  message: process.env.NODE_ENV === 'development' ? err.message : 'An unexpected error occurred'
});
});

const PORT = process.env.PORT || 5001;
app.listen(PORT, () => {
console.log(`Server running on port ${PORT}`);
});