import "https://deno.land/std@0.203.0/dotenv/load.ts";

// --- Get environment variables ---
const API_TOKEN = Deno.env.get("TOGGL_API_TOKEN")?.trim();
const WORKSPACE_ID = Deno.env.get("TOGGL_WORKSPACE_ID")?.trim();

if (!API_TOKEN || !WORKSPACE_ID) {
  throw new Error("TOGGL_API_TOKEN or WORKSPACE_ID is not set in .env");
}

// --- Basic authentication header ---
const authHeader = {
  "Content-Type": "application/json",
  "Authorization": `Basic ${btoa(`${API_TOKEN}:api_token`)}`,
};

// --- Toggl Reports API (finished entries) ---
export async function getEntries(startDate: Date, endDate: Date) {
  const url = "https://api.track.toggl.com/reports/api/v2/details";
  let allEntries: any[] = [];
  let page = 1;

  console.log(`Fetching Toggl entries from ${startDate.toISOString().split("T")[0]} to ${endDate.toISOString().split("T")[0]}`);

  while (true) {
    const params = new URLSearchParams({
      workspace_id: WORKSPACE_ID,
      since: startDate.toISOString().split("T")[0],
      until: endDate.toISOString().split("T")[0],
      user_agent: "toggl-sync-script",
      page: page.toString(),
      per_page: "50",
    });

    const res = await fetch(`${url}?${params}`, { headers: authHeader });

    if (!res.ok) {
      const text = await res.text();
      console.error("Response text:", text);
      throw new Error(`Reports API fetch failed: ${res.status}`);
    }

    const data = await res.json();
    allEntries.push(...data.data);

    console.log(`Fetched ${data.data.length} entries (total so far: ${allEntries.length})`);

    // Stop if all entries have been fetched
    if (allEntries.length >= data.total_count) break;

    page++;
  }

  console.log(`Total entries fetched: ${allEntries.length}`);
  return allEntries;
}

let cachedUsers: any[] = [];
let cachedProjects: any[] = [];
let cachedClients: any[] = [];

async function fetchWorkspaceData() {
  const usersRes = await fetch(
    `https://api.track.toggl.com/api/v9/workspaces/${WORKSPACE_ID}/users`,
    { headers: authHeader }
  );
  if (!usersRes.ok) throw new Error("Failed to fetch users");
  cachedUsers = await usersRes.json();
  console.log(`Fetched ${cachedUsers} users`);

  const projectsRes = await fetch(
    `https://api.track.toggl.com/api/v9/workspaces/${WORKSPACE_ID}/projects`,
    { headers: authHeader }
  );
  if (!projectsRes.ok) throw new Error("Failed to fetch projects");
  cachedProjects = await projectsRes.json();

  const clientsRes = await fetch(
    `https://api.track.toggl.com/api/v9/workspaces/${WORKSPACE_ID}/clients`,
    { headers: authHeader }
  );
  if (!clientsRes.ok) throw new Error("Failed to fetch clients");
  cachedClients = await clientsRes.json();
}

// --- Current API（進行中エントリー） ---
export async function getCurrentEntry() {
  try {
    const res = await fetch(
      `https://api.track.toggl.com/api/v9/me/time_entries/current`,
      { headers: authHeader }
    );
    if (!res.ok) {
      console.error(await res.text());
      return null;
    }

    const data = await res.json();
    if (!data) return null; // current entry がない場合は null

    const now = new Date();
    const start = new Date(data.start);

    // 情報補完
    let userName: string | null = null;
    let projectName: string | null = null;
    let clientName: string | null = null;
    if (data.uid) {
      const user = cachedUsers.find((u: any) => u.id === data.uid);
      userName = user?.fullname ?? null;
    }
    if (data.pid) {
      const project = cachedProjects.find((p: any) => p.id === data.pid);
      projectName = project?.name ?? null;
      const clientId = project?.client_id ?? null;
      if (clientId) {
        const client = cachedClients.find((c: any) => c.id === clientId);
        clientName = client?.name ?? null;
      }
    }

    return {
      id: data.id,
      pid: data.pid,
      tid: data.tid ?? null,
      start: data.start,
      end: now.toISOString(),
      dur: now.getTime() - start.getTime(),
      user: userName ?? null,
      project: projectName ?? null,
      description: data.description ?? "",
      client: clientName,
    };
  } catch (err) {
    console.error("Error fetching current entry:", err);
    return null;
  }
}

