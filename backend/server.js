require('dotenv').config({ override: true });
console.log('API Key Loaded:', !!process.env.OPENAI_API_KEY);
const express = require('express');
const cors = require('cors');

// Import Helper Functions
const { corsOptions, limiter } = require('./config/cors');
const { callOpenAIWithRetry, functions, systemPrompt } = require('./config/openai');

const {
  computeStatistic,
  getDatasetInfo,
} = require('./services/statsService');

const {
  generateVegaSpec,
  validateAndFormatResponse
} = require('./services/chartService');

const { print_red, print_blue, serverUtils } = require('./utils/validation');

const app = express();
app.use(express.json({ limit: '50mb' }));

app.use(cors(corsOptions));
app.options('*', cors(corsOptions));
app.use('/api/', limiter);

// Global Variables
let dataset = null;

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
        functionResponse = computeStatistic(functionArgs, dataset);
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