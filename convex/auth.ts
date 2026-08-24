import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { verifyMessage } from "viem";
import { assertValidAddress } from "./lib/validation";
import { hashSessionToken } from "./lib/rbac";
import { getOrCreateUser } from "./lib/users";

const NONCE_TTL_MS = 10 * 60 * 1000; // pending sign-in nonces
const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000; // authenticated sessions

// Domains allowed inside the signed SIWE message. Comma-separated env var;
// when unset (local dev), domain enforcement is skipped and logged.
function getAllowedDomains(): string[] | null {
  const raw = process.env.SIWE_ALLOWED_DOMAINS ?? "";
  const domains = raw
    .split(",")
    .map((d) => d.trim().toLowerCase())
    .filter(Boolean);
  return domains.length > 0 ? domains : null;
}

function buildSiweMessage(opts: {
  domain: string;
  walletAddress: string;
  nonce: string;
  issuedAt: string;
  expirationTime: string;
}): string {
  const { domain, walletAddress, nonce, issuedAt, expirationTime } = opts;
  // EIP-4361 (Sign-In With Ethereum) formatted message.
  return [
    `${domain} wants you to sign in with your Ethereum account:`,
    walletAddress,
    "",
    "Sign in to Disburse. This signature does not trigger a blockchain transaction or cost any gas.",
    "",
    `URI: https://${domain}`,
    "Version: 1",
    "Chain ID: 1",
    `Nonce: ${nonce}`,
    `Issued At: ${issuedAt}`,
    `Expiration Time: ${expirationTime}`,
  ].join("\n");
}

/**
 * Minimal EIP-4361 parser for messages we generated ourselves.
 * Returns null if required fields are missing or malformed.
 */
function parseSiweMessage(message: string): {
  domain: string;
  address: string;
  nonce: string;
  expirationTime: number;
} | null {
  const lines = message.split("\n");
  const header = lines[0] ?? "";
  const domainMatch = header.match(/^(.+)\s+wants you to sign in/);
  if (!domainMatch) return null;

  const addressLine = lines[1];
  if (
    !addressLine ||
    !/^0x[0-9a-fA-F]{40}$/.test(addressLine.trim())
  ) {
    return null;
  }

  let nonce: string | null = null;
  let expirationTime: number | null = null;
  for (const line of lines) {
    const nonceMatch = line.match(/^Nonce:\s+(\S+)$/);
    if (nonceMatch) nonce = nonceMatch[1];
    const expMatch = line.match(/^Expiration Time:\s+(.+)$/);
    if (expMatch) {
      const parsed = Date.parse(expMatch[1]);
      if (!Number.isNaN(parsed)) expirationTime = parsed;
    }
  }

  if (!nonce || !expirationTime) return null;

  return {
    domain: domainMatch[1].trim().toLowerCase(),
    address: addressLine.trim(),
    nonce,
    expirationTime,
  };
}

// Generate a single-use nonce + server-built SIWE message for signing.
export const generateNonce = mutation({
  args: { walletAddress: v.string() },
  handler: async (ctx, args) => {
    assertValidAddress(args.walletAddress, "wallet address");
    const walletAddress = args.walletAddress.toLowerCase();
    const now = Date.now();

    // M-03: race-safe lookup-or-create (heals duplicate rows from races)
    const user = await getOrCreateUser(ctx, walletAddress);

    // Clean up this wallet's stale pending nonces (keep live sessions intact)
    const stalePending = await ctx.db
      .query("sessions")
      .withIndex("by_wallet", (q) => q.eq("walletAddress", walletAddress))
      .collect();
    for (const row of stalePending) {
      if (row.nonce && !row.tokenHash) {
        await ctx.db.delete(row._id);
      }
    }

    // High-entropy nonce (256-bit)
    const nonce =
      crypto.randomUUID().replace(/-/g, "") +
      crypto.randomUUID().replace(/-/g, "");
    await ctx.db.insert("sessions", {
      userId: user._id,
      walletAddress,
      nonce,
      expiresAt: now + NONCE_TTL_MS,
      createdAt: now,
    });

    const host = process.env.SIWE_DOMAIN ?? "app.disburse.xyz";

    return {
      nonce,
      message: buildSiweMessage({
        domain: host,
        walletAddress,
        nonce,
        issuedAt: new Date(now).toISOString(),
        expirationTime: new Date(now + NONCE_TTL_MS).toISOString(),
      }),
    };
  },
});

// Verify signature server-side and issue an opaque session token.
export const verifySignature = mutation({
  args: {
    walletAddress: v.string(),
    signature: v.string(),
    message: v.string(),
  },
  handler: async (ctx, args) => {
    assertValidAddress(args.walletAddress, "wallet address");
    const walletAddress = args.walletAddress.toLowerCase();
    const now = Date.now();

    // Parse and structurally validate the SIWE message
    const parsed = parseSiweMessage(args.message);
    if (!parsed) {
      throw new Error("Malformed sign-in message");
    }

    // The signed message must claim the same wallet that is authenticating
    if (parsed.address.toLowerCase() !== walletAddress) {
      throw new Error("Message address does not match requesting wallet");
    }

    // Nonce must be single-use and bound to this wallet
    const pending = await ctx.db
      .query("sessions")
      .withIndex("by_nonce", (q) => q.eq("nonce", parsed.nonce))
      .first();

    if (!pending || !pending.nonce || pending.tokenHash) {
      throw new Error("Invalid or already-used nonce");
    }
    if (pending.walletAddress !== walletAddress) {
      throw new Error("Nonce is not bound to this wallet");
    }
    if (now > pending.expiresAt) {
      await ctx.db.delete(pending._id);
      throw new Error("Sign-in expired. Please try again.");
    }

    // Domain allowlist (enforced in production via SIWE_ALLOWED_DOMAINS)
    const allowedDomains = getAllowedDomains();
    if (allowedDomains) {
      if (!allowedDomains.includes(parsed.domain)) {
        throw new Error(`Untrusted domain in sign-in message: ${parsed.domain}`);
      }
    } else {
      console.warn(
        "[Auth] SIWE_ALLOWED_DOMAINS not set — skipping domain verification"
      );
    }

    // Message must not already be expired per its own Expiration Time
    if (now > parsed.expirationTime) {
      throw new Error("Signed message has expired");
    }

    // CRYPTOGRAPHIC VERIFICATION: recover the signer and compare against the
    // claimed identity. This is the line that makes web3 auth real.
    const signatureOk = await verifyMessage({
      address: parsed.address as `0x${string}`,
      message: args.message,
      signature: args.signature as `0x${string}`,
    });
    if (!signatureOk) {
      throw new Error("Signature verification failed");
    }

    // Consume the nonce exactly once
    await ctx.db.delete(pending._id);

    // Issue opaque session token; persist only its SHA-256 digest
    const token =
      crypto.randomUUID().replace(/-/g, "") +
      crypto.randomUUID().replace(/-/g, "");
    const tokenHash = await hashSessionToken(token);
    const expiresAt = now + SESSION_TTL_MS;

    await ctx.db.insert("sessions", {
      userId: pending.userId,
      walletAddress,
      tokenHash,
      expiresAt,
      createdAt: now,
    });

    const user = await ctx.db.get(pending.userId);
    if (!user) {
      throw new Error("User not found");
    }

    return {
      token,
      expiresAt,
      userId: user._id,
      walletAddress: user.walletAddress,
      preferredLanguage: user.preferredLanguage,
      preferredTheme: user.preferredTheme,
    };
  },
});

// Validate a session token. Used by the frontend guard on every app load.
export const validateSession = query({
  args: { token: v.string() },
  handler: async (ctx, args) => {
    if (typeof args.token !== "string" || args.token.length < 32) {
      return null;
    }

    const tokenHash = await hashSessionToken(args.token);
    const session = await ctx.db
      .query("sessions")
      .withIndex("by_tokenHash", (q) => q.eq("tokenHash", tokenHash))
      .first();

    if (!session || !session.tokenHash) {
      return null;
    }

    if (Date.now() > session.expiresAt) {
      // Queries are read-only; expired rows are cleaned up by mutation flows
      return null;
    }

    const user = await ctx.db.get(session.userId);
    if (!user) {
      return null;
    }

    return {
      sessionId: session._id,
      userId: user._id,
      walletAddress: user.walletAddress,
      email: user.email,
      preferredLanguage: user.preferredLanguage,
      preferredTheme: user.preferredTheme,
    };
  },
});

// Logout - delete session by token
export const logout = mutation({
  args: { token: v.string() },
  handler: async (ctx, args) => {
    if (typeof args.token !== "string" || args.token.length < 32) {
      return { success: true };
    }

    const tokenHash = await hashSessionToken(args.token);
    const session = await ctx.db
      .query("sessions")
      .withIndex("by_tokenHash", (q) => q.eq("tokenHash", tokenHash))
      .first();

    if (session) {
      await ctx.db.delete(session._id);
    }

    return { success: true };
  },
});
