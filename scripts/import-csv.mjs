#!/usr/bin/env node
/**
 * Imports the workspace CSVs + detail Markdown files into Supabase.
 *
 * Usage:
 *   node --env-file=.env.local scripts/import-csv.mjs
 *
 * Requires SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env.local.
 * Safe to re-run: companies that already exist (same list + name) are skipped.
 */
import { createClient } from "@supabase/supabase-js";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const workspaceRoot = join(__dirname, "..", "..");

const SUPABASE_URL =
  process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_KEY =
  process.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error(
    "Missing Supabase credentials.\n" +
      "Add NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SECRET_KEY to .env.local, then run:\n" +
      "  node --env-file=.env.local scripts/import-csv.mjs"
  );
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { persistSession: false },
});

// ── Tiny CSV parser (handles quoted fields) ─────────────────────────────────
function parseCsv(text) {
  const rows = [];
  let row = [];
  let cell = "";
  let inQuotes = false;

  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];

    if (inQuotes) {
      if (char === '"') {
        if (text[i + 1] === '"') {
          cell += '"';
          i += 1;
        } else {
          inQuotes = false;
        }
      } else {
        cell += char;
      }
    } else if (char === '"') {
      inQuotes = true;
    } else if (char === ",") {
      row.push(cell);
      cell = "";
    } else if (char === "\n") {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else if (char !== "\r") {
      cell += char;
    }
  }

  if (cell !== "" || row.length > 0) {
    row.push(cell);
    rows.push(row);
  }
  return rows;
}

function tableRows(markdown, heading) {
  const after = markdown.split(heading)[1];
  if (!after) return [];
  const section = after.split("\n## ")[0];
  return section
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.startsWith("|"))
    .map((line) => line.split("|").slice(1, -1).map((c) => c.trim()))
    .filter((cells) => cells.length >= 2);
}

function cleanCell(value) {
  if (!value) return null;
  const trimmed = value.trim();
  if (
    !trimmed ||
    trimmed === "—" ||
    /^(to (find|confirm)|n\/a)$/i.test(trimmed)
  ) {
    return null;
  }
  return trimmed;
}

function parseMembers(markdown) {
  return tableRows(markdown, "## Members")
    .filter(
      ([name]) =>
        name && !/^name$/i.test(name) && !/^-+$/.test(name) && name !== "—"
    )
    .map(([name, title, linkedin]) => ({
      name,
      title: cleanCell(title),
      linkedin_url: linkedin && linkedin.startsWith("http") ? linkedin : null,
    }));
}

function parseInteractions(markdown) {
  return tableRows(markdown, "## Interaction Log")
    .filter(
      ([date, , summary]) => /^\d{4}-\d{2}-\d{2}$/.test(date ?? "") && summary
    )
    .map(([date, channel, summary, outcome]) => ({
      occurred_on: date,
      channel: cleanCell(channel),
      summary,
      outcome: cleanCell(outcome),
    }));
}

// ── Value mappers ───────────────────────────────────────────────────────────
function mapKind(value) {
  const v = (value ?? "").toLowerCase();
  if (v.includes("competitor")) return "competitor";
  if (v.includes("partner")) return "partner";
  if (v.includes("lead")) return "lead";
  return "other";
}

function mapStatus(value) {
  const v = (value ?? "").toLowerCase();
  return ["contacted", "demo", "scoping", "proposal", "won", "lost"].includes(v)
    ? v
    : "new";
}

function mapPriority(value) {
  const v = (value ?? "").toLowerCase();
  return ["high", "medium", "low"].includes(v) ? v : null;
}

const CSV_FILES = [
  { csv: "companies.csv", list: "pos" },
  { csv: "service-companies.csv", list: "compliance" },
];

for (const { csv, list } of CSV_FILES) {
  const csvPath = join(workspaceRoot, csv);
  if (!existsSync(csvPath)) {
    console.warn(`skip missing ${csv}`);
    continue;
  }

  const rows = parseCsv(readFileSync(csvPath, "utf8"));
  const [header, ...data] = rows;
  let imported = 0;

  for (const row of data) {
    if (!row.length || !row[0]) continue;
    const record = Object.fromEntries(header.map((h, i) => [h, row[i] ?? ""]));
    const name = (record["Company Name"] ?? "").trim();
    if (!name) continue;

    const { data: existing } = await supabase
      .from("organizations")
      .select("id")
      .eq("list", list)
      .eq("name", name)
      .maybeSingle();

    if (existing) {
      console.log(`• skip (already imported): ${name}`);
      continue;
    }

    const { data: org, error } = await supabase
      .from("organizations")
      .insert({
        list,
        name,
        website: cleanCell(record["Website"]),
        linkedin_url: cleanCell(record["LinkedIn"]),
        kind: mapKind(record["Type"]),
        status: mapStatus(record["Status"]),
        priority: mapPriority(record["Priority"]),
        next_action: cleanCell(record["Next Action"]),
        last_contact: /^\d{4}-\d{2}-\d{2}$/.test(record["Last Contact"] ?? "")
          ? record["Last Contact"]
          : null,
        notes: cleanCell(record["Notes"]),
      })
      .select("id")
      .single();

    if (error) {
      console.error(`✗ ${name}: ${error.message}`);
      continue;
    }

    const detailFile = (record["Detail File"] ?? "").trim();
    if (detailFile) {
      const detailPath = join(workspaceRoot, detailFile);
      if (existsSync(detailPath)) {
        const markdown = readFileSync(detailPath, "utf8");

        for (const member of parseMembers(markdown)) {
          const { error: contactError } = await supabase
            .from("contacts")
            .insert({ org_id: org.id, ...member });
          if (contactError) {
            console.error(`  ! contact ${member.name}: ${contactError.message}`);
          }
        }

        for (const interaction of parseInteractions(markdown)) {
          const { error: interactionError } = await supabase
            .from("interactions")
            .insert({ org_id: org.id, ...interaction });
          if (interactionError) {
            console.error(`  ! interaction: ${interactionError.message}`);
          }
        }
      }
    }

    imported += 1;
    console.log(`✓ ${name}`);
  }

  console.log(`${csv}: ${imported} imported.`);
}

console.log("Done.");
