import React, { useState, useEffect, useRef } from 'react';
import { VegaLite } from 'react-vega';
import axios from 'axios';
import { FileUpload, DataPreview } from './csvhandle.js';
import userAvatar from './pictures/user.jpg';
import assistantAvatar from './pictures/aiassistant.jpg';
import Spinner from './Spinner';

function formatStatisticOutput(output) {
  if (typeof output === 'object' && output !== null) {
    return Object.entries(output)
      .map(([key, value]) => `${key}: ${value}`)
      .join('\n');
  }
  return output.toString();
}

const debugDataFlow = {
  validatePayload: (data, query, datasetInfo) => {
    const issues = [];
    
    if (!data || data.length === 0) {
      issues.push("Data array is empty or null");
    } else {
      console.log("Data sample:", data.slice(0, 2));
    }
    
    if (!datasetInfo) {
      issues.push("Dataset info is null");
    } else {
      if (!datasetInfo.columns || datasetInfo.columns.length === 0) {
        issues.push("No columns defined in dataset info");
      }
      if (!datasetInfo.dataTypes || Object.keys(datasetInfo.dataTypes).length === 0) {
        issues.push("No data types defined in dataset info");
      }
      console.log("Dataset info:", JSON.stringify(datasetInfo, null, 2));
    }
    
    if (!query || query.trim().length === 0) {
      issues.push("Query is empty");
    }
    
    return {
      isValid: issues.length === 0,
      issues,
      debugInfo: {
        dataLength: data?.length,
        columnCount: datasetInfo?.columns?.length,
        query: query
      }
    };
  },

  validateResponse: (response) => {
    const issues = [];
    
    if (!response) {
      issues.push("Response is null");
      return { isValid: false, issues };
    }
    
    if (response.chartSpec) {
      if (!response.chartSpec.mark) {
        issues.push("Chart spec missing 'mark' property");
      }
      if (!response.chartSpec.encoding) {
        issues.push("Chart spec missing 'encoding' property");
      }
    }
    
    if (response.error) {
      issues.push(`Server error: ${response.error}`);
    }
    
    return {
      isValid: issues.length === 0,
      issues,
      debugInfo: {
        hasChartSpec: !!response.chartSpec,
        hasDescription: !!response.description,
        hasOutput: !!response.output,
        hasError: !!response.error
      }
    };
  }
};

function ChartRenderer({ spec }) {
  if (!spec) {
    return null;
  }

  try {
    if (!spec.mark || !spec.encoding) {
      throw new Error('Invalid chart specification: missing required properties');
    }

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

  const placeholderIdRef = useRef(null);
  const messagesEndRef = useRef(null);

  const generateMessageId = () => {
    return `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  };

  useEffect(() => {
    if (messagesEndRef.current) {
      messagesEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [conversationHistory]);

  function validateDataset(data) {
    if (!data || data.length === 0) {
      return 'The uploaded dataset is empty. Please provide a valid CSV file.';
    }
    
    const firstRow = data[0];
    if (!firstRow || typeof firstRow !== 'object') {
      return 'Invalid data format. Please ensure your CSV file has headers.';
    }
    
    const emptyColumns = Object.keys(firstRow).filter(key => key.trim() === '');
    if (emptyColumns.length > 0) {
      return 'Dataset contains empty column headers. Please fix your CSV file.';
    }
    
    return null;
  }

  const handleSendQuery = async () => {
    if (!userQuery.trim() || isLoading) {
      console.log('handleSendQuery: Request blocked (isLoading or empty query)');
      return;
    }

    console.log('handleSendQuery: Starting request processing');
    setIsLoading(true);

    const userMessageId = generateMessageId();
    const userMessage = { id: userMessageId, sender: 'user', text: userQuery };
    setConversationHistory((prevHistory) => [...prevHistory, userMessage]);

    if (!data) {
      const assistantMessageId = generateMessageId();
      const assistantMessage = {
        id: assistantMessageId,
        sender: 'assistant',
        text: 'Please upload a dataset before sending a message.',
      };
      setConversationHistory((prevHistory) => [...prevHistory, assistantMessage]);
      setIsLoading(false);
      setUserQuery('');
      return;
    }
    
    const validationError = validateDataset(data);
    if (validationError) {
      const assistantMessageId = generateMessageId();
      const assistantMessage = {
        id: assistantMessageId,
        sender: 'assistant',
        text: validationError,
      };
      setConversationHistory((prevHistory) => [...prevHistory, assistantMessage]);
      setIsLoading(false);
      setUserQuery('');
      return;
    }
    
    const datasetInfo = getDatasetInfo(data);
    console.log('Dataset Info:', JSON.stringify(datasetInfo, null, 2));

    const validationResult = debugDataFlow.validatePayload(data, userQuery, datasetInfo);
    if (!validationResult.isValid) {
      console.error("Payload validation failed:", validationResult.issues);
      const assistantMessageId = generateMessageId();
      const assistantMessage = {
        id: assistantMessageId,
        sender: 'assistant',
        text: `Error: ${validationResult.issues.join(', ')}`,
      };
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
      isLoading: true,
    };
    setConversationHistory((prevHistory) => [...prevHistory, placeholderMessage]);
    placeholderIdRef.current = placeholderMessageId;

    try {
      console.log('Sending request to server with validated payload');

      const response = await axios.post(
        `${process.env.REACT_APP_API_URL}/api/generate-response`,
        {
          userQuery: userQuery,
          datasetInfo: datasetInfo,
          data: data,
        }
      );

      console.log('Received response from server:', response);

      const responseValidation = debugDataFlow.validateResponse(response.data);
      if (!responseValidation.isValid) {
        console.error("Response validation failed:", responseValidation.issues);
        throw new Error(responseValidation.issues.join(', '));
      }

      const { chartSpec, description, output, error } = response.data;
      const currentPlaceholderId = placeholderIdRef.current;

      if (error) {
        setConversationHistory((prevHistory) =>
          prevHistory.map((message) =>
            message.id === currentPlaceholderId
              ? { ...message, text: error, isLoading: false }
              : message
          )
        );
        console.log('Updated with error message');
      } else if (chartSpec && description) {
        if (!chartSpec.mark || !chartSpec.encoding) {
          throw new Error('Invalid chart specification received from server');
        }
        
        const sampledData = sampleData(data);
        chartSpec.data = { values: sampledData };

        setConversationHistory((prevHistory) =>
          prevHistory.map((message) =>
            message.id === currentPlaceholderId
              ? {
                  ...message,
                  text: description,
                  chartSpec: chartSpec,
                  isLoading: false,
                }
              : message
          )
        );
        console.log('Updated with chart and description');
      } else if (output !== undefined) {
        // Updated output handling using formatStatisticOutput
        const formattedOutput = formatStatisticOutput(output);
        setConversationHistory((prevHistory) =>
          prevHistory.map((message) =>
            message.id === currentPlaceholderId
              ? { ...message, text: formattedOutput, isLoading: false }
              : message
          )
        );
        console.log('Updated with formatted output:', formattedOutput);
      } else {
        throw new Error('Invalid response format from server');
      }
    } catch (error) {
      console.error('Error:', error.response ? error.response.data : error.message);

      let errorMessage = 'An error occurred while processing your request. ';
      if (error.response) {
        if (error.response.status === 429) {
          errorMessage = 'Rate limit exceeded. Please wait a moment and try again.';
        } else {
          errorMessage += error.response.data.error || error.message;
        }
      } else {
        errorMessage += error.message;
      }

      const currentPlaceholderId = placeholderIdRef.current;
      setConversationHistory((prevHistory) =>
        prevHistory.map((message) =>
          message.id === currentPlaceholderId
            ? { ...message, text: errorMessage, isLoading: false }
            : message
        )
      );
    } finally {
      console.log('handleSendQuery: Request finished');
      setIsLoading(false);
      placeholderIdRef.current = null;
      setUserQuery('');
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
      <div className="h-[500px] overflow-y-auto p-4 rounded-lg bg-[#f0ebe6]">
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
                  className={`inline-block px-4 py-2 rounded-lg whitespace-pre-wrap ${
                    message.sender === 'user'
                      ? 'bg-[#4b284e] text-white'
                      : 'bg-[#3c2a4d] text-white'
                  }`}
                >
                  {message.isLoading ? (
                    <div className="flex items-center">
                      <Spinner />
                      <span className="ml-2">{message.text}</span>
                    </div>
                  ) : (
                    message.text
                  )}
                </div>
                {message.sender === 'assistant' && message.chartSpec && (
                  <ChartRenderer spec={message.chartSpec} />
                )}
              </div>
            </div>
          </div>
        ))}
        <div ref={messagesEndRef} />
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

  const allNumbers = sampleValues.every(
    (v) => !isNaN(Number(v)) && v !== ''
  );
  if (allNumbers) {
    return 'quantitative';
  }

  const allDates = sampleValues.every(
    (v) => !isNaN(Date.parse(String(v)))
  );
  if (allDates) {
    return 'temporal';
  }

  const uniqueValues = new Set(sampleValues);
  const uniqueRatio = uniqueValues.size / sampleValues.length;
  
  if (uniqueRatio < 0.3) {
    return 'ordinal';
  }

  return 'nominal';
}

function sampleData(data, sampleSize = 1000) {
  if (!data || data.length === 0) {
    console.error('sampleData: Empty or null data provided');
    return [];
  }

  if (data.length <= sampleSize) {
    return data;
  }

  const result = [];
  const step = data.length / sampleSize;
  
  for (let i = 0; i < sampleSize; i++) {
    const index = Math.floor(i * step);
    if (index < data.length) {
      result.push(data[index]);
    }
  }

  return result;
}

function App() {
  const [data, setData] = useState(null);

  const handleFileUploaded = (parsedData) => {
    if (!parsedData || parsedData.length === 0) {
      console.error('Empty or invalid data received from file upload');
      return;
    }
    
    setData(parsedData);
    console.log('Parsed Data Sample:', parsedData.slice(0, 2));
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