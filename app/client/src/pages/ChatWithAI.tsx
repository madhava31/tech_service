import AskTechnicon from '../components/AskTechnicon';

export default function ChatWithAI() {
  return (
    <div className="p-6 flex flex-col gap-6 bg-[#F4F6FC] text-[#141B34] min-h-screen">
      <div className="flex flex-col gap-1.5">
        <h1 className="margin-0 text-[34px] font-medium tracking-[-.02em] leading-[1.05]">
          Chat with AI
        </h1>
        <p className="margin-0 text-[13.5px] text-[#7A839E]">
          Ask questions against your live Technicon data. Read-only.
        </p>
      </div>

      <AskTechnicon />
    </div>
  );
}
