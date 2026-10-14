import { useEffect, useState } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { Loader2 } from "lucide-react";

import { supabase } from "@/integrations/supabase/client";
import { ThreadSidebar } from "@/components/chat/thread-sidebar";
import { ChatWindow } from "@/components/chat/chat-window";

export const Route = createFileRoute("/chat/$threadId")({
  head: () => ({
    meta: [
      { title: "Conversa — Rabelo AI" },
      { name: "description", content: "Conversa com o Rabelo AI, seu agente de engenharia de software." },
      { property: "og:title", content: "Conversa — Rabelo AI" },
      { property: "og:description", content: "Conversa com o Rabelo AI, seu agente de engenharia de software." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: ChatPage,
});

function ChatPage() {
  const { threadId } = Route.useParams();
  const navigate = useNavigate();
  const [ready, setReady] = useState(false);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      if (!data.session) {
        navigate({ to: "/login", replace: true });
      } else {
        setReady(true);
      }
    });
  }, [navigate]);

  if (!ready) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <Loader2 className="size-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="flex h-screen overflow-hidden bg-background">
      <ThreadSidebar activeThreadId={threadId} />
      <main className="flex min-w-0 flex-1 flex-col">
        <ChatWindow key={threadId} threadId={threadId} />
      </main>
    </div>
  );
}
