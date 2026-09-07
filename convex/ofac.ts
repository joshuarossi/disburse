"use node";
import { createHash, randomUUID } from "node:crypto";
import { v } from "convex/values";
import { action, internalAction } from "./_generated/server";
import { internal } from "./_generated/api";
import { parseOfacXml } from "./lib/ofacXml";
import { buildSdnIndex, OFAC_SOURCE } from "../shared/sanctions";

async function download() {
  const response = await fetch(OFAC_SOURCE, {
    signal: AbortSignal.timeout(45_000),
  });
  if (!response.ok || !response.body)
    throw new Error(
      `OFAC download returned HTTP ${response.status}. The previous list was retained.`,
    );
  const reader = response.body.getReader(),
    decoder = new TextDecoder(),
    digest = createHash("sha256");
  const parts: string[] = [];
  let bytes = 0;
  try {
    while (true) {
      const part = await reader.read();
      if (part.done) break;
      bytes += part.value.byteLength;
      if (bytes > 64 * 1024 * 1024)
        throw new Error(
          "The OFAC download exceeds its supported size. The previous list was retained.",
        );
      digest.update(part.value);
      parts.push(decoder.decode(part.value, { stream: true }));
    }
    parts.push(decoder.decode());
    return { xml: parts.join(""), checksum: digest.digest("hex") };
  } finally {
    await reader.cancel();
  }
}

export const refresh = internalAction({
  args: { force: v.optional(v.boolean()) },
  handler: async (ctx, args): Promise<{ status: string; records?: number }> => {
    const refreshId = randomUUID();
    const claim = await ctx.runMutation(internal.ofacData.claim, {
      refreshId,
      force: args.force,
    });
    if (!claim.acquired) return { status: claim.reason };
    try {
      const file = await download(),
        parsed = parseOfacXml(file.xml);
      const postings = buildSdnIndex(parsed.entries);
      const snapshot = await ctx.runMutation(internal.ofacData.begin, {
        refreshId,
        checksum: file.checksum,
        publishedAt: parsed.publishedAt,
        expectedEntries: parsed.entries.length,
        expectedPostings: postings.length,
        aliasCount: parsed.entries.reduce(
          (sum, e) => sum + e.aliases.length,
          0,
        ),
        addressCount: parsed.entries.reduce(
          (sum, e) => sum + e.addresses.length,
          0,
        ),
      });
      if (snapshot.unchanged)
        return { status: "unchanged", records: snapshot.entryCount };
      for (
        let offset = snapshot.entryCount;
        offset < parsed.entries.length;
        offset += 200
      )
        await ctx.runMutation(internal.ofacData.writeEntries, {
          refreshId,
          datasetId: snapshot.datasetId,
          offset,
          entries: parsed.entries.slice(offset, offset + 200),
        });
      for (
        let offset = snapshot.postingCount;
        offset < postings.length;
        offset += 200
      )
        await ctx.runMutation(internal.ofacData.writePostings, {
          refreshId,
          datasetId: snapshot.datasetId,
          offset,
          postings: postings.slice(offset, offset + 200),
        });
      await ctx.runMutation(internal.ofacData.activate, {
        refreshId,
        datasetId: snapshot.datasetId,
      });
      return { status: "updated", records: parsed.entries.length };
    } catch (e) {
      const message =
        e instanceof Error
          ? e.message
          : "OFAC refresh failed. The previous list was retained.";
      await ctx.runMutation(internal.ofacData.failed, { refreshId, message });
      throw new Error(message);
    }
  },
});

export const refreshForOrg = action({
  args: { orgId: v.id("orgs"), sessionToken: v.string() },
  handler: async (ctx, args): Promise<{ status: string; records?: number }> => {
    await ctx.runQuery(internal.ofacData.authorizeRefresh, args);
    return ctx.runAction(internal.ofac.refresh, {});
  },
});
