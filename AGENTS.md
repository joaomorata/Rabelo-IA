<!-- LOVABLE:BEGIN -->
> [!IMPORTANT]
> This project is connected to [Lovable](https://lovable.dev). Avoid rewriting
> published git history — force pushing, or rebasing/amending/squashing commits
> that are already pushed — as it rewrites history on Lovable's side and the
> user will likely lose their project history.
>
> Commits you push to the connected branch sync back to Lovable and show up in
> the editor, so keep the branch in a working state.
<!-- LOVABLE:END -->

## Architecture rules

- Chat streaming lives in the TanStack server route `src/routes/api/chat.ts` (AI SDK `streamText` via Lovable AI Gateway Responses, model `openai/gpt-6-astra`); never replace it with a buffered `createServerFn` or an Edge Function. Why: streaming responses need a raw HTTP boundary.
- The chat route authenticates via the Supabase access token in the `Authorization` header and verifies thread ownership with `supabaseAdmin` before reading/writing. Why: RLS is bypassed server-side, so ownership checks must be explicit.
- Chat history is stored in `public.threads` / `public.messages` (message content in `parts` jsonb); the client loads history once per mount in `ChatWindow` (keyed by `threadId`). Why: AI SDK `msg_*` ids are not UUIDs, so rows use generated UUIDs and content is stored as UIMessage parts.
