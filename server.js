// OpenRecovery Sales Practice Backend
// Deploy this to Render (free tier) and point your static HTML files at it

const express = require('express');
const cors = require('cors');
const OpenAI = require('openai');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors()); // Allow all origins (you can restrict later)
app.use(express.json());

// Initialize OpenAI
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

// Health check
app.get('/', (req, res) => {
  res.json({ 
    status: 'ok', 
    message: 'OpenRecovery Sales Practice API',
    endpoints: ['/chat', '/feedback']
  });
});

// Chat endpoint
app.post('/chat', async (req, res) => {
  try {
    const { messages, systemPrompt, temperature = 0.8, maxTokens = 300 } = req.body;

    if (!messages || !Array.isArray(messages)) {
      return res.status(400).json({ error: 'messages array required' });
    }

    const fullMessages = [
      { role: 'system', content: systemPrompt },
      ...messages
    ];

    const completion = await openai.chat.completions.create({
      model: 'gpt-4o',
      messages: fullMessages,
      temperature: temperature,
      max_tokens: maxTokens
    });

    res.json({
      reply: completion.choices[0].message.content
    });

  } catch (error) {
    console.error('Chat error:', error);
    res.status(500).json({ 
      error: error.message || 'Failed to process chat' 
    });
  }
});

// Feedback endpoint
app.post('/feedback', async (req, res) => {
  try {
    const { conversation } = req.body;

    if (!conversation || !Array.isArray(conversation)) {
      return res.status(400).json({ error: 'conversation array required' });
    }

    const conversationText = conversation
      .map(m => `${m.role === 'user' ? 'Salesperson' : 'Prospect'}: ${m.content}`)
      .join('\n\n');

    const feedbackPrompt = `Review this sales conversation and provide constructive feedback. Focus on:
1. How well did they understand the prospect's needs?
2. Did they handle objections effectively?
3. Did they guide toward an appropriate pricing tier?
4. What could they improve?

Conversation:
${conversationText}

Provide specific, actionable feedback in 3-4 bullet points.`;

    const completion = await openai.chat.completions.create({
      model: 'gpt-4o',
      messages: [
        { role: 'system', content: 'You are a sales coach providing feedback on roleplay conversations.' },
        { role: 'user', content: feedbackPrompt }
      ],
      temperature: 0.7,
      max_tokens: 500
    });

    res.json({
      reply: completion.choices[0].message.content
    });

  } catch (error) {
    console.error('Feedback error:', error);
    res.status(500).json({ 
      error: error.message || 'Failed to generate feedback' 
    });
  }
});

app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
});
