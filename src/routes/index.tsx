import { useEffect, useRef, useState } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { Terminal, Loader2 } from "lucide-react";

import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Rabelo AI — Agente de engenharia de software" },
      {
        name: "description",
        content:
          "Converse com o Rabelo AI: um agente de IA especializado em desenvolvimento de software, análise de código e depuração. Histórico de conversas salvo na nuvem.",
      },
      { property: "og:title", content: "Rabelo AI — Agente de engenharia de software" },
      {
        property: "og:description",
        content: "Um agente de IA especializado em desenvolvimento de software, análise de código e depuração.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: Index,
});

function Index() {
  const navigate = useNavigate();
  const started = useRef(false);
  const [status, setStatus] = useState("Preparando seu ambiente…");

  useEffect(() => {
    if (started.current) return;
    started.current = true;

    (async () => {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (!session) {
        navigate({ to: "/login", replace: true });
        return;
      }

      const { data: threads } = await supabase
        .from("threads")
        .select("id")
        .order("updated_at", { ascending: false })
        .limit(1);

      const latest = threads?.[0];
      if (latest) {
        navigate({ to: "/chat/$threadId", params: { threadId: latest.id }, replace: true });
        return;
      }

      setStatus("Criando sua primeira conversa…");
      const { data: thread, error } = await supabase
        .from("threads")
        .insert({ user_id: session.user.id })
        .select("id")
        .single();

      if (error || !thread) {
        setStatus("Não foi possível criar a conversa. Recarregue a página.");
        return;
      }
      navigate({ to: "/chat/$threadId", params: { threadId: thread.id }, replace: true });
    })();
  }, [navigate]);

  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-background">
      <div className="flex size-12 items-center justify-center rounded-xl bg-primary/10 text-primary">
        <Terminal className="size-6" />
      </div>
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="size-4 animate-spin" />
        {status}
      </div>
    </div>
  );
}
