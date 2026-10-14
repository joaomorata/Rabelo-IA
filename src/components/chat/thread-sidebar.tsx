import { useEffect, useState } from "react";
import { Link, useNavigate } from "@tanstack/react-router";
import { MessageSquare, Plus, Trash2, LogOut, Terminal } from "lucide-react";
import { toast } from "sonner";

import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";

type Thread = { id: string; title: string; updated_at: string };

export function ThreadSidebar({ activeThreadId }: { activeThreadId: string }) {
  const navigate = useNavigate();
  const [threads, setThreads] = useState<Thread[]>([]);

  useEffect(() => {
    supabase
      .from("threads")
      .select("id, title, updated_at")
      .order("updated_at", { ascending: false })
      .then(({ data, error }) => {
        if (error) toast.error("Não foi possível carregar as conversas.");
        else setThreads(data ?? []);
      });
  }, [activeThreadId]);

  async function createThread() {
    const {
      data: { session },
    } = await supabase.auth.getSession();
    if (!session) {
      navigate({ to: "/login" });
      return;
    }
    const { data, error } = await supabase.from("threads").insert({ user_id: session.user.id }).select("id").single();
    if (error || !data) {
      toast.error("Não foi possível criar a conversa.");
      return;
    }
    navigate({ to: "/chat/$threadId", params: { threadId: data.id } });
  }

  async function deleteThread(id: string) {
    const { error } = await supabase.from("threads").delete().eq("id", id);
    if (error) {
      toast.error("Não foi possível excluir a conversa.");
      return;
    }
    setThreads((prev) => prev.filter((t) => t.id !== id));
    if (id === activeThreadId) {
      const remaining = threads.filter((t) => t.id !== id);
      const next = remaining[0];
      if (next) {
        navigate({ to: "/chat/$threadId", params: { threadId: next.id } });
      } else {
        navigate({ to: "/" });
      }
    }
  }

  async function signOut() {
    await supabase.auth.signOut();
    navigate({ to: "/login" });
  }

  return (
    <aside className="flex w-64 shrink-0 flex-col border-r border-sidebar-border bg-sidebar text-sidebar-foreground">
      <div className="flex items-center gap-2 border-b border-sidebar-border px-4 py-4">
        <div className="flex size-8 items-center justify-center rounded-lg bg-primary/10 text-primary">
          <Terminal className="size-4" />
        </div>
        <span className="font-display text-sm font-bold">
          Rabelo <span className="text-primary">AI</span>
        </span>
      </div>

      <div className="p-3">
        <button
          type="button"
          onClick={createThread}
          className="flex w-full items-center justify-center gap-2 rounded-lg bg-primary px-3 py-2 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90"
        >
          <Plus className="size-4" /> Nova conversa
        </button>
      </div>

      <div className="scrollbar-thin-dark min-h-0 flex-1 overflow-y-auto px-3 pb-3">
        <div className="space-y-1">
          {threads.map((thread) => (
            <div
              key={thread.id}
              className={cn(
                "group flex items-center gap-1 rounded-lg pr-1 transition-colors",
                thread.id === activeThreadId
                  ? "bg-sidebar-accent text-sidebar-accent-foreground"
                  : "hover:bg-sidebar-accent/50",
              )}
            >
              <Link
                to="/chat/$threadId"
                params={{ threadId: thread.id }}
                className="flex min-w-0 flex-1 items-center gap-2 px-3 py-2 text-sm"
              >
                <MessageSquare className="size-3.5 shrink-0 text-muted-foreground" />
                <span className="truncate">{thread.title}</span>
              </Link>
              <button
                type="button"
                aria-label="Excluir conversa"
                onClick={() => deleteThread(thread.id)}
                className="hidden shrink-0 rounded p-1 text-muted-foreground hover:text-destructive group-hover:block"
              >
                <Trash2 className="size-3.5" />
              </button>
            </div>
          ))}
        </div>
      </div>

      <div className="border-t border-sidebar-border p-3">
        <button
          type="button"
          onClick={signOut}
          className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm text-muted-foreground transition-colors hover:bg-sidebar-accent hover:text-foreground"
        >
          <LogOut className="size-4" /> Sair
        </button>
      </div>
    </aside>
  );
}
