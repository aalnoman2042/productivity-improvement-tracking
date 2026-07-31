/**
 * Outgoing mail. Two ways to send, whichever is configured:
 *
 *  1. SMTP (GMAIL_USER + GMAIL_APP_PASSWORD) — needs no domain of your own,
 *     just a Google App Password. Reaches any recipient.
 *  2. Resend (RESEND_API_KEY) — needs a verified domain before it will
 *     deliver to anyone but the Resend account holder.
 *
 * With neither set the app still runs; password-reset requests just say so
 * honestly instead of pretending an email went out.
 */
import nodemailer from "nodemailer";

type Sent = { ok: boolean; error?: string };

const smtpReady = () =>
  Boolean(process.env.GMAIL_USER && process.env.GMAIL_APP_PASSWORD);

export const emailConfigured = () =>
  smtpReady() || Boolean(process.env.RESEND_API_KEY);

async function sendViaSmtp(opts: {
  to: string;
  subject: string;
  html: string;
  text: string;
}): Promise<Sent> {
  const user = process.env.GMAIL_USER!;
  // Google displays App Passwords in four spaced groups; accept them as shown.
  const pass = process.env.GMAIL_APP_PASSWORD!.replace(/\s+/g, "");
  try {
    const transport = nodemailer.createTransport({
      service: "gmail",
      auth: { user, pass },
    });
    await transport.sendMail({
      from: process.env.MAIL_FROM || `PIT <${user}>`,
      to: opts.to,
      subject: opts.subject,
      text: opts.text,
      html: opts.html,
    });
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "SMTP failed" };
  }
}

async function sendViaResend(opts: {
  to: string;
  subject: string;
  html: string;
  text: string;
}): Promise<Sent> {
  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: process.env.MAIL_FROM || "PIT <onboarding@resend.dev>",
        to: [opts.to],
        subject: opts.subject,
        html: opts.html,
        text: opts.text,
      }),
    });
    if (!res.ok) {
      return { ok: false, error: `Resend responded ${res.status}: ${await res.text()}` };
    }
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Send failed" };
  }
}

export async function sendEmail(opts: {
  to: string;
  subject: string;
  html: string;
  text: string;
}): Promise<Sent> {
  if (smtpReady()) return sendViaSmtp(opts);
  if (process.env.RESEND_API_KEY) return sendViaResend(opts);
  return { ok: false, error: "Email is not configured" };
}

export function resetEmail(name: string, link: string) {
  return {
    subject: "Reset your PIT password",
    text: `Hi ${name},\n\nUse this link to choose a new password. It expires in one hour:\n${link}\n\nIf you didn't ask for this, you can ignore this email.`,
    html: `<div style="font-family:system-ui,-apple-system,'Segoe UI',sans-serif;max-width:480px;margin:0 auto;padding:24px">
  <h1 style="font-size:20px;margin:0 0 8px">Reset your PIT password</h1>
  <p style="color:#4b5563;margin:0 0 20px">Hi ${name}, use the button below to choose a new password. The link expires in one hour.</p>
  <a href="${link}" style="display:inline-block;background:#1c5cab;color:#fff;text-decoration:none;padding:12px 20px;border-radius:8px;font-weight:600">Choose a new password</a>
  <p style="color:#6b7280;font-size:13px;margin:20px 0 0">If the button doesn't work, paste this into your browser:<br><span style="word-break:break-all">${link}</span></p>
  <p style="color:#6b7280;font-size:13px;margin:16px 0 0">If you didn't ask for this, you can ignore this email — nothing changes.</p>
</div>`,
  };
}
