import { useEffect, useRef, useState } from 'react';
import { api, type AiAskResponse, type AiChatMessage } from '../api';

function formatCurrency(n: number) {
  return `₹${Number(n || 0).toLocaleString('en-IN', { maximumFractionDigits: 0 })}`;
}

function formatDate(d: string) {
  if (!d) return '';
  return new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
}

const EXAMPLE_QUESTIONS = [
  'Which customers slipped this quarter?',
  'Revenue by product category',
  'Quotations stuck over 10 days',
  'Collections at risk this month',
  'What were our sales in 2024?',
  'Who were our top customers last year?',
];

const MAX_HISTORY_MESSAGES = 20;

interface ChatEntry {
  role: 'user' | 'model';
  text: string;
  result?: AiAskResponse;
  isError?: boolean;
}

function ResultTable({ result }: { result: AiAskResponse }) {
  const { intent, data } = result;
  if (!intent || !data) return null;

  if (intent === 'inactive_customers' && Array.isArray(data.customers)) {
    if (data.customers.length === 0) return null;
    return (
      <div className="overflow-x-auto my-2">
        <table className="w-full text-[12px] border-collapse">
          <thead>
            <tr className="border-b border-[#EEF1F9] text-[#A8AEC4]">
              <th className="text-left py-1.5 px-2">Company</th>
              <th className="text-left py-1.5 px-2">Last Purchase</th>
              <th className="text-right py-1.5 px-2">Total Revenue</th>
            </tr>
          </thead>
          <tbody>
            {data.customers.map((c: any, i: number) => (
              <tr key={i} className="border-b border-[#F7F8FC]">
                <td className="py-1.5 px-2 text-[#141B34]">{c.company_name}</td>
                <td className="py-1.5 px-2 text-[#7A839E]">{formatDate(c.last_purchase)}</td>
                <td className="py-1.5 px-2 text-right font-medium text-[#141B34]">{formatCurrency(c.total_revenue)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  }

  if (intent === 'top_products' && Array.isArray(data.products)) {
    if (data.products.length === 0) return null;
    return (
      <div className="overflow-x-auto my-2">
        <table className="w-full text-[12px] border-collapse">
          <thead>
            <tr className="border-b border-[#EEF1F9] text-[#A8AEC4]">
              <th className="text-left py-1.5 px-2">Product</th>
              <th className="text-right py-1.5 px-2">Revenue</th>
              <th className="text-right py-1.5 px-2">Units</th>
            </tr>
          </thead>
          <tbody>
            {data.products.map((p: any, i: number) => (
              <tr key={i} className="border-b border-[#F7F8FC]">
                <td className="py-1.5 px-2 text-[#141B34]">{p.product_description || p.part_no}</td>
                <td className="py-1.5 px-2 text-right font-medium text-[#141B34]">{formatCurrency(p.revenue)}</td>
                <td className="py-1.5 px-2 text-right text-[#7A839E]">{p.units}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  }

  if (intent === 'quotation_search' && Array.isArray(data.quotations)) {
    if (data.quotations.length === 0) return null;
    return (
      <div className="overflow-x-auto my-2">
        <table className="w-full text-[12px] border-collapse">
          <thead>
            <tr className="border-b border-[#EEF1F9] text-[#A8AEC4]">
              <th className="text-left py-1.5 px-2">Quotation</th>
              <th className="text-left py-1.5 px-2">Company</th>
              <th className="text-right py-1.5 px-2">Value</th>
              <th className="text-right py-1.5 px-2">Status</th>
            </tr>
          </thead>
          <tbody>
            {data.quotations.map((q: any, i: number) => (
              <tr key={i} className="border-b border-[#F7F8FC]">
                <td className="py-1.5 px-2 text-[#3B6FD4] font-mono">{q.number}</td>
                <td className="py-1.5 px-2 text-[#141B34]">{q.company_name}</td>
                <td className="py-1.5 px-2 text-right font-medium text-[#141B34]">{formatCurrency(q.total)}</td>
                <td className="py-1.5 px-2 text-right capitalize text-[#7A839E]">{q.status}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  }

  return null;
}

export default function AskTechnicon({ embedded }: { embedded?: boolean }) {
  const [history, setHistory] = useState<ChatEntry[]>([]);
  const [question, setQuestion] = useState('');
  const [loading, setLoading] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [history, loading]);

  async function sendQuestion(textToSend?: string) {
    const q = (textToSend || question).trim();
    if (!q || loading) return;

    const userEntry: ChatEntry = { role: 'user', text: q };
    setHistory((prev) => [...prev, userEntry]);
    if (!textToSend) setQuestion('');
    setLoading(true);

    try {
      const apiHistory: AiChatMessage[] = history
        .slice(-MAX_HISTORY_MESSAGES)
        .map((entry) => ({ role: entry.role, text: entry.text }));

      const res = await api.ai.ask(q, apiHistory);
      setHistory((prev) => [...prev, { role: 'model', text: res.answer, result: res }]);
    } catch (e: any) {
      setHistory((prev) => [
        ...prev,
        {
          role: 'model',
          text: e.message || 'Sorry, I ran into an error processing that question. Please try again.',
          isError: true,
        },
      ]);
    } finally {
      setLoading(false);
    }
  }

  return (
    <section
      className={`flex flex-col gap-4 bg-[#FFFFFF] border border-[#E4E8F2] rounded-[16px] p-5 select-none ${
        embedded ? 'h-[360px]' : 'min-h-[460px]'
      }`}
    >
      {/* Message Feed Container */}
      <div
        ref={scrollRef}
        data-scroll="1"
        className="flex-1 flex flex-col gap-3 overflow-y-auto max-h-[52vh] pr-1"
      >
        {history.length === 0 ? (
          <div className="flex flex-col gap-2 p-3 text-[13px] text-[#7A839E]">
            <p className="margin-0">
              Ask me questions against your live Technicon data. I read from your records — nothing here is written back.
            </p>
          </div>
        ) : (
          history.map((m, idx) => (
            <div key={idx} className="flex gap-2.75 items-start animate-in fade-in duration-150">
              <span
                aria-hidden="true"
                className={`shrink-0 w-7 h-7 rounded-[8px] bg-[#F7F8FC] border border-[#DCE2F0] grid place-items-center text-[10.5px] font-bold ${
                  m.role === 'model' ? 'text-[#3B6FD4]' : 'text-[#141B34]'
                }`}
              >
                {m.role === 'model' ? 'AI' : 'You'}
              </span>
              <div className="flex flex-col min-w-0 max-w-[76ch]">
                <p className="margin-0 text-[13px] leading-[1.55] text-[#2C3454] text-pretty">
                  {m.text}
                </p>
                {m.result && <ResultTable result={m.result} />}
              </div>
            </div>
          ))
        )}

        {loading && (
          <div className="flex gap-2.75 items-center">
            <span className="shrink-0 w-7 h-7 rounded-[8px] bg-[#F7F8FC] border border-[#DCE2F0] text-[#3B6FD4] grid place-items-center text-[10.5px] font-bold">
              AI
            </span>
            <span className="text-[12.5px] text-[#7A839E] italic">Analyzing live records...</span>
          </div>
        )}
      </div>

      {/* Suggestion Pills */}
      <div className="flex gap-2 flex-wrap pt-2 border-t border-[#EEF1F9]">
        {EXAMPLE_QUESTIONS.slice(0, embedded ? 2 : 4).map((s) => (
          <button
            key={s}
            type="button"
            onClick={() => sendQuestion(s)}
            className="h-[30px] px-2.75 rounded-full bg-transparent border border-[#E4E8F2] text-[#7A839E] text-[12px] cursor-pointer hover:border-[#D9E2F4] hover:text-[#3B6FD4] transition-colors"
          >
            {s}
          </button>
        ))}
      </div>

      {/* Query Form Input */}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          sendQuestion();
        }}
        className="flex gap-2 items-center"
      >
        <input
          type="text"
          placeholder="Ask about revenue, quotations, customers or products"
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          className="flex-1 min-w-0 h-[38px] px-3.25 rounded-[10px] bg-[#F7F8FC] border border-[#E4E8F2] text-[#141B34] text-[13px] outline-none focus:border-[#3B6FD4] placeholder-[#A8AEC4]"
        />
        <button
          type="submit"
          disabled={loading || !question.trim()}
          className="h-[38px] px-4 rounded-[10px] bg-transparent border border-[#D9E2F4] text-[#3B6FD4] font-medium text-[13px] cursor-pointer hover:bg-[#E3EAF7] transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
          Ask
        </button>
      </form>
    </section>
  );
}
