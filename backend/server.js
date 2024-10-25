require('dotenv').config({ override: true });
console.log('API Key Loaded:', !!process.env.OPENAI_API_KEY);
const express = require('express');
const axios = require('axios');
const cors = require('cors');
const rateLimit = require('express-rate-limit');

const app = express();
app.use(express.json({ limit: '50mb' }));

// CORS Configuration
const allowedOrigins = [
  'http://localhost:3000',
  'https://andrewy7.github.io',
  'https://andrewy7.github.io/integratingagents/',
];

const corsOptions = {
  origin: allowedOrigins,
  methods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  credentials: true,
};

app.use(cors(corsOptions));
app.options('*', cors(corsOptions));

// Rate Limiting
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

// Global Variables
let dataset = null;

// Utility Functions
function print_red(...strings) {
  console.log('\x1b[31m%s\x1b[0m', strings.join(' '));
}

function print_blue(...strings) {
  console.log('\x1b[34m%s\x1b[0m', strings.join(' '));
}

// Utility object for validation and debugging
const serverUtils = {
  validateVegaSpec: (spec) => {
    const requiredProps = ['mark', 'encoding'];
    const issues = [];
    
    if (!spec) {
      return { isValid: false, issues: ['Specification is null or undefined'] };
    }
    
    requiredProps.forEach(prop => {
      if (!spec[prop]) {
        issues.push(`Missing required property: ${prop}`);
      }
    });
    
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

// Helper Functions
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

  const numberValues = sampleValues.map(v => parseFloat(v));
  if (numberValues.every(v => !isNaN(v))) {
    return 'quantitative';
  }

  const dateValues = sampleValues.map(v => new Date(v));
  if (dateValues.every(v => !isNaN(v.getTime()))) {
    return 'temporal';
  }

  const uniqueValues = new Set(sampleValues);
  if (uniqueValues.size <= Math.min(10, sampleValues.length * 0.2)) {
    return 'ordinal';
  }

  return 'nominal';
}

function calculateStat(values, operation) {
  switch (operation) {
    case 'count':
      return values.length;
    case 'mean':
      return Number((values.reduce((a, b) => a + b, 0) / values.length).toFixed(2));
    case 'median':
      values.sort((a, b) => a - b);
      const mid = Math.floor(values.length / 2);
      return Number((values.length % 2 !== 0 ? values[mid] : (values[mid - 1] + values[mid]) / 2).toFixed(2));
    case 'sum':
      return Number(values.reduce((a, b) => a + b, 0).toFixed(2));
    case 'min':
      return Number(Math.min(...values).toFixed(2));
    case 'max':
      return Number(Math.max(...values).toFixed(2));
    default:
      throw new Error(`Invalid operation: ${operation}`);
  }
}

function calculateCorrelation(x, y) {
  const n = x.length;
  if (n !== y.length || n === 0) {
    throw new Error('Arrays must have the same length and not be empty');
  }

  const sumX = x.reduce((a, b) => a + b, 0);
  const sumY = y.reduce((a, b) => a + b, 0);
  const meanX = sumX / n;
  const meanY = sumY / n;

  const covXY = x.reduce((acc, xi, i) => {
    return acc + (xi - meanX) * (y[i] - meanY);
  }, 0) / n;

  const varX = x.reduce((acc, xi) => {
    return acc + Math.pow(xi - meanX, 2);
  }, 0) / n;

  const varY = y.reduce((acc, yi) => {
    return acc + Math.pow(yi - meanY, 2);
  }, 0) / n;

  return covXY / Math.sqrt(varX * varY);
}

function validateAndFormatResponse(message) {
  let response;
  try {
    response = typeof message === 'string' ? JSON.parse(message) : message;

    if (response.chartSpec && response.output) {
      if (!response.description) {
        response.description = "Analysis results";
      }
    } else if (response.chartSpec) {
      if (!response.description) {
        response.description = "Visualization results";
      }
    } else if (response.output !== undefined) {
      if (!response.description) {
        response.description = "Statistical analysis results";
      }
    } else {
      throw new Error('Invalid response format: must include chartSpec and/or output');
    }

    return response;
  } catch (error) {
    console.error('Response validation error:', error);
    throw new Error('Failed to validate response format');
  }
}

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

// Core Analysis Functions
async function generateVegaSpec({ user_query, dataset_info }) {
  console.log('Generating Vega spec for query:', user_query);
  console.log('Dataset info received:', JSON.stringify(dataset_info, null, 2));

  if (!dataset_info || !dataset_info.dataTypes) {
    console.error('Missing or invalid dataset info:', dataset_info);
    return { 
      success: false,
      chartSpec: null,
      description: "Failed to generate chart: missing dataset information",
    };
  }

  const chartPrompt = {
    role: 'user',
    content: `Create a Vega-Lite specification for: ${user_query}

Available data columns and types:
${JSON.stringify(dataset_info.dataTypes, null, 2)}

The specification MUST include:
1. A mark type appropriate for the visualization
2. X and Y axis encodings with proper field names and types
3. A descriptive title
4. Appropriate data transformations if needed

Return ONLY a JSON object with this structure:
{
  "chartSpec": {
    "mark": "point",  // or appropriate mark type
    "encoding": {
      "x": {"field": "fieldName", "type": "quantitative", "title": "X Axis Title"},
      "y": {"field": "fieldName", "type": "quantitative", "title": "Y Axis Title"}
    },
    "title": "Chart Title"
  },
  "description": "A brief description of the visualization"
}`
  };

  try {
    console.log('Sending chart generation prompt to OpenAI:', chartPrompt);
    
    const response = await axios.post(
      'https://api.openai.com/v1/chat/completions',
      {
        model: 'gpt-4',
        messages: [chartPrompt],
        temperature: 0.7,
        max_tokens: 1000
      },
      {
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`
        }
      }
    );

    if (!response.data.choices || !response.data.choices[0].message) {
      throw new Error('Invalid response from OpenAI');
    }

    const assistantMessage = response.data.choices[0].message.content;
    console.log('Assistant message:', assistantMessage);

    let parsedResponse = JSON.parse(assistantMessage);

    if (!parsedResponse.chartSpec) {
      throw new Error('Response missing chartSpec');
    }

    // Add required Vega-Lite properties
    parsedResponse.chartSpec.$schema = "https://vega.github.io/schema/vega-lite/v5.json";
    parsedResponse.chartSpec.data = { values: [] };

    // Add default config if not present
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

    return {
      ...parsedResponse,
      success: true
    };

  } catch (error) {
    console.error('Error in generateVegaSpec:', error);
    return {
      success: false,
      error: 'Error generating chart specification',
      details: error.message
    };
  }
}

function computeStatistic({ operation, field, field2, groupBy, filters }) {
  if (!dataset || dataset.length === 0) {
    return { output: 'Dataset is empty or not loaded.', success: false };
  }

  const normalizeFieldName = (name) => name.toLowerCase().replace(/[\s_]/g, '');
  const availableFields = Object.keys(dataset[0]);
  
  // Find the main field for calculation
  const normalizedSearchField = normalizeFieldName(field);
  const actualField = availableFields.find(f => normalizeFieldName(f) === normalizedSearchField);

  if (!actualField) {
    return { 
      output: `Field "${field}" not found. Available fields are: ${availableFields.join(', ')}`,
      success: false 
    };
  }

  // Apply filters
  let filteredData = dataset;
  if (filters && Array.isArray(filters)) {
    filteredData = filteredData.filter((item) => {
      return filters.every((filter) => {
        const { field: filterField, operator, value } = filter;
        const normalizedFilterField = normalizeFieldName(filterField);
        const actualFilterField = availableFields.find(f => normalizeFieldName(f) === normalizedFilterField);
        
        if (!actualFilterField) return true;

        const itemValue = item[actualFilterField];
        const compareValue = typeof value === 'string' ? value.toLowerCase() : value;
        const compareItemValue = typeof itemValue === 'string' ? itemValue.toLowerCase() : itemValue;
        
        switch (operator) {
          case '==': return compareItemValue == compareValue;
          case '!=': return compareItemValue != compareValue;
          case '>': return parseFloat(itemValue) > parseFloat(value);
          case '<': return parseFloat(itemValue) < parseFloat(value);
          case '>=': return parseFloat(itemValue) >= parseFloat(value);
          case '<=': return parseFloat(itemValue) <= parseFloat(value);
          default: return true;
        }
      });
    });
  }

  // Handle correlation
  if (operation === 'correlation' && field2) {
    const normalizedSearchField2 = normalizeFieldName(field2);
    const actualField2 = availableFields.find(f => normalizeFieldName(f) === normalizedSearchField2);
    
    if (!actualField2) {
      return {
        output: `Second field "${field2}" not found for correlation calculation.`,
        success: false
      };
    }

    const values1 = [];
    const values2 = [];

    filteredData.forEach(item => {
      const val1 = parseFloat(item[actualField]);
      const val2 = parseFloat(item[actualField2]);
      if (!isNaN(val1) && !isNaN(val2)) {
        values1.push(val1);
        values2.push(val2);
      }
    });

    const correlation = calculateCorrelation(values1, values2);
    return {
      output: {
        correlation: Number(correlation.toFixed(3)),
        field1Stats: {
          mean: calculateStat(values1, 'mean'),
          min: calculateStat(values1, 'min'),
          max: calculateStat(values1, 'max')
        },
        field2Stats: {
          mean: calculateStat(values2, 'mean'),
          min: calculateStat(values2, 'min'),
          max: calculateStat(values2, 'max')
        }
      },
      success: true,
      operation: 'correlation',
      fields: [actualField, actualField2]
    };
  }

  // Handle grouped statistics
  if (groupBy) {
    const normalizedGroupField = normalizeFieldName(groupBy);
    const actualGroupByField = availableFields.find(f => normalizeFieldName(f) === normalizedGroupField);
    
    if (!actualGroupByField) {
      return {
        output: `GroupBy field "${groupBy}" not found`,
        success: false
      };
    }

    const groups = {};
    filteredData.forEach(item => {
      const groupValue = item[actualGroupByField];
      if (!groups[groupValue]) {
        groups[groupValue] = [];
      }
      
      if (operation === 'count') {
        groups[groupValue].push(item);
      } else {
        const val = item[actualField];
        const numericVal = typeof val === 'string' ? parseFloat(val.replace(/[$,]/g, '')) : parseFloat(val);
        if (!isNaN(numericVal)) {
          groups[groupValue].push(numericVal);
        }
      }
    });

    const results = {};
    for (const [groupValue, values] of Object.entries(groups)) {
      if (values.length === 0) continue;
      results[groupValue] = calculateStat(values, operation);
    }

    return {
      output: results,
      success: true,
      operation: operation,
      field: actualField,
      groupBy: actualGroupByField
    };
  }

  // Handle regular statistics
  const values = operation === 'count' ? 
    filteredData.map(item => item[actualField]) :
    filteredData
      .map(item => {
        const val = item[actualField];
        return typeof val === 'string' ? parseFloat(val.replace(/[$,]/g, '')) : parseFloat(val);
      })
      .filter(val => !isNaN(val));

  if (values.length === 0) {
    return {
      output: `No valid ${operation === 'count' ? '' : 'numerical '}data available for field "${actualField}"`,
      success: false
    };
  }

  const result = calculateStat(values, operation);
  
  return {
    output: result,
    success: true,
    operation: operation,
    field: actualField,
    processedCount: values.length,
    totalCount: filteredData.length
  };
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

// Main Route Handler
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

  try {
    const messages = [
      { role: 'system', content: systemPrompt },
      { 
        role: 'user', 
        content: `User Query: ${userQuery}\n\nAvailable Dataset Info: ${JSON.stringify(datasetInfo, null, 2)}`
      }
    ];

    let response = await callOpenAIWithRetry(messages, functions);
    let message = response.choices[0].message;
    let functionResults = {};

    const MAX_ITERATIONS = 5;
    let iterations = 0;

    // Handle function calls
    while (message.function_call && iterations < MAX_ITERATIONS) {
      iterations++;
      console.log(`Function call iteration ${iterations}`);

      const functionName = message.function_call.name;
      let functionArgs;
      try {
        functionArgs = JSON.parse(message.function_call.arguments);
        
        if (functionName === 'generate_vega_spec' && !functionArgs.dataset_info) {
          functionArgs.dataset_info = datasetInfo;
        }
      } catch (parseError) {
        print_red('Error parsing function arguments:', parseError);
        throw new Error(`Invalid function arguments: ${parseError.message}`);
      }

      print_blue(`Executing function: ${functionName}`);
      let functionResponse;

      // Execute the appropriate function
      if (functionName === 'generate_vega_spec') {
        console.log('Calling generate_vega_spec with args:', JSON.stringify(functionArgs, null, 2));
        functionResponse = await generateVegaSpec(functionArgs);
        if (functionResponse.success) {
          functionResults.chartSpec = functionResponse.chartSpec;
        }
      } else if (functionName === 'compute_statistic') {
        console.log('Calling compute_statistic with args:', JSON.stringify(functionArgs, null, 2));
        functionResponse = computeStatistic(functionArgs);
        if (functionResponse.success) {
          functionResults.output = functionResponse.output;
        }
      }

      console.log(`Function ${functionName} response:`, functionResponse);

      messages.push(message);
      messages.push({
        role: 'function',
        name: functionName,
        content: JSON.stringify(functionResponse)
      });

      response = await callOpenAIWithRetry(messages, functions);
      message = response.choices[0].message;
    }

    if (!message.content) {
      throw new Error('Assistant did not provide a final response');
    }

    let finalResponse;
    try {
      let sanitizedContent = message.content.trim();
      if (sanitizedContent.startsWith('```json')) {
        sanitizedContent = sanitizedContent.replace(/^```json\s*/, '').replace(/```$/, '').trim();
      }
      
      console.log('Attempting to parse final response:', sanitizedContent);
      finalResponse = validateAndFormatResponse({
        ...JSON.parse(sanitizedContent),
        ...functionResults
      });
      
      if (finalResponse.chartSpec) {
        const specValidation = serverUtils.validateVegaSpec(finalResponse.chartSpec);
        if (!specValidation.isValid) {
          throw new Error(`Invalid chart specification: ${specValidation.issues.join(', ')}`);
        }
      }
      
    } catch (parseError) {
      print_red('Error parsing final response:', parseError);
      throw new Error(`Failed to parse final response: ${parseError.message}`);
    }

    res.json(finalResponse);

  } catch (error) {
    print_red('Error in /api/generate-response:', error);

    const errorResponse = {
      error: 'An error occurred while processing your request.',
      details: error.message
    };

    if (error.response) {
      console.error('API Error details:', error.response.data);
      errorResponse.details = error.response.status === 429 
        ? 'Rate limit exceeded. Please try again later.'
        : error.response.data.error || error.message;
    }

    const statusCode = error.response?.status || 500;
    res.status(statusCode).json(errorResponse);
  }
});

// Error Handler
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

// Start Server
const PORT = process.env.PORT || 5001;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});