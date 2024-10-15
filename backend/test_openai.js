require('dotenv').config();
const axios = require('axios');

async function testOpenAI() {
  try {
    const response = await axios.post(
      'https://api.openai.com/v1/chat/completions',
      {
        model: 'gpt-3.5-turbo',
        messages: [{ role: 'user', content: 'Hello, world!' }],
        max_tokens: 5,
      },
      {
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
        },
      }
    );
    console.log('Test successful:', response.data);
  } catch (error) {
    if (error.response) {
      console.error('Test failed:', error.response.status, error.response.data);
    } else {
      console.error('Test failed:', error.message);
    }
  }
}

testOpenAI();