const axios = require('axios');

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

  module.exports = {
    generateVegaSpec,
    validateAndFormatResponse
  };