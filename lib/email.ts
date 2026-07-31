/**
 * Outgoing mail via Resend. Optional: without RESEND_API_KEY the app still
 * works, password-reset emails just can't be delivered — the caller is told
 * so it can show an honest message instead of pretending one was sent.
 */

export const emailConfigured = () => Boolean(process.env.RESEND_API_KEY);

export async function sendEmail(opts: {
  to: string;
  subject: string;
  html: string;
  text: string;
}): Promise<{ ok: boolean; error?: string }> {
  const key = process.env.RESEND_API_KEY;
  if (!key) return { ok: false, error: "Email is not configured" };

  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: process.env.RESEND_FROM || "PIT <onboarding@resend.dev>",
        to: [opts.to],
        subject: opts.subject,
        html: opts.html,
        text: opts.text,
      }),
    });
    if (!res.ok) {
      const body = await res.text();
      return { ok: false, error: `Resend responded ${res.status}: ${body}` };
    }
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Send failed" };
  }
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
