import { useEffect, useState } from 'react';
import AskTechnicon from './AskTechnicon';

// Global floating chat widget (Updating 6.1) — a presentation shell only. All question/answer
// logic, API calls, and result rendering are the exact same AskTechnicon component already used
// on the Dashboard card and the /chat-with-ai page (Step 6.1) — nothing here talks to
// /api/ai/ask directly. "Minimize" and "close" are intentionally the same action (both just hide
// the panel); the panel is toggled via CSS (not conditional JSX), so AskTechnicon stays mounted
// underneath and the last question/answer is preserved when reopened, since there's no separate
// "conversation session" concept to distinguish between the two.
export default function FloatingChat() {
  const [open, setOpen] = useState(false);
  // The dock's sparkle button opens the assistant.
  useEffect(() => {
    const onOpen = () => setOpen(true);
    window.addEventListener('open-ask-technicon', onOpen);
    return () => window.removeEventListener('open-ask-technicon', onOpen);
  }, []);

  return (
    <div className="chat-widget">
      <div className="chat-panel" style={{ display: open ? 'flex' : 'none' }} role="dialog" aria-label="Ask TECHNICON">
        <div className="chat-panel-header">
          <div className="chat-panel-brand">
            <div className="brand-mark">TS</div>
            <div>
              <div className="chat-panel-title">✨ Ask TECHNICON</div>
              <div className="chat-panel-subtitle">TECHNICON SERVICES</div>
            </div>
          </div>
          <div className="chat-panel-actions">
            <button type="button" title="Minimize" aria-label="Minimize" onClick={() => setOpen(false)}>–</button>
            <button type="button" title="Close" aria-label="Close" onClick={() => setOpen(false)}>×</button>
          </div>
        </div>
        <div className="chat-panel-body">
          <p className="muted" style={{ marginTop: 0 }}>👋 Hi! Ask me anything about your business data.</p>
          <AskTechnicon embedded />
        </div>
      </div>

      {!open && (
        <div className="chat-bubble-wrap">
          <div className="chat-teaser">How can I help you?</div>
          <button type="button" className="chat-bubble" aria-label="Open Ask TECHNICON" onClick={() => setOpen(true)}>
            TS
          </button>
        </div>
      )}
    </div>
  );
}
