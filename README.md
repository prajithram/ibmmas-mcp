# IBM MAS Work Order MCP Server

Connects Claude directly to your IBM Maximo Application Suite (MAS) so you can chat about live work order data, run analysis, and query maintenance history conversationally.

---

## What Claude can do once connected

| Ask Claude... | What happens |
|---|---|
| "Show me all open work orders for PUMP-003" | Live API call to MAS, returns real data |
| "What's my PM compliance for Q3?" | Fetches PM WOs, calculates on-time % |
| "Which assets had the most breakdowns this year?" | Failure analysis across CM/EM WOs |
| "What's the cost overrun on WO-10031?" | Pulls actual vs estimated costs |
| "Show me the backlog for MechTeamA" | Filtered open WOs by crew |
| "Are there any overdue work orders?" | Finds WOs past schedfinish still open |
| "Approve work order WO-10045" | Updates status in MAS (with your confirmation) |

---

## Setup

### 1. Install dependencies

```bash
npm install
```

### 2. Configure environment variables

Create a `.env` file or export these before running:

```bash
# Your MAS server URL (no trailing slash)
MAS_HOST=https://your-mas-instance.example.com

# Authentication — use API key (preferred) OR username/password
MAS_APIKEY=your-api-key-here

# OR basic auth:
MAS_USERNAME=maximo-user
MAS_PASSWORD=maximo-password

# Optional: use lean JSON (smaller responses, recommended)
MAS_LEAN=1
```

**Getting a MAS API key:**
Go to MAS → Security → API Keys → Generate Key

### 3. Add to Claude Desktop

Edit `~/Library/Application Support/Claude/claude_desktop_config.json` (macOS)
or `%APPDATA%\Claude\claude_desktop_config.json` (Windows):

```json
{
  "mcpServers": {
    "ibm-mas": {
      "command": "node",
      "args": ["/full/path/to/mas-mcp-server/src/index.js"],
      "env": {
        "MAS_HOST": "https://your-mas-instance.example.com",
        "MAS_APIKEY": "your-api-key-here",
        "MAS_LEAN": "1"
      }
    }
  }
}
```

Then **restart Claude Desktop**. You'll see a 🔌 icon confirming the MCP server is connected.

### 4. Add to Claude Code (alternative)

```bash
claude mcp add ibm-mas -- node /full/path/to/mas-mcp-server/src/index.js
```

Set env vars in your shell before running Claude Code.

---

## Available Tools

| Tool | Description |
|---|---|
| `get_work_orders` | Query WOs with filters: status, type, asset, crew, dates, priority |
| `get_work_order_detail` | Full detail on a single WO including labor/materials |
| `get_asset_work_history` | All WOs for an asset + MTTR calculation |
| `get_open_backlog` | Current open WO backlog with total estimated hours |
| `get_overdue_work_orders` | WOs past their scheduled finish date, still open |
| `get_pm_compliance` | PM WOs in a period with on-time completion % |
| `get_failure_analysis` | CM/EM breakdown by failure code and asset |
| `get_cost_analysis` | Actual vs estimated costs with variance % |
| `get_assets` | Search assets by number, description, or location |
| `get_crew_workload` | Open WO count and hours by crew |
| `update_work_order_status` | Change WO status in MAS (approve, start, complete) |

---

## Requirements

- Node.js 18+
- IBM MAS 8.x or 9.x (Maximo 7.6.1+ also works)
- OSLC API enabled on your MAS instance
- Network access from the machine running this server to your MAS host

---

## Firewall / VPN note

This server runs locally on your machine and makes outbound HTTPS calls to your MAS host. If MAS is on a private network, run this server from a machine inside that network or connected via VPN.
