"use node";
import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from "node:crypto";

export type EmailPayload = {
  from: string;
  to: string[];
  subject: string;
  text: string;
  html: string;
  invitationUrl?: string;
};
function key(value = process.env.EMAIL_OUTBOX_KEY) {
  if (!value || !/^[a-f0-9]{64}$/i.test(value))
    throw new Error(
      "Private invitation links are temporarily unavailable. Your team details are saved.",
    );
  return Buffer.from(value, "hex");
}
const keyId = (k: Buffer) =>
  createHash("sha256").update(k).digest("hex").slice(0, 16);
export function invitationConfig() {
  key();
  const url = new URL(process.env.PUBLIC_APP_URL ?? "invalid:");
  if (
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    url.pathname !== "/" ||
    (url.protocol !== "https:" &&
      !(
        url.protocol === "http:" &&
        ["localhost", "127.0.0.1"].includes(url.hostname)
      ))
  )
    throw new Error(
      "Invitation links need a valid application address. No invitation was created.",
    );
  return { origin: url.origin };
}
export function sealEmail(payload: EmailPayload, context: string) {
  const secret = key(),
    nonce = randomBytes(12),
    cipher = createCipheriv("aes-256-gcm", secret, nonce);
  cipher.setAAD(Buffer.from(context));
  const encrypted = Buffer.concat([
    cipher.update(JSON.stringify(payload), "utf8"),
    cipher.final(),
  ]);
  return [
    "v1",
    keyId(secret),
    nonce.toString("base64"),
    encrypted.toString("base64"),
    cipher.getAuthTag().toString("base64"),
  ].join(":");
}
export function openEmail(sealed: string, context: string): EmailPayload {
  const [version, id, nonce, contents, tag, extra] = sealed.split(":");
  if (version !== "v1" || extra)
    throw new Error("The saved email cannot be read.");
  const secret = [
    process.env.EMAIL_OUTBOX_KEY,
    process.env.EMAIL_OUTBOX_PREVIOUS_KEY,
  ]
    .filter(Boolean)
    .map((k) => key(k))
    .find((k) => keyId(k) === id);
  if (!secret)
    throw new Error("The saved email needs its original delivery key.");
  const decipher = createDecipheriv(
    "aes-256-gcm",
    secret,
    Buffer.from(nonce, "base64"),
  );
  decipher.setAAD(Buffer.from(context));
  decipher.setAuthTag(Buffer.from(tag, "base64"));
  return JSON.parse(
    Buffer.concat([
      decipher.update(Buffer.from(contents, "base64")),
      decipher.final(),
    ]).toString("utf8"),
  );
}
export const escapeEmailHtml = (value: string) =>
  value.replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ]!,
  );
export class EmailDeliveryError extends Error {
  constructor(
    message: string,
    readonly retryable: boolean,
  ) {
    super(message);
  }
}
export async function sendEmail(payload: EmailPayload, idempotencyKey: string): Promise<string> {
  void payload; void idempotencyKey;
  // Historical workers must not activate application-funded delivery when old
  // provider credentials remain configured. New invitations use private links.
  throw new EmailDeliveryError('Email delivery is unavailable. Create a private invitation link and share it with your teammate.', false);
}
