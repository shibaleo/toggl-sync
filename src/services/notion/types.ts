// services/notion/types.ts

export interface NotionTableProperties {
  description: { title: { text: { content: string } }[] };
  date: { date: { start: string; end: string } };
  id: { number: number };
  project?: { select: { name: string } };
  client?: { select: { name: string } };
}