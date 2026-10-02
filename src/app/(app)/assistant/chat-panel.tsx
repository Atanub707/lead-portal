"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useChat } from "@ai-sdk/react";
import { getToolName, isToolUIPart } from "ai";
import { ArrowUp, Check, Loader2, Sparkles, Square, Wrench, X } from "lucide-react";

const TOOL_LABELS: Record<string, string> = {
  findCompany: "Checking for duplicates",
  createCompany: "Creating company",
  updateCompany: "Updating company",
  addContact: "Adding contact",
  logInteraction: "Logging interaction",
};

const EXAMPLES = [
  "Add Pausa (pausaa.com, linkedin.com/company/pausaa) to the POS list — members: Ayoub Gharbi, founder (linkedin.com/in/ayoub-gharbi-0574b4127/), and Juan Hernandez.",
  "Add Neon.ai (neon.ai, linkedin.com/company/neon-ai) to the compliance list — enterprise AI vendor, likely needs SOC 2.",
  "Find any record named Zoho and log today's call: they asked for pricing. Follow up on Friday.",
];

function linkify(text: string) {
  const parts = text.split(/(\/companies\/\d+)/g);
  return parts.map((part, index) =>
    /^\/companies\/\d+$/.test(part) ? (
      <Link
        key={index}
        href={part}
        className="font-medium text-blue-600 hover:underline"
      >
        {part}
      </Link>
    ) : (
      <span key={index}>{part}</span>
    )
  );
}

function ToolChip({ name, state }: { name: string; state: string }) {
  const done = state === "output-available";
  const failed = state === "output-error";
  return (
    <div
      className={`inline-flex items-center gap-1.5 rounded-md border px-2 py-1 text-[11px] ${
        failed
          ? "border-rose-200 bg-rose-50 text-rose-700"
          : done
            ? "border-zinc-200 bg-zinc-50 text-zinc-600"
            : "border-zinc-200 bg-white text-zinc-500"
      }`}
    >
      <Wrench className="h-3 w-3" aria-hidden="true" />
      {TOOL_LABELS[name] ?? name}
      {done ? (
        <Check className="h-3 w-3 text-emerald-600" aria-hidden="true" />
      ) : failed ? (
        <X className="h-3 w-3 text-rose-600" aria-hidden="true" />
      ) : (
        <Loader2
          className="h-3 w-3 animate-spin motion-reduce:animate-none"
          aria-hidden="true"
        />
      )}
    </div>
  );
}

export function ChatPanel() {
  const { messages, sendMessage, status, error, stop } = useChat();
  const [input, setInput] = useState("");
  const busy = status === "submitted" || status === "streaming";
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const reduce =
      typeof window !== "undefined" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    bottomRef.current?.scrollIntoView({
      behavior: reduce ? "auto" : "smooth",
      block: "end",
    });
  }, [messages, busy]);

  function submit(text: string) {
    const value = text.trim();
    if (!value || busy) return;
    sendMessage({ text: value });
    setInput("");
  }

  return (
    <div className="card mt-6 animate-rise">
      <div className="flex h-[60dvh] max-h-[640px] min-h-[380px] flex-col">
        <div className="flex-1 space-y-5 overflow-y-auto p-5">
          {messages.length === 0 ? (
            <div className="flex h-full flex-col items-center justify-center gap-4 text-center">
              <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-zinc-900 text-white">
                <Sparkles className="h-4 w-4" aria-hidden="true" />
              </span>
              <div>
                <p className="text-[13px] font-medium text-zinc-800">
                  Drop company details here
                </p>
                <p className="mt-1 text-[12px] text-zinc-500">
                  Paste anything — links, notes, members — and say which list.
                </p>
              </div>
              <div className="flex max-w-md flex-col gap-2">
                {EXAMPLES.map((example) => (
                  <button
                    key={example}
                    onClick={() => submit(example)}
                    className="rounded-md border border-zinc-200 bg-white px-3 py-1.5 text-left text-[12px] leading-snug text-zinc-600 transition-colors hover:border-zinc-300 hover:text-zinc-900"
                  >
                    “{example.length > 110 ? `${example.slice(0, 110)}…` : example}”
                  </button>
                ))}
              </div>
            </div>
          ) : (
            messages.map((message) =>
              message.role === "user" ? (
                <div key={message.id} className="flex justify-end">
                  <div className="max-w-[85%] whitespace-pre-wrap rounded-lg bg-zinc-900 px-3.5 py-2.5 text-[13px] leading-relaxed text-white">
                    {message.parts.map((part, index) =>
                      part.type === "text" ? (
                        <span key={index}>{part.text}</span>
                      ) : null
                    )}
                  </div>
                </div>
              ) : (
                <div key={message.id} className="flex justify-start">
                  <div className="max-w-[90%] space-y-2">
                    {message.parts.map((part, index) => {
                      if (part.type === "text") {
                        return (
                          <div
                            key={index}
                            className="whitespace-pre-wrap text-[13px] leading-relaxed text-zinc-800"
                          >
                            {linkify(part.text)}
                          </div>
                        );
                      }
                      if (isToolUIPart(part)) {
                        return (
                          <ToolChip
                            key={index}
                            name={getToolName(part)}
                            state={part.state}
                          />
                        );
                      }
                      return null;
                    })}
                  </div>
                </div>
              )
            )
          )}
          {status === "submitted" ? (
            <p className="text-[12px] text-zinc-400">Thinking…</p>
          ) : null}
          <div ref={bottomRef} />
        </div>

        {error ? (
          <p
            role="alert"
            className="border-t border-zinc-100 bg-rose-50 px-5 py-2 text-[12px] text-rose-700"
          >
            {error.message}
          </p>
        ) : null}

        <div className="border-t border-zinc-100 p-3">
          <div className="flex items-end gap-2">
            <textarea
              value={input}
              onChange={(event) => setInput(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && !event.shiftKey) {
                  event.preventDefault();
                  submit(input);
                }
              }}
              rows={2}
              placeholder="Paste company info… then say: add to the POS list"
              aria-label="Message the assistant"
              className="input min-h-[44px] resize-none"
            />
            {busy ? (
              <button
                onClick={stop}
                className="btn-ghost h-9 w-9 shrink-0 p-0"
                title="Stop"
              >
                <Square className="h-3.5 w-3.5" aria-hidden="true" />
                <span className="sr-only">Stop</span>
              </button>
            ) : (
              <button
                onClick={() => submit(input)}
                disabled={!input.trim()}
                className="btn-primary h-9 w-9 shrink-0 p-0"
                title="Send"
              >
                <ArrowUp className="h-4 w-4" aria-hidden="true" />
                <span className="sr-only">Send</span>
              </button>
            )}
          </div>
          <p className="mt-1.5 text-[11px] text-zinc-400">
            Enter to send · Shift+Enter for a new line · the assistant writes
            directly to the database with your permissions
          </p>
        </div>
      </div>
    </div>
  );
}
