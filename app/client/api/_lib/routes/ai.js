import { Router } from 'express';
import { askGemini } from '../ai/gemini.js';
import { askClaude } from '../ai/claude.js';
import { SYSTEM_INSTRUCTION } from '../ai/prompt.js';
import { TOOL_DECLARATIONS, executeTool } from '../ai/tools.js';

const router = Router();
const MAX_QUESTION_LENGTH = 500;
const MAX_HISTORY_MESSAGES = 20; // ~10 back-and-forth turns — enough for follow-up context, bounded against unbounded growth
const MAX_HISTORY_TEXT_LENGTH = 2000;

// History is client-supplied (the browser keeps the running conversation), so it is validated the
// same way any other request body input is: wrong shape or oversized entries are dropped rather
// than trusted, and only the last MAX_HISTORY_MESSAGES survive. This never grants any additional
// capability — it only changes how the model interprets natural language; every tool call the model
// requests for the CURRENT turn still passes through the exact same executeTool() authorization.
function sanitizeHistory(raw) {
  if (!Array.isArray(raw)) return [];
  const cleaned = [];
  for (const item of raw) {
    if (!item || (item.role !== 'user' && item.role !== 'model' && item.role !== 'assistant')) continue;
    if (typeof item.text !== 'string' || !item.text.trim()) continue;
    cleaned.push({ role: item.role === 'assistant' ? 'model' : item.role, text: item.text.slice(0, MAX_HISTORY_TEXT_LENGTH) });
  }
  return cleaned.slice(-MAX_HISTORY_MESSAGES);
}

router.post('/ask', async (req, res) => {
  const question = typeof req.body?.question === 'string' ? req.body.question.trim() : '';
  if (!question) return res.status(400).json({ error: 'Please enter a question.' });
  if (question.length > MAX_QUESTION_LENGTH) {
    return res.status(400).json({ error: `Please keep your question under ${MAX_QUESTION_LENGTH} characters.` });
  }
  const history = sanitizeHistory(req.body?.history);

  try {
    const useClaude = !!(process.env.ANTHROPIC_API_KEY || process.env.CLAUDE_API_KEY);
    const askFn = useClaude ? askClaude : askGemini;

    const result = await askFn({
      question,
      systemInstruction: SYSTEM_INSTRUCTION,
      toolDeclarations: TOOL_DECLARATIONS,
      executeToolFn: executeTool,
      history,
    });

    res.json({
      answer: result.text,
      intent: result.intent,
      data: result.data,
      sources: result.intent ? [{ type: 'business_query', label: result.label }] : [],
      meta: { generatedAt: new Date().toISOString(), params: result.toolParams || {} },
    });
  } catch (err) {
    console.error('AI assistant error:', err.message);
    res.status(500).json({ error: 'The assistant is unavailable right now. Please try again.' });
  }
});

export default router;
