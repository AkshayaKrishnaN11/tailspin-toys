import { createServer } from "node:http";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { joinSession, createCanvas } from "@github/copilot-sdk/extension";

const execFileAsync = promisify(execFile);
const servers = new Map();

function escapeHtml(value) {
    return String(value ?? "")
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;")
        .replaceAll("'", "&#039;");
}

function scoreIssue(issue) {
    const labelNames = issue.labels.map((label) => label.name.toLowerCase());
    let score = 0;
    if (labelNames.some((label) => /critical|urgent|security|blocker/.test(label))) score += 60;
    if (labelNames.some((label) => /bug|regression|broken/.test(label))) score += 35;
    if (labelNames.some((label) => /enhancement|feature/.test(label))) score += 10;
    score += Math.min(issue.comments * 4, 20);
    const ageInDays = (Date.now() - Date.parse(issue.updatedAt)) / 86_400_000;
    score += Math.max(0, 20 - ageInDays);
    if (issue.assignees.length === 0) score += 8;
    return score;
}

async function getIssues() {
    const { stdout } = await execFileAsync("gh", [
        "issue", "list", "--state", "open", "--limit", "50",
        "--json", "number,title,body,url,labels,updatedAt,createdAt,assignees,comments",
    ], { cwd: process.cwd(), windowsHide: true, maxBuffer: 2_000_000 });
    const issues = JSON.parse(stdout);
    return issues
        .map((issue) => ({ ...issue, score: scoreIssue(issue) }))
        .sort((a, b) => b.score - a.score);
}

function issueReason(issue) {
    const labels = issue.labels.map((label) => label.name.toLowerCase());
    const reasons = [];
    if (labels.some((label) => /critical|urgent|security|blocker/.test(label))) reasons.push("high-severity label");
    if (labels.some((label) => /bug|regression|broken/.test(label))) reasons.push("bug/regression label");
    if (issue.comments > 0) reasons.push(`${issue.comments} discussion comment${issue.comments === 1 ? "" : "s"}`);
    if (issue.assignees.length === 0) reasons.push("unassigned");
    const ageInDays = Math.floor((Date.now() - Date.parse(issue.updatedAt)) / 86_400_000);
    if (ageInDays < 7) reasons.push("recently updated");
    return reasons.length ? `Prioritized for ${reasons.join(", ")}.` : "Prioritized by recent activity and open-work status.";
}

function issueCard(issue, priority) {
    const body = issue.body?.trim() || "No description provided.";
    const labels = issue.labels.map((label) =>
        `<span class="label">${escapeHtml(label.name)}</span>`).join("");
    const explanation = priority ? `<p class="reason"><strong>Why now:</strong> ${escapeHtml(issueReason(issue))}</p>` : "";
    return `<article class="card">
      <div class="card-top"><span class="number">#${issue.number}</span>${labels}</div>
      <h3><a href="${escapeHtml(issue.url)}" target="_blank" rel="noreferrer">${escapeHtml(issue.title)}</a></h3>
      <p class="description">${escapeHtml(body.slice(0, 320))}${body.length > 320 ? "…" : ""}</p>
      ${explanation}
      <div class="card-footer"><span>Updated ${escapeHtml(new Date(issue.updatedAt).toLocaleDateString())}</span>
      <button data-issue="${issue.number}" data-testid="add-issue-${issue.number}">Add to current context</button></div>
    </article>`;
}

function renderHtml(instanceId, issues, errorMessage = "") {
    const top = issues.slice(0, 3);
    const remainder = issues.slice(3);
    const error = errorMessage ? `<div class="error" role="alert">${escapeHtml(errorMessage)}</div>` : "";
    return `<!doctype html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Issue triage</title><style>
:root{color-scheme:dark;font-family:Inter,ui-sans-serif,system-ui,sans-serif;background:#0f172a;color:#e2e8f0}
body{margin:0;padding:28px;max-width:1100px;margin-inline:auto}h1{margin:0 0 6px;font-size:28px}
.subtitle{color:#94a3b8;margin:0 0 28px}.section{margin-top:28px}.section h2{font-size:18px;margin:0 0 12px;color:#f8fafc}
.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:14px}.card{background:#1e293b;border:1px solid #334155;border-radius:12px;padding:17px;display:flex;flex-direction:column;min-height:220px}
.card:first-child{border-color:#f59e0b;box-shadow:0 0 0 1px #f59e0b33}.card-top{display:flex;gap:7px;align-items:center;flex-wrap:wrap}
.number{font-weight:700;color:#fbbf24}.label{font-size:11px;background:#334155;color:#cbd5e1;border-radius:999px;padding:3px 8px}
h3{margin:12px 0 7px;font-size:17px}h3 a{color:#f8fafc;text-decoration:none}h3 a:hover{text-decoration:underline}
.description{color:#cbd5e1;font-size:14px;line-height:1.45;margin:0}.reason{font-size:13px;color:#fcd34d;line-height:1.4;margin:12px 0 0}
.card-footer{display:flex;align-items:center;justify-content:space-between;gap:10px;margin-top:auto;padding-top:17px;color:#94a3b8;font-size:12px}
button{border:0;border-radius:7px;background:#2563eb;color:white;padding:8px 11px;font-weight:600;cursor:pointer}button:hover{background:#3b82f6}button:disabled{opacity:.65;cursor:wait}
.error{background:#451a03;border:1px solid #b45309;color:#fed7aa;padding:12px;border-radius:8px;margin-bottom:18px}
@media(max-width:520px){body{padding:18px}.card-footer{align-items:flex-start;flex-direction:column}}
</style></head><body>
<h1>Issue triage board</h1><p class="subtitle">Open work ranked by severity, activity, and ownership.</p>${error}
<section class="section"><h2>Needs attention now · ${top.length}</h2><div class="grid">${top.length ? top.map((issue) => issueCard(issue, true)).join("") : "<p>No open issues found.</p>"}</div></section>
<section class="section"><h2>Remaining open issues · ${remainder.length}</h2><div class="grid">${remainder.map((issue) => issueCard(issue, false)).join("") || "<p>No remaining issues.</p>"}</div></section>
<script>
document.querySelectorAll("button[data-issue]").forEach((button) => button.addEventListener("click", async () => {
  button.disabled = true; button.textContent = "Adding…";
  try { const response = await fetch("/add", {method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({number:Number(button.dataset.issue)})});
    if (!response.ok) throw new Error(await response.text()); button.textContent = "Added to context";
  } catch (error) { button.disabled = false; button.textContent = "Try again"; button.title = error.message; }
}));
</script></body></html>`;
}

async function startServer(instanceId, sessionId, session) {
    let issues = [];
    let errorMessage = "";
    try {
        issues = await getIssues();
    } catch (error) {
        errorMessage = `Could not load GitHub issues: ${error.message}`;
    }
    const server = createServer(async (req, res) => {
        if (req.method === "POST" && req.url === "/add") {
            let raw = "";
            for await (const chunk of req) raw += chunk;
            try {
                const { number } = JSON.parse(raw);
                const issue = issues.find((item) => item.number === number);
                if (!issue) throw new Error("Issue is no longer in the loaded board.");
                await session.send({ prompt: `Add GitHub issue #${issue.number} to the current work context. Title: ${issue.title}. Description: ${issue.body || "No description provided."} URL: ${issue.url}` });
                res.writeHead(204);
                res.end();
            } catch (error) {
                res.writeHead(500, { "Content-Type": "text/plain; charset=utf-8" });
                res.end(error.message);
            }
            return;
        }
        res.setHeader("Content-Type", "text/html; charset=utf-8");
        res.end(renderHtml(instanceId, issues, errorMessage));
    });
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    return { server, url: `http://127.0.0.1:${address.port}/`, sessionId };
}

const session = await joinSession({
    canvases: [createCanvas({
        id: "kanban-triage",
        displayName: "Issue triage board",
        description: "A Kanban board showing the three open GitHub issues most likely to need attention, followed by the remainder.",
        actions: [{
            name: "add_issue_to_context",
            description: "Add a displayed GitHub issue to the current session context.",
            inputSchema: { type: "object", properties: { number: { type: "number" } }, required: ["number"] },
            handler: async (ctx) => {
                const entry = servers.get(ctx.instanceId);
                const issue = entry?.issues?.find((item) => item.number === ctx.input?.number);
                if (!issue) return { ok: false, error: "Issue not found on this board." };
                await session.send({ prompt: `Add GitHub issue #${issue.number} to the current work context. Title: ${issue.title}. Description: ${issue.body || "No description provided."} URL: ${issue.url}` });
                return { ok: true, number: issue.number };
            },
        }],
        open: async (ctx) => {
            let entry = servers.get(ctx.instanceId);
            if (!entry) {
                entry = await startServer(ctx.instanceId, ctx.sessionId, session);
                entry.issues = await getIssues().catch(() => []);
                servers.set(ctx.instanceId, entry);
            }
            return { title: "Issue triage board", url: entry.url };
        },
        onClose: async (ctx) => {
            const entry = servers.get(ctx.instanceId);
            if (entry) {
                servers.delete(ctx.instanceId);
                await new Promise((resolve) => entry.server.close(resolve));
            }
        },
    })],
});
