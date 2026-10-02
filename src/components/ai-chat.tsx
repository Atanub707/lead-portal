"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useChat } from "@ai-sdk/react";
import { getToolName, isToolUIPart } from "ai";
import {
  ArrowUp,
  Check,
  Loader2,
  Sparkles,
  Square,
  Wrench,
  X,
} from "lucide-react";
import { LIST_LABEL, type OrgList } from "@/lib/types";

const TOOL_LABELS: Record<string, string> = {
  findCompany: "Checking for duplicates",
  createCompany: "Creating company",
  updateCompany: "Updating company",
  addContact: "Adding contact",
  logInteraction: "Logging interaction",
};

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
      className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] ${
        failed
          ? "border-rose-200 bg-rose-50 text-rose-700"
          : done
            ? "border-zinc-200 bg-white text-zinc-600"
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

export function AddWithAI({ list }: { list: OrgList }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [input, setInput] = useState("");
  const { messages, sendMessage, status, error, stop } = useChat();
  const busy = status === "submitted" || status === "streaming";
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // Close on Escape + lock page scroll while open
  useEffect(() => {
    if (!open) return;
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }
    window.addEventListener("keydown", onKey);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    inputRef.current?.focus();
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = previousOverflow;
    };
  }, [open]);

  // Keep the page behind the modal fresh when the assistant writes
  useEffect(() => {
    const last = messages[messages.length - 1];
    if (!last || last.role !== "assistant") return;
    const wroteSomething = last.parts.some(
      (part) => isToolUIPart(part) && part.state === "output-available"
    );
    if (wroteSomething) router.refresh();
  }, [messages, router]);

  useEffect(() => {
    const reduce =
      typeof window !== "undefined" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    bottomRef.current?.scrollIntoView({
      behavior: reduce ? "auto" : "smooth",
      block: "end",
    });
  }, [messages, busy, open]);

  function submit(text: string) {
    const value = text.trim();
    if (!value || busy) return;
    sendMessage({ text: value }, { body: { defaultList: list } });
    setInput("");
  }

  const examples = [
    "Add Pausa — pausaa.com, linkedin.com/company/pausaa — members: Ayoub Gharbi (linkedin.com/in/ayoub-gharbi-0574b4127/), Juan Hernandez.",
    "Add Neon.ai — neon.ai, linkedin.com/company/neon-ai. Enterprise AI vendor, likely needs SOC 2.",
    "Find any record named TUBR and log today's call: partner intro done, follow up next week.",
  ];

  return (
    <>
      <button onClick={() => setOpen(true)} className="btn-ghost">
        <Sparkles className="h-3.5 w-3.5" aria-hidden="true" />
        Add with AI
      </button>

      {open ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-6">
          <button
            className="absolute inset-0 bg-zinc-900/30"
            aria-label="Close"
            onClick={() => setOpen(false)}
          />
          <div
            role="dialog"
            aria-modal="true"
            aria-label="Add with AI"
            className="relative flex h-[min(720px,88dvh)] w-full max-w-2xl flex-col overflow-hidden rounded-2xl border border-zinc-200 bg-white shadow-2xl"
          >
            {/* Header */}
            <div className="flex items-center gap-3 border-b border-zinc-100 px-4 py-3">
              <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-zinc-900 text-white">
                <Sparkles className="h-3.5 w-3.5" aria-hidden="true" />
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-[13px] font-semibold text-zinc-900">
                  Add with AI
                </p>
                <p className="truncate text-[11px] text-zinc-500">
                  Adding to {LIST_LABEL[list]} — paste links, notes, or member
                  lists
                </p>
              </div>
              <button
                onClick={() => setOpen(false)}
                aria-label="Close"
                className="flex h-8 w-8 items-center justify-center rounded-md text-zinc-400 transition-colors hover:bg-zinc-100 hover:text-zinc-700"
              >
                <X className="h-4 w-4" aria-hidden="true" />
              </button>
            </div>

            {/* Messages */}
            <div className="flex-1 overflow-y-auto px-4 py-5">
              <div className="mx-auto max-w-xl space-y-5">
                {messages.length === 0 ? (
                  <div className="flex flex-col items-center gap-4 pt-8 text-center">
                    <span className="flex h-10 w-10 items-center justify-center rounded-full bg-zinc-900 text-white">
                      <Sparkles className="h-4 w-4" aria-hidden="true" />
                    </span>
                    <div>
                      <p className="text-[14px] font-medium text-zinc-800">
                        What should I add to {LIST_LABEL[list]}?
                      </p>
                      <p className="mt-1 text-[12px] text-zinc-500">
                        Paste anything — website, LinkedIn, members, notes.
                      </p>
                    </div>
                    <div className="flex w-full flex-col gap-2">
                      {examples.map((example) => (
                        <button
                          key={example}
                          onClick={() => submit(example)}
                          className="rounded-xl border border-zinc-200 bg-white px-3.5 py-2 text-left text-[12px] leading-snug text-zinc-600 transition-colors hover:border-zinc-300 hover:text-zinc-900"
                        >
                          “{example.length > 120 ? `${example.slice(0, 120)}…` : example}”
                        </button>
                      ))}
                    </div>
                  </div>
                ) : (
                  messages.map((message) =>
                    message.role === "user" ? (
                      <div key={message.id} className="flex justify-end">
                        <div className="max-w-[85%] whitespace-pre-wrap rounded-2xl bg-zinc-100 px-4 py-2.5 text-[13px] leading-relaxed text-zinc-900">
                          {message.parts.map((part, index) =>
                            part.type === "text" ? (
                              <span key={index}>{part.text}</span>
                            ) : null
                          )}
                        </div>
                      </div>
                    ) : (
                      <div key={message.id} className="space-y-2">
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
                    )
                  )
                )}

                {status === "submitted" ? (
                  <div className="flex items-center gap-2 text-[12px] text-zinc-400">
                    <span
                      className="h-1.5 w-1.5 animate-pulse rounded-full bg-zinc-400 motion-reduce:animate-none"
                      aria-hidden="true"
                    />
                    Thinking…
                  </div>
                ) : null}
                <div ref={bottomRef} />
              </div>
            </div>

            {/* Error */}
            {error ? (
              <p
                role="alert"
                className="border-t border-zinc-100 bg-rose-50 px-4 py-2 text-[12px] text-rose-700"
              >
                {error.message}
              </p>
            ) : null}

            {/* Composer */}
            <div className="border-t border-zinc-100 px-4 py-3">
              <div className="mx-auto max-w-xl">
                <div className="flex items-end gap-2 rounded-[24px] border border-zinc-300 bg-white py-1.5 pl-4 pr-1.5 shadow-sm transition-colors focus-within:border-zinc-400">
                  <textarea
                    ref={inputRef}
                    value={input}
                    onChange={(event) => setInput(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" && !event.shiftKey) {
                        event.preventDefault();
                        submit(input);
                      }
                    }}
                    rows={1}
                    placeholder="Message Add with AI…"
                    aria-label="Message the assistant"
                    className="max-h-32 min-h-[28px] flex-1 resize-none bg-transparent py-1 text-[13px] text-zinc-900 outline-none placeholder:text-zinc-400"
                  />
                  {busy ? (
                    <button
                      onClick={stop}
                      title="Stop"
                      className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-zinc-900 text-white transition-colors hover:bg-zinc-700"
                    >
                      <Square className="h-3 w-3" aria-hidden="true" />
                      <span className="sr-only">Stop</span>
                    </button>
                  ) : (
                    <button
                      onClick={() => submit(input)}
                      disabled={!input.trim()}
                      title="Send"
                      className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-zinc-900 text-white transition-colors hover:bg-zinc-700 disabled:opacity-30"
                    >
                      <ArrowUp className="h-4 w-4" aria-hidden="true" />
                      <span className="sr-only">Send</span>
                    </button>
                  )}
                </div>
                <p className="mt-1.5 text-center text-[11px] text-zinc-400">
                  Enter to send · Shift+Enter for a new line · writes to the
                  database with your permissions
                </p>
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
