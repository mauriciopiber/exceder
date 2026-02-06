"use client";

import { ClaudeChatStandalone } from "@/components/claude-chat";

export default function ChatTestPage() {
  return (
    <div className="min-h-screen bg-background p-8">
      <h1 className="text-2xl font-bold mb-6">Claude Chat UI POC</h1>
      <ClaudeChatStandalone />
    </div>
  );
}
