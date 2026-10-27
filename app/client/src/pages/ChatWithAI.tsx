import AskTechnicon from '../components/AskTechnicon';

export default function ChatWithAI() {
  return (
    <div className="ts-page-pad flex flex-col gap-4 pb-6">
      <div className="flex flex-col gap-1.5">
        <h1>
          Chat with AI
        </h1>
        <p className="ts-muted m-0 mt-1.5 text-[14px]">
          Ask questions against your live Technicon data. Read-only.
        </p>
      </div>

      <AskTechnicon />
    </div>
  );
}
