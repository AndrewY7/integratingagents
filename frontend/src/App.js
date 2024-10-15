import React, { useState, useEffect, useRef } from 'react';
import { VegaLite } from 'react-vega';
import axios from 'axios';
import { FileUpload, DataPreview } from './csvhandle.js';
import userAvatar from './pictures/aiassistant.jpg';
import assistantAvatar from './pictures/aiassistant.jpg';

function ChartRenderer({ spec }) {
  if (!spec) {
    return null;
  }

  try {
    return (
      <div className="mt-4">
        <VegaLite spec={spec} />
      </div>
    );
  } catch (error) {
    console.error('Error rendering chart:', error);
    return (
      <div className="mt-4 p-4 bg-red-100 border border-red-400 text-red-700 rounded">
        <p>Failed to render the chart. Please check the chart specification.</p>
        <pre>{error.message}</pre>
      </div>
    );
  }
}

function Chatbot({ data }) {
  const [userQuery, setUserQuery] = useState('');
  const [conversationHistory, setConversationHistory] = useState([]);
  const [isLoading, setIsLoading] = useState(false);

  const conversationContainerRef = useRef(null);
  const placeholderIdRef = useRef(null);

  // Generate a unique string-based message ID
  const generateMessageId = () => {
    return `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  };

  useEffect(() => {
    if (conversationContainerRef.current) {
      conversationContainerRef.current.scrollTop = conversationContainerRef.current.scrollHeight;
    }
  }, [conversationHistory]);

  function constructPrompt(userQuery, datasetInfo) {
    return `You are an AI assistant that generates Vega-Lite v5 specifications based on user queries and provided dataset information.
      Given the dataset information below, generate a Vega-Lite JSON specification to answer the user's query. If the dataset is too large or granular, perform sensible aggregation (e.g., mean, sum, or count) on relevant fields to provide a more general visualization.

      **Dataset Information:**
      ${JSON.stringify(datasetInfo, null, 2)}

      **User Query:**
      ${userQuery}

      **Instructions:**
      - Generate a Vega-Lite specification (\`chartSpec\`) that effectively visualizes the data based on the query.
      - If the data contains too many points, use aggregation or sampling where appropriate.
      - Provide a brief description of the chart in plain English (\`description\`).

      **Response Format:**
      {
        "chartSpec": { /* Vega-Lite JSON specification */ },
        "description": "/* Brief description of the chart in plain English */"
      }

      Ensure that:
      - The \`$schema\` in \`chartSpec\` is set to "https://vega.github.io/schema/vega-lite/v5.json".
      - All field names in the specification match exactly those in the dataset.
      - Include the "data" property in the chartSpec with the "values" key set to an empty array. The actual data will be injected later.

      Only provide the JSON response without any additional text. If the query cannot be answered with the dataset, inform the user politely.`;
  }

  function validateDataset(data) {
    if (!data || data.length === 0) {
      return 'The uploaded dataset is empty. Please provide a valid CSV file.';
    }
    return null;
  }

  function shouldGenerateChart(query) {
    const visualizationTerms = ['visualize', 'chart', 'graph', 'plot', 'show', 'display', 'compare', 'trend'];
    return visualizationTerms.some(term => query.toLowerCase().includes(term));
  }

  const handleSendQuery = async () => {
    if (!userQuery.trim() || isLoading) {
      console.log('handleSendQuery: Request blocked (isLoading or empty query)');
      return;
    }

    console.log('handleSendQuery: Sending request');
    setIsLoading(true);

    const userMessageId = generateMessageId();
    const userMessage = { id: userMessageId, sender: 'user', text: userQuery };
    setConversationHistory((prevHistory) => [...prevHistory, userMessage]);

    if (!data) {
      const assistantMessageId = generateMessageId();
      const assistantMessage = { id: assistantMessageId, sender: 'assistant', text: 'Please upload a dataset before sending a message.' };
      setConversationHistory((prevHistory) => [...prevHistory, assistantMessage]);
      setIsLoading(false);
      setUserQuery('');
      return;
    }

    if (!shouldGenerateChart(userQuery)) {
      const assistantMessageId = generateMessageId();
      const assistantMessage = { id: assistantMessageId, sender: 'assistant', text: 'Sure, let me help you with that.' };
      setConversationHistory((prevHistory) => [...prevHistory, assistantMessage]);
      setIsLoading(false);
      setUserQuery('');
      return;
    }

    const datasetInfo = getDatasetInfo(data);
    const prompt = constructPrompt(userQuery, datasetInfo);
    const expectedFields = datasetInfo.columns;

    const validationError = validateDataset(data);
    if (validationError) {
      const assistantMessageId = generateMessageId();
      const assistantMessage = { id: assistantMessageId, sender: 'assistant', text: validationError };
      setConversationHistory((prevHistory) => [...prevHistory, assistantMessage]);
      setIsLoading(false);
      setUserQuery('');
      return;
    }

    const placeholderMessageId = generateMessageId();
    const placeholderMessage = {
      id: placeholderMessageId,
      sender: 'assistant',
      text: 'Working on it... this may take a few seconds.',
    };
    setConversationHistory((prevHistory) => [...prevHistory, placeholderMessage]);
    placeholderIdRef.current = placeholderMessageId;

    try {
      console.log('Sending request to server with prompt:', prompt);
      console.log('Expected fields:', expectedFields);

      const response = await axios.post(`${process.env.REACT_APP_API_URL}/api/generate-chart`, {
        prompt: prompt,
        expectedFields: expectedFields,
      });

      const { chartSpec, description } = response.data;

      console.log('Received chartSpec:', chartSpec);
      console.log('Received description:', description);

      if (chartSpec && description) {
        const sampledData = sampleData(data); 
        chartSpec.data = { values: sampledData };

        setConversationHistory((prevHistory) =>
          prevHistory.map((message) =>
            message.id === placeholderIdRef.current
              ? { ...message, text: description, chartSpec: chartSpec }
              : message
          )
        );
      } else if (description) {
        setConversationHistory((prevHistory) =>
          prevHistory.map((message) =>
            message.id === placeholderIdRef.current
              ? { ...message, text: description }
              : message
          )
        );
      } else {
        setConversationHistory((prevHistory) =>
          prevHistory.map((message) =>
            message.id === placeholderIdRef.current
              ? { ...message, text: 'Received an unexpected response. Please try again.' }
              : message
          )
        );
      }
      setUserQuery('');
    } catch (error) {
      console.error('Error:', error.response ? error.response.data : error.message);

      let errorMessage = 'An error occurred while generating the chart.';

      if (error.response) {
        if (error.response.status === 429) {
          errorMessage = 'Rate limit exceeded. Please wait a moment and try again.';
        } else {
          errorMessage = error.response.data.error || errorMessage;
        }
      }

      setConversationHistory((prevHistory) =>
        prevHistory.map((message) =>
          message.id === placeholderIdRef.current
            ? { ...message, text: errorMessage }
            : message
        )
      );
    } finally {
      console.log('handleSendQuery: Request finished');
      setIsLoading(false);
      placeholderIdRef.current = null;
    }
  };

  const handleInputKeyDown = (e) => {
    if (e.key === 'Enter') {
      console.log('handleInputKeyDown: Enter key pressed');
      e.preventDefault(); 
      handleSendQuery(); 
    }
  };

  const handleClearMessages = () => {
    setConversationHistory([]);
    setUserQuery('');
  };

  return (
    <div className="flex flex-col flex-grow">
      <div
        className="flex-grow overflow-y-auto p-4 rounded-lg bg-[#f0ebe6] max-h-[500px]"
        ref={conversationContainerRef} 
      >
        {conversationHistory.map((message) => (
          <div
            key={message.id}
            className={`mb-4 flex ${
              message.sender === 'user' ? 'justify-end' : 'justify-start'
            }`}
          >
            <div
              className={`flex items-start ${
                message.sender === 'user' ? 'flex-row-reverse' : ''
              }`}
            >
              <img
                src={message.sender === 'user' ? userAvatar : assistantAvatar}
                alt="avatar"
                className="w-8 h-8 rounded-full mx-2"
              />
              <div>
                <div
                  className={`text-sm ${
                    message.sender === 'user' ? 'text-right' : 'text-left'
                  }`}
                >
                  {message.sender === 'user' ? 'You' : 'Assistant'}
                </div>
                <div
                  className={`inline-block px-4 py-2 rounded-lg ${
                    message.sender === 'user'
                      ? 'bg-[#4b284e] text-white'
                      : 'bg-[#3c2a4d] text-white'
                  }`}
                >
                  {message.text}
                </div>
                {message.sender === 'assistant' && message.chartSpec && (
                  <ChartRenderer spec={message.chartSpec} />
                )}
              </div>
            </div>
          </div>
        ))}
      </div>

      <div className="flex items-center mt-4">
        <input
          className="flex-grow p-3 border rounded-full border-gray-300 focus:outline-none focus:ring-2 focus:ring-[#4b284e] text-gray-700"
          type="text"
          placeholder="Type your message here"
          value={userQuery}
          onChange={(e) => setUserQuery(e.target.value)}
          onKeyDown={handleInputKeyDown}
        />
        <button
          className={`ml-2 px-6 py-3 bg-[#4b284e] text-white rounded-full hover:bg-[#5c3c5c] focus:outline-none focus:ring-2 focus:ring-[#4b284e] ${
            isLoading ? 'opacity-50 cursor-not-allowed' : ''
          }`}
          onClick={handleSendQuery}
          disabled={isLoading}
        >
          Send
        </button>
        <button
          className={`ml-2 px-6 py-3 bg-red-500 text-white rounded-full focus:outline-none focus:ring-2 focus:ring-red-500 ${
            isLoading ? 'opacity-50 cursor-not-allowed' : 'hover:bg-red-600'
          }`}
          onClick={handleClearMessages}
          disabled={isLoading}
        >
          Clear Messages
        </button>
      </div>
    </div>
  );
}

function getDatasetInfo(data) {
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
  const sampleValues = values.slice(0, 10);
  const allNumbers = sampleValues.every(
    (v) => typeof v === 'number' && !isNaN(v)
  );
  if (allNumbers) {
    return 'quantitative';
  }

  const allDates = sampleValues.every(
    (v) => v instanceof Date || !isNaN(Date.parse(v))
  );
  if (allDates) {
    return 'temporal';
  }

  const allOrdinals = sampleValues.every(
    (v) => typeof v === 'string' || typeof v === 'number'
  );
  if (allOrdinals) {
    return 'ordinal';
  }

  return 'nominal';
}

function sampleData(data, sampleSize = 1000) {
  if (data.length <= sampleSize) {
    return data;
  }
  
  const step = Math.ceil(data.length / sampleSize);
  return data.filter((_, index) => index % step === 0);
}

function App() {
  const [data, setData] = useState(null);

  const handleFileUploaded = (parsedData) => {
    setData(parsedData);
    console.log('Parsed Data:', parsedData);
  };

  return (
    <div className="flex flex-col min-h-screen bg-[#f9f5f1]">
      <div className="p-6">
        <h1 className="text-3xl font-semibold text-[#4b284e]">
          Data Visualization AI Assistant
        </h1>
      </div>

      <div className="flex flex-col flex-grow p-4 bg-white rounded-t-lg shadow-lg">
        <div className="mb-4">
          <FileUpload onFileUploaded={handleFileUploaded} />
        </div>

        {data && (
          <div className="mb-4">
            <DataPreview data={data} />
          </div>
        )}

        <Chatbot data={data} />
      </div>
    </div>
  );
}

export default App;