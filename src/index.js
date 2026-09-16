#!/usr/bin/env node
/**
 * IBM MAS (Maximo Application Suite) MCP Server
 * Connects Claude to live MAS via the Maximo JSON API (mxapi* object structures, MAS 8.x+)
 * Author @prajithram
 *
 * Setup:
 *   MAS_HOST=https://your-mas-host.com
 *   MAS_USERNAME=your-username
 *   MAS_PASSWORD=your-password
 *   MAS_APIKEY=your-apikey        (alternative to username/password)
 *   MAS_LEAN=1                    (optional: use lean JSON responses)
 */

//importing mcp framework
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import fetch from "node-fetch";

// ── Config ──────────────────────────────────────────────────────────────────
const MAS_HOST = process.env.MAS_HOST?.replace(/\/$/, "");
const MAS_USERNAME = process.env.MAS_USERNAME;
const MAS_PASSWORD = process.env.MAS_PASSWORD;
const MAS_APIKEY = process.env.MAS_APIKEY;
const MAS_LEAN = process.env.MAS_LEAN !== "0"; // default true

if (!MAS_HOST) {
  console.error("ERROR: MAS_HOST environment variable is required");
  process.exit(1);
}

// ── Auth headers ────────────────────────────────────────────────────────────
function getAuthHeaders() {
  const headers = {
    "Content-Type": "application/json",
    Accept: "application/json",
  };
  if (MAS_APIKEY) {
    headers["apikey"] = MAS_APIKEY; 
  } else if (MAS_USERNAME && MAS_PASSWORD) {
    const b64 = Buffer.from(`${MAS_USERNAME}:${MAS_PASSWORD}`).toString("base64");
    headers["Authorization"] = `Basic ${b64}`;
  } else {
    throw new Error("Set MAS_APIKEY or MAS_USERNAME + MAS_PASSWORD");
  }
  return headers;
}

// ── MAS API caller ──────────────────────────────────────────────────────────
//Prajith-> Genernic method called by tools
async function masGet(path, params = {}) {
  const url = new URL(`${MAS_HOST}/maximo/api/${path}`);
  if (MAS_LEAN) url.searchParams.set("lean", "1");
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null && v !== "") {
      url.searchParams.set(k, v);
    }
  }

  const res = await fetch(url.toString(), {
    method: "GET",
    headers: getAuthHeaders(),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`MAS API error ${res.status}: ${body.slice(0, 300)}`);
  }
  return res.json();
}

// resourceUrl is the full href returned by the GET response (lean mode provides this).
async function masPatch(resourceUrl, body) {
  const res = await fetch(resourceUrl, {
    method: "PATCH",
    headers: getAuthHeaders(),
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`MAS API error ${res.status}: ${txt.slice(0, 300)}`);
  }
  return res.status === 204 ? { success: true } : res.json();
}

// ── Field sets ──────────────────────────────────────────────────────────────
//Prajith - add additonal custom fieds a per requirments;
const WO_FIELDS = [
  "wonum", "description", "status", "worktype", "priority",
  "assetnum", "assetdescription", "location", "locationdesc",
  "reportdate", "schedstart", "schedfinish", "actstart", "actfinish",
  "estdur", "actdur", "estlabcost", "actlabcost",
  "estmatcost", "actmatcost", "esttoolcost", "acttoolcost",
  "totalcost", "estcost",
  "failurecode", "problemcode", "causecode", "remedycode",
  "crew", "supervisor", "reportedby",
  "wopriority", "calcpriority", "targstartdate",
  "siteid", "orgid", "downtime",
].join(",");

// ── Helper: format results summary ──────────────────────────────────────────
function summarise(data, objectName) {
  const members = data?.member ?? [];
  return {
    total: data?.totalCount ?? members.length,
    returned: members.length,
    [objectName]: members,
  };
}

// ── Tool definitions ────────────────────────────────────────────────────────
const TOOLS = [
  {
    name: "get_work_orders",
    description:
      "Fetch work orders from IBM MAS with flexible filters. Use this to query open WOs, filter by status, work type, asset, crew, date range, or priority. Returns full WO details including costs, dates, and failure codes.",
    inputSchema: {
      type: "object",
      properties: {
        status: {
          type: "string",
          description:
            "Filter by status. Examples: INPRG, APPR, WAPPR, COMP, CLOSE, CAN. Comma-separate for multiple: \"INPRG,APPR\"",
        },
        worktype: {
          type: "string",
          description: "Filter by work type: PM, CM, EM, CAL, OT, INS",
        },
        assetnum: {
          type: "string",
          description: "Filter by asset number (exact or partial)",
        },
        location: {
          type: "string",
          description: "Filter by location code",
        },
        crew: {
          type: "string",
          description: "Filter by crew name",
        },
        priority: {
          type: "number",
          description: "Filter by priority (1=Critical, 2=Urgent, 3=Normal, 4=Low)",
        },
        date_from: {
          type: "string",
          description: "Report date from (YYYY-MM-DD)",
        },
        date_to: {
          type: "string",
          description: "Report date to (YYYY-MM-DD)",
        },
        limit: {
          type: "number",
          description: "Max records to return (default 50, max 200)",
          default: 50,
        },
        search: {
          type: "string",
          description: "Free-text search in WO description",
        },
      },
    },
  },
  {
    name: "get_work_order_detail",
    description:
      "Get full details for a single work order by WO number, including labor records, materials, costs, failure codes, and all dates.",
    inputSchema: {
      type: "object",
      required: ["wonum"],
      properties: {
        wonum: { type: "string", description: "Work order number e.g. WO-10042" },
      },
    },
  },
  {
    name: "get_asset_work_history",
    description:
      "Get the complete maintenance history for a specific asset — all work orders ever raised against it, sorted by date. Great for trend analysis, MTTR, and failure pattern identification.",
    inputSchema: {
      type: "object",
      required: ["assetnum"],
      properties: {
        assetnum: { type: "string", description: "Asset number" },
        limit: { type: "number", description: "Max records (default 100)", default: 100 },
      },
    },
  },
  {
    name: "get_open_backlog",
    description:
      "Fetch all open (not completed/closed/cancelled) work orders — the current maintenance backlog. Useful for workload planning and identifying overdue WOs.",
    inputSchema: {
      type: "object",
      properties: {
        crew: { type: "string", description: "Filter by crew (optional)" },
        worktype: { type: "string", description: "Filter by work type (optional)" },
        limit: { type: "number", default: 100 },
      },
    },
  },
  {
    name: "get_overdue_work_orders",
    description:
      "Fetch work orders where the scheduled finish date has passed but the WO is still open. Essential for SLA tracking.",
    inputSchema: {
      type: "object",
      properties: {
        limit: { type: "number", default: 50 },
      },
    },
  },
  {
    name: "get_pm_compliance",
    description:
      "Fetch preventive maintenance (PM) work orders in a date range and calculate compliance — how many were completed on time vs overdue.",
    inputSchema: {
      type: "object",
      properties: {
        date_from: { type: "string", description: "Start date YYYY-MM-DD" },
        date_to: { type: "string", description: "End date YYYY-MM-DD" },
        location: { type: "string", description: "Filter by location (optional)" },
        limit: { type: "number", default: 200 },
      },
    },
  },
  {
    name: "get_failure_analysis",
    description:
      "Fetch corrective and emergency work orders with failure codes to analyse breakdown patterns, most common failure types, and assets with repeated failures.",
    inputSchema: {
      type: "object",
      properties: {
        date_from: { type: "string", description: "Start date YYYY-MM-DD" },
        date_to: { type: "string", description: "End date YYYY-MM-DD" },
        assetnum: { type: "string", description: "Specific asset (optional)" },
        limit: { type: "number", default: 200 },
      },
    },
  },
  {
    name: "get_cost_analysis",
    description:
      "Fetch completed work orders with actual vs estimated costs to calculate cost variance, overruns, and total maintenance spend in a period.",
    inputSchema: {
      type: "object",
      properties: {
        date_from: { type: "string", description: "Start date YYYY-MM-DD" },
        date_to: { type: "string", description: "End date YYYY-MM-DD" },
        worktype: { type: "string", description: "Filter by work type (optional)" },
        limit: { type: "number", default: 200 },
      },
    },
  },
  {
    name: "get_assets",
    description:
      "Search for assets in MAS — get asset details, location, status, and description. Useful for looking up asset numbers before querying work orders.",
    inputSchema: {
      type: "object",
      properties: {
        search: { type: "string", description: "Search by asset number or description" },
        location: { type: "string", description: "Filter by location" },
        status: { type: "string", description: "Asset status e.g. OPERATING, DECOMMISSIONED" },
        limit: { type: "number", default: 50 },
      },
    },
  },
  {
    name: "get_crew_workload",
    description:
      "Get a summary of open work orders grouped by crew to assess workload distribution and backlog per team.",
    inputSchema: {
      type: "object",
      properties: {
        date_from: { type: "string" },
        date_to: { type: "string" },
      },
    },
  },
  {
    name: "update_work_order_status",
    description:
      "Update the status of a work order in MAS (e.g. approve a WO, mark as in progress). Use with caution — this writes to your live MAS system.",
    inputSchema: {
      type: "object",
      required: ["wonum", "status"],
      properties: {
        wonum: { type: "string" },
        status: {
          type: "string",
          description: "New status: APPR, INPRG, COMP, CAN",
        },
        memo: { type: "string", description: "Optional status change memo" },
      },
    },
  },
];

// ── Tool handlers ───────────────────────────────────────────────────────────
async function handleTool(name, args) {
  switch (name) {

    case "get_work_orders": {
      const where = [];
      if (args.status) {
        const statuses = args.status.split(",").map(s => `"${s.trim()}"`).join(",");
        where.push(args.status.includes(",")
          ? `status in [${statuses}]`
          : `status="${args.status.trim()}"`);
      }
      if (args.worktype) where.push(`worktype="${args.worktype}"`);
      if (args.assetnum) where.push(`assetnum="${args.assetnum}"`);
      if (args.location) where.push(`location="${args.location}"`);
      if (args.crew) where.push(`crew="${args.crew}"`);
      if (args.priority) where.push(`wopriority=${args.priority}`);
      if (args.date_from) where.push(`reportdate>="${args.date_from}"`);
      if (args.date_to) where.push(`reportdate<="${args.date_to}"`);
      if (args.search) where.push(`description="%${args.search}%"`);

      const data = await masGet("os/mxapiwo", {
        "oslc.where": where.length ? where.join(" and ") : undefined,
        "oslc.select": WO_FIELDS,
        "oslc.pageSize": Math.min(args.limit ?? 50, 200),
        "oslc.orderBy": "-reportdate",
      });
      return summarise(data, "work_orders");
    }

    case "get_work_order_detail": {
      const data = await masGet("os/mxapiwo", {
        "oslc.where": `wonum="${args.wonum}"`,
        "oslc.select": WO_FIELDS + ",wptask{*},wplabor{*},wptools{*},wpmaterial{*},doclinks{*}",
      });
      const members = data?.member ?? [];
      if (!members.length) return { error: `No work order found with wonum: ${args.wonum}` };
      return members[0];
    }

    case "get_asset_work_history": {
      const data = await masGet("os/mxapiwo", {
        "oslc.where": `assetnum="${args.assetnum}"`,
        "oslc.select": WO_FIELDS,
        "oslc.pageSize": Math.min(args.limit ?? 100, 200),
        "oslc.orderBy": "-reportdate",
      });
      const result = summarise(data, "work_orders");

      // Calculate MTTR for CM/EM orders
      const repairWOs = result.work_orders.filter(
        w => ["CM", "EM"].includes(w.worktype) && w.actdur
      );
      const mttr = repairWOs.length
        ? (repairWOs.reduce((s, w) => s + (w.actdur || 0), 0) / repairWOs.length).toFixed(1)
        : null;

      return { ...result, asset: args.assetnum, mttr_hours: mttr };
    }

    case "get_open_backlog": {
      const where = [`status in ["WAPPR","APPR","WMATL","WSCH","SCHED","INPRG"]`];
      if (args.crew) where.push(`crew="${args.crew}"`);
      if (args.worktype) where.push(`worktype="${args.worktype}"`);

      const data = await masGet("os/mxapiwo", {
        "oslc.where": where.join(" and "),
        "oslc.select": WO_FIELDS,
        "oslc.pageSize": Math.min(args.limit ?? 100, 200),
        "oslc.orderBy": "wopriority,-reportdate",
      });
      const result = summarise(data, "work_orders");
      const totalEstHours = result.work_orders.reduce((s, w) => s + (w.estdur || 0), 0);
      return { ...result, total_estimated_hours: totalEstHours };
    }

    case "get_overdue_work_orders": {
      const today = new Date().toISOString().split("T")[0];
      const data = await masGet("os/mxapiwo", {
        "oslc.where": `schedfinish<="${today}" and status in ["WAPPR","APPR","WMATL","WSCH","SCHED","INPRG"]`,
        "oslc.select": WO_FIELDS,
        "oslc.pageSize": Math.min(args.limit ?? 50, 200),
        "oslc.orderBy": "schedfinish",
      });
      const result = summarise(data, "work_orders");

      // Add days overdue to each WO
      result.work_orders = result.work_orders.map(wo => {
        const daysOverdue = wo.schedfinish
          ? Math.floor((Date.now() - new Date(wo.schedfinish)) / 86400000)
          : null;
        return { ...wo, days_overdue: daysOverdue };
      });
      return result;
    }

    case "get_pm_compliance": {
      const where = [`worktype="PM"`];
      if (args.date_from) where.push(`schedfinish>="${args.date_from}"`);
      if (args.date_to) where.push(`schedfinish<="${args.date_to}"`);
      if (args.location) where.push(`location="${args.location}"`);

      const data = await masGet("os/mxapiwo", {
        "oslc.where": where.join(" and "),
        "oslc.select": "wonum,description,status,assetnum,schedfinish,actfinish,worktype",
        "oslc.pageSize": Math.min(args.limit ?? 200, 200),
      });

      const wos = data?.member ?? [];
      const completed = wos.filter(w => w.status === "COMP" || w.status === "CLOSE");
      const onTime = completed.filter(w => w.actfinish && w.schedfinish && w.actfinish <= w.schedfinish);
      const overdue = wos.filter(w =>
        !["COMP", "CLOSE", "CAN"].includes(w.status) &&
        w.schedfinish &&
        w.schedfinish < new Date().toISOString()
      );

      return {
        total_pm_wos: wos.length,
        completed: completed.length,
        on_time: onTime.length,
        overdue_open: overdue.length,
        compliance_pct: completed.length
          ? ((onTime.length / completed.length) * 100).toFixed(1) + "%"
          : "N/A",
        overdue_work_orders: overdue.slice(0, 20),
      };
    }

    case "get_failure_analysis": {
      const where = [`worktype in ["CM","EM"]`];
      if (args.date_from) where.push(`reportdate>="${args.date_from}"`);
      if (args.date_to) where.push(`reportdate<="${args.date_to}"`);
      if (args.assetnum) where.push(`assetnum="${args.assetnum}"`);

      const data = await masGet("os/mxapiwo", {
        "oslc.where": where.join(" and "),
        "oslc.select": "wonum,description,status,assetnum,failurecode,problemcode,causecode,remedycode,actdur,downtime,reportdate,worktype",
        "oslc.pageSize": Math.min(args.limit ?? 200, 200),
        "oslc.orderBy": "-reportdate",
      });

      const wos = data?.member ?? [];

      // Roll up failure codes
      const failureCounts = {};
      const assetCounts = {};
      let totalDowntime = 0;

      for (const wo of wos) {
        const fc = wo.failurecode || "UNCLASSIFIED";
        failureCounts[fc] = (failureCounts[fc] || 0) + 1;
        assetCounts[wo.assetnum] = (assetCounts[wo.assetnum] || 0) + 1;
        totalDowntime += wo.downtime || 0;
      }

      const topFailures = Object.entries(failureCounts)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 10)
        .map(([code, count]) => ({ failure_code: code, count }));

      const topAssets = Object.entries(assetCounts)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 10)
        .map(([asset, count]) => ({ assetnum: asset, cm_count: count }));

      return {
        total_cm_em_wos: wos.length,
        total_downtime_hours: totalDowntime,
        top_failure_codes: topFailures,
        most_problematic_assets: topAssets,
        work_orders: wos.slice(0, 50),
      };
    }

    case "get_cost_analysis": {
      const where = [`status in ["COMP","CLOSE"]`];
      if (args.date_from) where.push(`actfinish>="${args.date_from}"`);
      if (args.date_to) where.push(`actfinish<="${args.date_to}"`);
      if (args.worktype) where.push(`worktype="${args.worktype}"`);

      const data = await masGet("os/mxapiwo", {
        "oslc.where": where.join(" and "),
        "oslc.select": "wonum,description,worktype,assetnum,estlabcost,actlabcost,estmatcost,actmatcost,esttoolcost,acttoolcost,actfinish",
        "oslc.pageSize": Math.min(args.limit ?? 200, 200),
        "oslc.orderBy": "-actfinish",
      });

      const wos = data?.member ?? [];
      let totalEst = 0, totalAct = 0;

      const withVariance = wos.map(wo => {
        const est = (wo.estlabcost || 0) + (wo.estmatcost || 0) + (wo.esttoolcost || 0);
        const act = (wo.actlabcost || 0) + (wo.actmatcost || 0) + (wo.acttoolcost || 0);
        totalEst += est;
        totalAct += act;
        return {
          wonum: wo.wonum,
          description: wo.description,
          worktype: wo.worktype,
          assetnum: wo.assetnum,
          estimated_total: est.toFixed(2),
          actual_total: act.toFixed(2),
          variance: (act - est).toFixed(2),
          variance_pct: est > 0 ? (((act - est) / est) * 100).toFixed(1) + "%" : "N/A",
        };
      });

      return {
        total_wos: wos.length,
        total_estimated: totalEst.toFixed(2),
        total_actual: totalAct.toFixed(2),
        total_variance: (totalAct - totalEst).toFixed(2),
        overall_variance_pct: totalEst > 0
          ? (((totalAct - totalEst) / totalEst) * 100).toFixed(1) + "%"
          : "N/A",
        work_orders: withVariance,
      };
    }

    case "get_assets": {
      const where = [];
      if (args.search) where.push(`(assetnum="${args.search}%" or description="%${args.search}%")`);
      if (args.location) where.push(`location="${args.location}"`);
      if (args.status) where.push(`status="${args.status}"`);

      const data = await masGet("os/mxapiasset", {
        "oslc.where": where.length ? where.join(" and ") : undefined,
        "oslc.select": "assetnum,description,status,location,siteid,serialnum,manufacturer,model,installdate,replacecost",
        "oslc.pageSize": Math.min(args.limit ?? 50, 100),
        "oslc.orderBy": "assetnum",
      });
      return summarise(data, "assets");
    }

    case "get_crew_workload": {
      const where = [`status in ["WAPPR","APPR","WMATL","WSCH","SCHED","INPRG"]`];
      if (args.date_from) where.push(`reportdate>="${args.date_from}"`);
      if (args.date_to) where.push(`reportdate<="${args.date_to}"`);

      const data = await masGet("os/mxapiwo", {
        "oslc.where": where.join(" and "),
        "oslc.select": "wonum,crew,worktype,wopriority,estdur,status",
        "oslc.pageSize": 200,
      });

      const wos = data?.member ?? [];
      const byCreW = {};

      for (const wo of wos) {
        const crew = wo.crew || "Unassigned";
        if (!byCreW[crew]) byCreW[crew] = { crew, wo_count: 0, total_est_hours: 0, by_type: {} };
        byCreW[crew].wo_count++;
        byCreW[crew].total_est_hours += wo.estdur || 0;
        const t = wo.worktype || "OTHER";
        byCreW[crew].by_type[t] = (byCreW[crew].by_type[t] || 0) + 1;
      }

      return {
        total_open_wos: wos.length,
        crews: Object.values(byCreW).sort((a, b) => b.wo_count - a.wo_count),
      };
    }

    case "update_work_order_status": {
      const data = await masGet("os/mxapiwo", {
        "oslc.where": `wonum="${args.wonum}"`,
        "oslc.select": "wonum,status",
      });
      const members = data?.member ?? [];
      if (!members.length) return { error: `Work order ${args.wonum} not found` };

      const href = members[0].href;
      if (!href) return { error: `Work order ${args.wonum} has no resource URL — check lean mode is enabled` };

      const payload = { status: args.status };
      if (args.memo) payload.memo = args.memo;

      const result = await masPatch(href, payload);
      return { success: true, wonum: args.wonum, new_status: args.status, result };
    }

    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}

// ── MCP Server setup ────────────────────────────────────────────────────────
const server = new Server(
  { name: "mas-mcp-server", version: "1.0.0" },
  { capabilities: { tools: {} } }
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOLS }));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;
  try {
    const result = await handleTool(name, args ?? {});
    return {
      content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
    };
  } catch (err) {
    return {
      content: [{ type: "text", text: `Error: ${err.message}` }],
      isError: true,
    };
  }
});

// ── Start ────────────────────────────────────────────────────────────────────
const transport = new StdioServerTransport();
await server.connect(transport);
console.error("IBM MAS MCP Server running (Maximo REST API) — waiting for Claude to connect");

// Prajith you can test it using 
// > cd /Users/prajith.ramachandran/Downloads/mas-mcp-server && MAS_HOST=https://masurl.com MAS_APIKEY= MAS_LEAN=1 node src/index.js
