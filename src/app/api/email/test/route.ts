import { auth } from "@clerk/nextjs/server";
import nodemailer from "nodemailer";
import { NextResponse } from "next/server";
import { decryptSecret } from "@/lib/crypto";
import { createClient } from "@/lib/supabase/server";

const AUTH_ERROR =
  "Authentication failed — check username and password (Gmail needs an App Password).";
const TLS_HINT =
  " — check the SSL/TLS toggle: port 465 uses SSL, port 587 uses STARTTLS.";
const TLS_RETRY_NOTE =
  "Connected with SSL/STARTTLS — the toggle was adjusted automatically.";

const AUTH_RE = /invalid login|535|authentication/i;
const TLS_RE = /ssl|tls|wrong version|handshake|econnreset|socket hang up/i;

interface TestBody {
  host?: string;
  port?: number | string;
  secure?: boolean;
  user?: string;
  password?: string;
  to?: string;
  fromName?: string;
  fromEmail?: string;
}

function messageOf(err: unknown): string {
  if (err instanceof Error && err.message) return err.message;
  return "Connection failed.";
}

function friendly(message: string): string {
  if (AUTH_RE.test(message)) return AUTH_ERROR;
  if (TLS_RE.test(message)) return `${message}${TLS_HINT}`;
  return message;
}

export async function POST(request: Request) {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ ok: false, error: "Not signed in" }, { status: 401 });
  }

  const body = (await request.json().catch(() => ({}))) as TestBody;
  const host = body.host?.trim();
  const user = body.user?.trim();
  const port = Number(body.port) || 587;
  const secure = body.secure === true;
  const to = body.to?.trim() || null;
  const fromName = body.fromName?.trim() || null;
  const fromEmail = body.fromEmail?.trim() || null;

  if (!host || !user) {
    return NextResponse.json(
      { ok: false, error: "SMTP host and username are required." },
      { status: 400 }
    );
  }

  let password = body.password?.trim() || null;
  if (!password) {
    const supabase = await createClient();
    const { data } = await supabase
      .from("user_email_settings")
      .select("smtp_password_enc")
      .eq("user_id", userId)
      .maybeSingle();
    if (data?.smtp_password_enc) {
      try {
        password = decryptSecret(data.smtp_password_enc);
      } catch {
        return NextResponse.json(
          {
            ok: false,
            error: "Your saved password can't be read — enter it again to save it.",
          },
          { status: 400 }
        );
      }
    }
  }
  if (!password) {
    return NextResponse.json(
      { ok: false, error: "Enter your SMTP password first." },
      { status: 400 }
    );
  }

  const attempt = async (useSecure: boolean) => {
    const transport = nodemailer.createTransport({
      host,
      port,
      secure: useSecure,
      auth: { user, pass: password },
    });
    await transport.verify();
    return transport;
  };

  let transport: ReturnType<typeof nodemailer.createTransport>;
  let autoCorrected = false;
  try {
    transport = await attempt(secure);
  } catch (firstErr) {
    const firstMessage = messageOf(firstErr);
    if (TLS_RE.test(firstMessage)) {
      try {
        transport = await attempt(!secure);
        autoCorrected = true;
      } catch {
        return NextResponse.json(
          { ok: false, error: friendly(firstMessage) },
          { status: 400 }
        );
      }
    } else {
      return NextResponse.json(
        { ok: false, error: friendly(firstMessage) },
        { status: 400 }
      );
    }
  }

  if (to) {
    try {
      await transport.sendMail({
        from: fromName
          ? `"${fromName}" <${fromEmail ?? user}>`
          : fromEmail ?? user,
        to,
        subject: "Lead Portal SMTP test",
        text: "Your email sending is configured correctly.",
      });
    } catch (err) {
      return NextResponse.json(
        { ok: false, error: friendly(messageOf(err)) },
        { status: 400 }
      );
    }
  }

  return NextResponse.json(
    autoCorrected ? { ok: true, note: TLS_RETRY_NOTE } : { ok: true }
  );
}
