/* eslint-disable */
// @ts-nocheck
/**
 * Import SDN Enhanced XML into Convex sdnEntries table.
 *
 * Usage:
 *   bunx tsx scripts/import-sdn.ts
 */

import { ConvexHttpClient } from "convex/browser";
import { api } from "../convex/_generated/api";
import { XMLParser } from "fast-xml-parser";
import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const CONVEX_URL = process.env.VITE_CONVEX_URL || "https://fortunate-cat-122.convex.cloud";
const SDN_FILE = path.resolve(__dirname, "../sdn_enhanced.xml");
const BATCH_SIZE = 100;

async function main() {
  console.log("Connecting to Convex at", CONVEX_URL);
  const client = new ConvexHttpClient(CONVEX_URL);

  console.log("Clearing existing SDN entries...");
  await client.mutation(api.screeningMutations.clearSdnEntries, {});
  console.log("Cleared.");

  console.log("Reading SDN XML file...");
  const xmlData = fs.readFileSync(SDN_FILE, "utf-8");

  console.log("Parsing XML (this may take a moment for 101MB)...");
  const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: "@_",
    isArray: (name: string) => {
      return [
        "entity",
        "name",
        "translation",
        "namePart",
        "sanctionsProgram",
        "address",
        "addressPart",
        "feature",
      ].includes(name);
    },
  });

  const parsed = parser.parse(xmlData);
  const entities = parsed?.sanctionsData?.entities?.entity ?? [];
  console.log(`Found ${entities.length} entities to import`);

  let imported = 0;
  let skipped = 0;
  let batch: Array<{
    sdnId: number;
    entityType: "individual" | "entity";
    primaryName: string;
    firstName: string;
    lastName: string;
    aliases: string[];
    programs: string[];
  }> = [];

  for (const entity of entities) {
    const entityId = parseInt(entity["@_id"], 10);
    const entityTypeRef =
      entity?.generalInfo?.entityType?.["#text"] ?? entity?.generalInfo?.entityType;
    const isIndividual =
      typeof entityTypeRef === "string"
        ? entityTypeRef.toLowerCase().includes("individual")
        : false;

    // Extract names
    const names = entity?.names?.name ?? [];
    let primaryName = "";
    let firstName = "";
    let lastName = "";
    const aliases: string[] = [];

    for (const name of names) {
      const translations = name?.translations?.translation ?? [];
      for (const translation of translations) {
        const fullName = String(translation?.formattedFullName ?? "");
        const fName = String(translation?.formattedFirstName ?? "");
        const lName = String(translation?.formattedLastName ?? "");

        if (name?.isPrimary === true || name?.isPrimary === "true") {
          primaryName = fullName;
          firstName = fName;
          lastName = lName;
        } else {
          if (fullName) {
            aliases.push(fullName);
          }
        }
      }
    }

    // Extract programs
    const programsRaw = entity?.sanctionsPrograms?.sanctionsProgram ?? [];
    const programs: string[] = [];
    for (const prog of Array.isArray(programsRaw) ? programsRaw : [programsRaw]) {
      const text = String(typeof prog === "string" ? prog : prog?.["#text"] ?? "");
      if (text) programs.push(text);
    }

    if (!primaryName) {
      skipped++;
      continue;
    }

    batch.push({
      sdnId: entityId,
      entityType: isIndividual ? "individual" : "entity",
      primaryName,
      firstName: firstName || "",
      lastName: lastName || "",
      aliases,
      programs,
    });

    if (batch.length >= BATCH_SIZE) {
      await client.mutation(api.screeningMutations.batchInsertSdnEntries as any, {
        entries: batch,
      });
      imported += batch.length;
      process.stdout.write(`\rImported ${imported}/${entities.length} entries...`);
      batch = [];
    }
  }

  // Insert remaining
  if (batch.length > 0) {
    await client.mutation(api.screeningMutations.batchInsertSdnEntries as any, {
      entries: batch,
    });
    imported += batch.length;
  }

  console.log(`\nDone! Imported ${imported} entries, skipped ${skipped} (no primary name)`);
}

main().catch((err) => {
  console.error("Import failed:", err);
  process.exit(1);
});
