import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport, type FileUIPart, type UIMessage } from "ai";
import { ArrowUp, FileText, ImageIcon, Link2, Loader2, Plus, Square, Terminal, Brain, X } from "lucide-react";
import { toast } from "sonner";

import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";

const MAX_FILE_SIZE = 4 * 1024 * 1024; // 4 MB por arquivo
const MAX_FILES = 5;

type PendingFile = { id: string; file: File; previewUrl: string | null };

function isTextLike(file: File) {
  return (
    file.type.startsWith("text/") ||
    /\.(txt|md|json|csv|xml|ya?ml|toml|js|jsx|ts|tsx|py|java|c|cpp|h|cs|go|rs|rb|php|html|css|sql|sh|env|log)$/i.test(file.name)
  );
}

function readAsDataURL(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(new Error("Falha ao ler arquivo"));
    reader.readAsDataURL(file);
  });
}

function readAsText(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(new Error("Falha ao ler arquivo"));
    reader.readAsText(file);
  });
}

function MessageText({ text }: { text: string }) {
  // Renderização simples de markdown: blocos de código ``` e código inline `
  const blocks = text.split(/```(\w*)\n?([\s\S]*?)(?:```|$)/g);
  const parts: React.ReactNode[] = [];
  for (let i = 0; i < blocks.length; i++) {
    if (i % 3 === 0) {
      const segment = blocks[i];
      if (!segment) continue;
      parts.push(
        <span key={i} className="whitespace-pre-wrap">
          {segment.split(/`([^`]+)`/g).map((piece, j) =>
            j % 2 === 1 ? (
              <code key={j} className="rounded bg-muted px-1.5 py-0.5 font-display text-[0.85em] text-primary">
                {piece}
              </code>
            ) : (
              piece
            ),
          )}
        </span>,
      );
    } else if (i % 3 === 2) {
      const lang = blocks[i - 1] || "code";
      parts.push(
        <div key={i} className="my-3 overflow-hidden rounded-lg border border-border bg-background">
          <div className="border-b border-border px-3 py-1.5 font-display text-xs text-muted-foreground">{lang}</div>
          <pre className="overflow-x-auto p-3 font-display text-sm leading-relaxed text-foreground">
            <code>{blocks[i]}</code>
          </pre>
        </div>,
      );
    }
  }
  return <>{parts}</>;
}

export function ChatWindow({ threadId }: { threadId: string }) {
  const navigate = useNavigate();
  const [input, setInput] = useState("");
  const [loadingHistory, setLoadingHistory] = useState(true);
  const [pendingFiles, setPendingFiles] = useState<PendingFile[]>([]);
  const [attachMenuOpen, setAttachMenuOpen] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const attachMenuRef = useRef<HTMLDivElement>(null);

  const { messages, setMessages, sendMessage, stop, status } = useChat({
    id: threadId,
    transport: new DefaultChatTransport({
      api: "/api/chat",
      headers: async () => {
        const {
          data: { session },
        } = await supabase.auth.getSession();
        return session ? { Authorization: `Bearer ${session.access_token}` } : {};
      },
      body: { threadId },
    }),
    onError: (error) => {
      toast.error(error.message || "Algo deu errado. Tente novamente.");
    },
  });

  const busy = status === "submitted" || status === "streaming";

  // O componente é remontado a cada conversa (key={threadId}), então este
  // efeito carrega o histórico uma vez por montagem.
  useEffect(() => {
    let cancelled = false;
    setLoadingHistory(true);
    supabase
      .from("messages")
      .select("role, parts, created_at")
      .eq("thread_id", threadId)
      .order("created_at", { ascending: true })
      .then(({ data, error }) => {
        if (cancelled) return;
        if (error) {
          toast.error("Não foi possível carregar o histórico.");
        } else if (data) {
          setMessages(
            data.map((row, i) => ({
              id: `${threadId}-${i}`,
              role: row.role as UIMessage["role"],
              parts: row.parts as UIMessage["parts"],
            })),
          );
        }
        setLoadingHistory(false);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [threadId]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, status]);

  const focusComposer = useCallback(() => {
    textareaRef.current?.focus();
  }, []);

  useEffect(() => {
    focusComposer();
  }, [threadId, focusComposer]);

  useEffect(() => {
    if (status === "ready") focusComposer();
  }, [status, focusComposer]);

  // Fecha o menu de anexos ao clicar fora
  useEffect(() => {
    if (!attachMenuOpen) return;
    function onClickOutside(e: MouseEvent) {
      if (attachMenuRef.current && !attachMenuRef.current.contains(e.target as Node)) {
        setAttachMenuOpen(false);
      }
    }
    document.addEventListener("mousedown", onClickOutside);
    return () => document.removeEventListener("mousedown", onClickOutside);
  }, [attachMenuOpen]);

  function addFiles(fileList: FileList | File[]) {
    const files = Array.from(fileList);
    const accepted: PendingFile[] = [];
    for (const file of files) {
      if (pendingFiles.length + accepted.length >= MAX_FILES) {
        toast.error(`Máximo de ${MAX_FILES} arquivos por mensagem.`);
        break;
      }
      if (file.size > MAX_FILE_SIZE) {
        toast.error(`"${file.name}" passa de 4 MB.`);
        continue;
      }
      const isImage = file.type.startsWith("image/");
      const isPdf = file.type === "application/pdf";
      if (!isImage && !isPdf && !isTextLike(file)) {
        toast.error(`Tipo não suportado: "${file.name}". Envie imagem, PDF ou arquivo de texto/código.`);
        continue;
      }
      accepted.push({
        id: crypto.randomUUID(),
        file,
        previewUrl: isImage ? URL.createObjectURL(file) : null,
      });
    }
    if (accepted.length > 0) setPendingFiles((prev) => [...prev, ...accepted]);
  }

  function removePendingFile(id: string) {
    setPendingFiles((prev) => {
      const target = prev.find((p) => p.id === id);
      if (target?.previewUrl) URL.revokeObjectURL(target.previewUrl);
      return prev.filter((p) => p.id !== id);
    });
  }

  function insertLink() {
    const url = window.prompt("Cole o link que deseja compartilhar:");
    if (!url) return;
    const trimmed = url.trim();
    if (!/^https?:\/\/.+/i.test(trimmed)) {
      toast.error("Link inválido. Use um endereço começando com http:// ou https://");
      return;
    }
    setInput((prev) => (prev ? `${prev}\n${trimmed}` : trimmed));
    focusComposer();
  }

  async function handleSubmit(event?: React.FormEvent) {
    event?.preventDefault();
    const text = input.trim();
    if ((!text && pendingFiles.length === 0) || busy) return;
    const {
      data: { session },
    } = await supabase.auth.getSession();
    if (!session) {
      navigate({ to: "/login" });
      return;
    }

    // Converte anexos: imagens/PDF viram partes de arquivo; textos/código
    // são embutidos na mensagem como bloco de código.
    const fileParts: FileUIPart[] = [];
    const textBlocks: string[] = [];
    try {
      for (const pending of pendingFiles) {
        if (isTextLike(pending.file)) {
          const content = await readAsText(pending.file);
          textBlocks.push(`\n\nArquivo \`${pending.file.name}\`:\n\`\`\`\n${content}\n\`\`\``);
        } else {
          const dataUrl = await readAsDataURL(pending.file);
          fileParts.push({
            type: "file",
            url: dataUrl,
            mediaType: pending.file.type,
            filename: pending.file.name,
          });
        }
      }
    } catch {
      toast.error("Não foi possível ler um dos arquivos.");
      return;
    }

    pendingFiles.forEach((p) => p.previewUrl && URL.revokeObjectURL(p.previewUrl));
    setPendingFiles([]);
    setInput("");
    const finalText = (text + textBlocks.join("")).trim();
    sendMessage({
      ...(finalText ? { text: finalText } : { text: "Analise os arquivos anexados." }),
      ...(fileParts.length > 0 ? { files: fileParts } : {}),
    });
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="scrollbar-thin-dark min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto w-full max-w-3xl px-4 py-6">
          {loadingHistory ? (
            <div className="flex items-center justify-center gap-2 py-16 text-sm text-muted-foreground">
              <Loader2 className="size-4 animate-spin" /> Carregando conversa…
            </div>
          ) : messages.length === 0 ? (
            <div className="flex flex-col items-center py-20 text-center">
              <div className="mb-4 flex size-14 items-center justify-center rounded-2xl bg-primary/10 text-primary">
                <Terminal className="size-7" />
              </div>
              <h2 className="font-display text-xl font-bold text-foreground">
                Rabelo <span className="text-primary text-glow">AI</span>
              </h2>
              <p className="mt-2 max-w-md text-sm text-muted-foreground">
                Pergunte sobre código, arquitetura, depuração, testes ou boas práticas. Estou pronto para ajudar.
              </p>
            </div>
          ) : (
            <div className="space-y-6">
              {messages.map((message) => (
                <div
                  key={message.id}
                  className={cn("message-in flex", message.role === "user" ? "justify-end" : "justify-start")}
                >
                  {message.role === "user" ? (
                    <div className="max-w-[80%] rounded-2xl rounded-br-sm bg-primary px-4 py-2.5 text-sm text-primary-foreground">
                      {message.parts.map((p, i) => {
                        if (p.type === "text") {
                          return (
                            <span key={i} className="whitespace-pre-wrap">
                              {p.text}
                            </span>
                          );
                        }
                        if (p.type === "file") {
                          const file = p as FileUIPart;
                          if (file.mediaType?.startsWith("image/")) {
                            return (
                              <img
                                key={i}
                                src={file.url}
                                alt={file.filename ?? "Imagem anexada"}
                                className="my-1 max-h-64 rounded-lg border border-primary-foreground/20"
                              />
                            );
                          }
                          return (
                            <span
                              key={i}
                              className="my-1 flex items-center gap-2 rounded-lg border border-primary-foreground/20 bg-primary-foreground/10 px-3 py-2 text-xs"
                            >
                              <FileText className="size-4 shrink-0" />
                              <span className="truncate">{file.filename ?? "Arquivo"}</span>
                            </span>
                          );
                        }
                        return null;
                      })}
                    </div>
                  ) : (
                    <div className="w-full max-w-[90%] text-sm leading-relaxed text-foreground">
                      {message.parts.map((part, i) => {
                        if (part.type === "text") {
                          return <MessageText key={i} text={part.text} />;
                        }
                        if (part.type === "reasoning") {
                          return (
                            <details key={i} className="mb-3 rounded-lg border border-border bg-card/50 text-xs">
                              <summary className="flex cursor-pointer items-center gap-2 px-3 py-2 font-display text-muted-foreground">
                                <Brain className="size-3.5 text-primary" /> Raciocínio
                              </summary>
                              <div className="whitespace-pre-wrap border-t border-border px-3 py-2 text-muted-foreground">
                                {part.text}
                              </div>
                            </details>
                          );
                        }
                        return null;
                      })}
                    </div>
                  )}
                </div>
              ))}
              {status === "submitted" && (
                <div className="message-in flex items-center gap-1.5 py-2">
                  <span className="typing-dot size-2 rounded-full bg-primary" />
                  <span className="typing-dot size-2 rounded-full bg-primary" />
                  <span className="typing-dot size-2 rounded-full bg-primary" />
                </div>
              )}
            </div>
          )}
          <div ref={bottomRef} />
        </div>
      </div>

      <div className="border-t border-border bg-background">
        <form onSubmit={handleSubmit} className="mx-auto w-full max-w-3xl px-4 py-4">
          {pendingFiles.length > 0 && (
            <div className="mb-2 flex flex-wrap gap-2">
              {pendingFiles.map((pending) => (
                <div
                  key={pending.id}
                  className="relative flex items-center gap-2 rounded-lg border border-border bg-card px-2.5 py-1.5 text-xs text-foreground"
                >
                  {pending.previewUrl ? (
                    <img src={pending.previewUrl} alt="" className="size-8 rounded object-cover" />
                  ) : (
                    <FileText className="size-4 text-primary" />
                  )}
                  <span className="max-w-40 truncate">{pending.file.name}</span>
                  <button
                    type="button"
                    onClick={() => removePendingFile(pending.id)}
                    aria-label={`Remover ${pending.file.name}`}
                    className="rounded-full p-0.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                  >
                    <X className="size-3.5" />
                  </button>
                </div>
              ))}
            </div>
          )}
          <div className="flex items-end gap-2">
            <div className="relative" ref={attachMenuRef}>
              <button
                type="button"
                onClick={() => setAttachMenuOpen((open) => !open)}
                aria-label="Anexar arquivos ou link"
                className="flex size-11 shrink-0 items-center justify-center rounded-xl border border-border bg-card text-foreground transition-colors hover:bg-muted"
              >
                <Plus className="size-5" />
              </button>
              {attachMenuOpen && (
                <div className="absolute bottom-13 left-0 z-20 w-64 overflow-hidden rounded-xl border border-border bg-popover shadow-lg">
                  <button
                    type="button"
                    onClick={() => {
                      setAttachMenuOpen(false);
                      fileInputRef.current?.click();
                    }}
                    className="flex w-full items-center gap-3 px-4 py-3 text-left text-sm text-foreground transition-colors hover:bg-muted"
                  >
                    <ImageIcon className="size-4 text-primary" />
                    <span>
                      Fotos e arquivos
                      <span className="block text-xs text-muted-foreground">Imagens, PDF, texto ou código (até 4 MB)</span>
                    </span>
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setAttachMenuOpen(false);
                      insertLink();
                    }}
                    className="flex w-full items-center gap-3 border-t border-border px-4 py-3 text-left text-sm text-foreground transition-colors hover:bg-muted"
                  >
                    <Link2 className="size-4 text-primary" />
                    <span>
                      Adicionar link
                      <span className="block text-xs text-muted-foreground">Cole um endereço para a IA analisar</span>
                    </span>
                  </button>
                </div>
              )}
            </div>
            <input
              ref={fileInputRef}
              type="file"
              multiple
              accept="image/*,application/pdf,.txt,.md,.json,.csv,.xml,.yml,.yaml,.toml,.js,.jsx,.ts,.tsx,.py,.java,.c,.cpp,.h,.cs,.go,.rs,.rb,.php,.html,.css,.sql,.sh,.log"
              className="hidden"
              onChange={(e) => {
                if (e.target.files) addFiles(e.target.files);
                e.target.value = "";
              }}
            />
            <textarea
              ref={textareaRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  handleSubmit();
                }
              }}
              rows={1}
              placeholder="Pergunte ao Rabelo…"
              className="max-h-40 min-h-11 flex-1 resize-none rounded-xl border border-input bg-card px-4 py-3 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
            />
            {busy ? (
              <button
                type="button"
                onClick={stop}
                aria-label="Parar resposta"
                className="flex size-11 shrink-0 items-center justify-center rounded-xl border border-border bg-card text-foreground transition-colors hover:bg-muted"
              >
                <Square className="size-4" />
              </button>
            ) : (
              <button
                type="submit"
                disabled={!input.trim() && pendingFiles.length === 0}
                aria-label="Enviar mensagem"
                className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-primary text-primary-foreground transition-opacity disabled:opacity-40"
              >
                <ArrowUp className="size-5" />
              </button>
            )}
          </div>
        </form>
      </div>
    </div>
  );
}
