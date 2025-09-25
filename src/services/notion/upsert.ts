// src/services/notion/upsert.ts
import "https://deno.land/std@0.203.0/dotenv/load.ts";
import { getLatestEntries } from "../toggl/entries.ts";
import type { TogglReportsEntry } from "../toggl/types.ts";
import type { NotionTableProperties } from "./types.ts";

const NOTION_API_TOKEN = Deno.env.get("NOTION_INTEGRATION_SECRET")?.trim();
const NOTION_DATA_SOURCE_ID = Deno.env.get("NOTION_DATA_SOURCE_ID")?.trim();

if (!NOTION_API_TOKEN || !NOTION_DATA_SOURCE_ID) {
  throw new Error("Missing NOTION_API_TOKEN or NOTION_DATA_SOURCE_ID in environment");
}

/** TogglReportsEntry -> Notion properties に変換 */
function buildPropertiesFromEntry(entry: TogglReportsEntry): NotionTableProperties {
  const props: NotionTableProperties = {
    description: { title: [{ text: { content: entry.description ?? "" } }] },
    date: { date: { start: entry.start, end: entry.end } },
    id: { number: entry.id },
  };
  if (entry.project) props.project = { select: { name: entry.project } };
  if (entry.client) props.client = { select: { name: entry.client } };
  return props;
}

/** fetch wrapper */
async function notionRequest(path: string, opts: RequestInit) {
  const res = await fetch(`https://api.notion.com/v1${path}`, {
    ...opts,
    headers: {
      Authorization: `Bearer ${NOTION_API_TOKEN}`,
      "Notion-Version": "2025-09-03",
      "Content-Type": "application/json",
      ...(opts.headers ?? {}),
    },
  });
  const text = await res.text();
  let body: any = text;
  try { body = text ? JSON.parse(text) : null; } catch {}
  if (!res.ok) throw new Error(`Notion API error: ${res.status} ${res.statusText} ${JSON.stringify(body)}`);
  return body;
}

/** Toggl ID で既存ページを検索（Data Source API） */
async function findPageByTogglId(entryId: number) {
  const body = {
    filter: { or: [{ property: "id", number: { equals: entryId } }] },
    sorts: [{ property: "date", direction: "ascending" }],
  };

  const data = await notionRequest(`/data_sources/${NOTION_DATA_SOURCE_ID}/query`, {
    method: "POST",
    body: JSON.stringify(body),
  });

  return data.results?.[0] ?? null;
}

/** Upsert: 既存なら PATCH、なければ POST */
export async function upsertEntry(entry: TogglReportsEntry) {
  try {
    const existingPage = await findPageByTogglId(entry.id);
    const props = buildPropertiesFromEntry(entry);

    if (existingPage) {
      // id は更新しない
      delete props.id;
      await notionRequest(`/pages/${existingPage.id}`, {
        method: "PATCH",
        body: JSON.stringify({ properties: props }),
      });
      console.log(`🔄 Updated entry ${entry.id}`);
    } else {
      await notionRequest("/pages", {
        method: "POST",
        body: JSON.stringify({
          parent: { data_source_id: NOTION_DATA_SOURCE_ID },
          properties: props,
        }),
      });
      console.log(`✨ Created entry ${entry.id}`);
    }
  } catch (err) {
    console.error(`Failed to upsert entry ${entry.id}:`, err);
  }
}

/** 全件ループで upsert */
if (import.meta.main) {
  (async () => {
    try {
      const entries: TogglReportsEntry[] = await getLatestEntries();
      console.log(`Total entries fetched: ${entries.length}`);

      for (const entry of entries) {
        console.log(`project: ${entry.project}, description: ${entry.description}`);
        await upsertEntry(entry);
      }

      console.log("All entries processed.");
    } catch (err) {
      console.error("Failed to fetch or upsert entries:", err);
    }
  })();
}
