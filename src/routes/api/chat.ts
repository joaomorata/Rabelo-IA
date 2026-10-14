import { createFileRoute } from "@tanstack/react-router";
import { createOpenAI } from "@ai-sdk/openai";
import { convertToModelMessages, streamText, type UIMessage } from "ai";

import type { Json } from "@/integrations/supabase/types";
import {
  createLovableAiGatewayRunIdFetch,
  getLovableAiGatewayRunId,
  withLovableAiGatewayRunIdHeader,
} from "@/lib/server/run-id";

const SYSTEM_PROMPT = `Você é o Rabelo AI, um agente de inteligência artificial especializado em desenvolvimento de software, engenharia de sistemas, análise de código e resolução de problemas complexos de programação.

Aja como um engenheiro de software experiente: analítico, preciso, organizado, transparente e orientado a resultados.

Diretrizes:
- Responda sempre em português brasileiro, a menos que o usuário peça outro idioma.
- Seja direto, técnico e didático. Ajuste a profundidade à experiência do usuário.
- Use blocos de código com a linguagem indicada, listas e exemplos quando ajudarem.
- Não invente APIs, bibliotecas, arquivos, resultados de testes ou capacidades.
- Ao propor código, entregue trechos completos e considere erros, casos extremos e segurança.
- Quando houver várias soluções, compare brevemente e recomende a mais adequada.
- Se faltar informação, peça apenas o necessário para avançar.
- Nunca reproduza segredos, credenciais ou tokens que apareçam no contexto.`;

export const Route = createFileRoute("/api/chat")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const authHeader = request.headers.get("authorization");
        const token = authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : null;
        if (!token) {
          return Response.json({ error: "Você precisa estar conectado para conversar." }, { status: 401 });
        }

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const {
          data: { user },
          error: authError,
        } = await supabaseAdmin.auth.getUser(token);
        if (authError || !user) {
          return Response.json({ error: "Sessão inválida. Entre novamente." }, { status: 401 });
        }

        let body: { threadId?: string; messages?: UIMessage[] };
        try {
          body = await request.json();
        } catch {
          return Response.json({ error: "Pedido inválido." }, { status: 400 });
        }

        const { threadId, messages } = body;
        if (!threadId || !Array.isArray(messages) || messages.length === 0) {
          return Response.json({ error: "Conversa ou mensagens ausentes." }, { status: 400 });
        }

        const { data: thread } = await supabaseAdmin
          .from("threads")
          .select("id, title")
          .eq("id", threadId)
          .eq("user_id", user.id)
          .maybeSingle();
        if (!thread) {
          return Response.json({ error: "Conversa não encontrada." }, { status: 403 });
        }

        const lastUserMessage = [...messages].reverse().find((m) => m.role === "user");
        if (lastUserMessage) {
          const { error: insertError } = await supabaseAdmin.from("messages").insert({
            thread_id: threadId,
            role: "user",
            parts: lastUserMessage.parts as unknown as Json,
          });
          if (insertError) {
            console.error("[chat] failed to save user message", insertError);
            return Response.json({ error: "Não foi possível salvar sua mensagem." }, { status: 500 });
          }

          // Título automático a partir da primeira mensagem
          if (thread.title === "Nova conversa") {
            const firstText =
              lastUserMessage.parts
                ?.filter((p): p is { type: "text"; text: string } => p.type === "text")
                .map((p) => p.text)
                .join(" ")
                .trim() ?? "";
            if (firstText) {
              const title = firstText.length > 60 ? `${firstText.slice(0, 60)}…` : firstText;
              await supabaseAdmin.from("threads").update({ title, updated_at: new Date().toISOString() }).eq("id", threadId);
            }
          } else {
            await supabaseAdmin.from("threads").update({ updated_at: new Date().toISOString() }).eq("id", threadId);
          }
        }

        const apiKey = process.env["LOVABLE_API_KEY"];
        if (!apiKey) {
          return Response.json({ error: "Serviço de IA não configurado." }, { status: 500 });
        }

        const modelMessages = await convertToModelMessages(messages);
        const runIdFetch = createLovableAiGatewayRunIdFetch(getLovableAiGatewayRunId(request));
        const provider = createOpenAI({
          baseURL: "https://ai.gateway.lovable.dev/v1",
          apiKey,
          headers: { "Lovable-API-Key": apiKey, "X-Lovable-AIG-SDK": "vercel-ai-sdk" },
          fetch: runIdFetch.fetch,
        });

        const result = streamText({
          model: provider.responses("openai/gpt-6-astra"),
          system: SYSTEM_PROMPT,
          messages: modelMessages,
          abortSignal: request.signal,
          providerOptions: {
            openai: {
              store: false,
              forceReasoning: true,
              reasoningEffort: "medium",
              reasoningSummary: "auto",
              include: ["reasoning.encrypted_content"],
            },
          },
        });

        const streamResponse = result.toUIMessageStreamResponse({
          originalMessages: messages,
          sendReasoning: true,
          onFinish: async ({ responseMessage }) => {
            const { error } = await supabaseAdmin.from("messages").insert({
              thread_id: threadId,
              role: "assistant",
              parts: responseMessage.parts as unknown as Json,
            });
            if (error) {
              console.error("[chat] failed to save assistant message", error);
            }
          },
        });

        return withLovableAiGatewayRunIdHeader(streamResponse, runIdFetch);
      },
    },
  },
});
