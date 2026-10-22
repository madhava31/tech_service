const DEFAULT_MODEL = process.env.CLAUDE_MODEL || 'claude-3-5-haiku-20241022';

function getApiKey() {
  const key = process.env.ANTHROPIC_API_KEY || process.env.CLAUDE_API_KEY;
  if (!key) {
    throw new Error('ANTHROPIC_API_KEY (or CLAUDE_API_KEY) is not configured.');
  }
  return key;
}

/**
 * Transforms system tool declarations to Anthropic Claude tool schema format.
 */
function toClaudeTools(declarations) {
  return (declarations || []).map((t) => ({
    name: t.name,
    description: t.description,
    input_schema: t.parametersJsonSchema || { type: 'object', properties: {} },
  }));
}

/**
 * Ensures message history conforms to Anthropic's alternating role requirements.
 */
function buildClaudeMessages(history, question) {
  const rawList = [];

  for (const h of history || []) {
    if (!h || !h.text) continue;
    const role = h.role === 'model' || h.role === 'assistant' ? 'assistant' : 'user';
    rawList.push({ role, content: h.text });
  }

  rawList.push({ role: 'user', content: question });

  // Merge consecutive messages with the same role to satisfy Anthropic strict message schema
  const messages = [];
  for (const item of rawList) {
    const prev = messages[messages.length - 1];
    if (prev && prev.role === item.role) {
      if (typeof prev.content === 'string' && typeof item.content === 'string') {
        prev.content = `${prev.content}\n${item.content}`;
      }
    } else {
      messages.push({ ...item });
    }
  }

  // Ensure conversation starts with a user message
  if (messages.length > 0 && messages[0].role !== 'user') {
    messages.shift();
  }

  return messages;
}

async function callClaudeApi(apiKey, body) {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const errorText = await res.text();
    throw new Error(`Claude API error (${res.status}): ${errorText}`);
  }

  return await res.json();
}

/**
 * Two-turn tool-calling exchange with Claude:
 * Turn 1: Claude either answers directly or issues a tool_use block.
 * Turn 2: Backend feeds tool result back so Claude answers grounded in actual database data.
 */
export async function askClaude({ question, systemInstruction, toolDeclarations, executeToolFn, history }) {
  const apiKey = getApiKey();
  const tools = toClaudeTools(toolDeclarations);
  const messages = buildClaudeMessages(history, question);

  const turn1 = await callClaudeApi(apiKey, {
    model: DEFAULT_MODEL,
    max_tokens: 1024,
    system: systemInstruction,
    messages,
    tools,
    temperature: 0.2,
  });

  const toolCall = turn1.content?.find((block) => block.type === 'tool_use');

  if (!toolCall) {
    const textBlock = turn1.content?.find((block) => block.type === 'text');
    return {
      text: textBlock?.text || '',
      intent: null,
      data: null,
      label: null,
      toolParams: null,
    };
  }

  // Execute the requested business query tool
  const { label, params, data } = await executeToolFn(toolCall.name, toolCall.input || {});

  // Send tool result back to Claude for final synthesized response
  const turn2Messages = [
    ...messages,
    { role: 'assistant', content: turn1.content },
    {
      role: 'user',
      content: [
        {
          type: 'tool_result',
          tool_use_id: toolCall.id,
          content: JSON.stringify(data),
        },
      ],
    },
  ];

  const turn2 = await callClaudeApi(apiKey, {
    model: DEFAULT_MODEL,
    max_tokens: 1024,
    system: systemInstruction,
    messages: turn2Messages,
    tools,
    temperature: 0.2,
  });

  const finalText = turn2.content?.find((block) => block.type === 'text')?.text || '';

  return {
    text: finalText,
    intent: toolCall.name,
    data,
    label,
    toolParams: params,
  };
}
