import pc from "picocolors";
import fs from "node:fs/promises";
import {
  addCommonClientOptions,
  handleCommandError,
  printOutput,
  resolveCommandContext,
  type BaseClientOptions,
} from "./client/common.js";
import {
  campaignSchema,
  CAMPAIGN_PIPELINE_STAGES,
  CAMPAIGN_PIPELINE_TRANSITIONS,
  type CampaignConfig,
  type LeadTemplate,
  type ReplyTemplate,
  type CampaignAnalytics,
} from "@paperclipai/shared/agency-campaign.js";
import { createIssueSchema } from "@paperclipai/shared/validators/issue.js";

function parseJson(text: string): unknown {
  return JSON.parse(text);
}

function parseOptionalInt(val: string | undefined): number | undefined {
  if (val === undefined) return undefined;
  const n = parseInt(val, 10);
  return Number.isNaN(n) ? undefined : n;
}

// ── Type Aliases ──────────────────────────────────────────────────────────────
interface CampaignBaseOptions extends BaseClientOptions {
  companyId?: string;
  campaignKey?: string;
  config?: string;
}

interface CampaignLaunchOptions extends CampaignBaseOptions {
  config: string;
  dryRun?: boolean;
  skipResearch?: boolean;
}

interface CampaignLeadsOptions extends CampaignBaseOptions {
  campaignKey: string;
  count?: string;
  fieldsFile?: string;
  fieldsJson?: string;
  skipEnrichment?: boolean;
}

interface CampaignOutreachOptions extends CampaignBaseOptions {
  campaignKey: string;
  channel: string;
  leadIds?: string;
  sequenceIndex?: string;
  dryRun?: boolean;
}

interface CampaignRepliesOptions extends CampaignBaseOptions {
  campaignKey: string;
  fileId?: string;
  replyJson?: string;
}

interface CampaignFollowupsOptions extends CampaignBaseOptions {
  campaignKey: string;
  daysSince?: string;
  dryRun?: boolean;
}

interface CampaignReportOptions extends CampaignBaseOptions {
  campaignKey: string;
  json?: boolean;
}

interface CampaignStatusOptions extends CampaignBaseOptions {
  campaignKey: string;
  json?: boolean;
}

// ── Helpers ───────────────────────────────────────────────────────────────────
async function resolveCampaign(
  ctx: { api: any; companyId?: string },
  campaignKey: string,
): Promise<{ campaignId: string; pipelineId?: string; agentIds: Record<string, string> }> {
  // Try pipeline lookup first by key
  const pipelines = await ctx.api.get<any[]>(
    `https://127.0.0.1:3100/api/companies/${ctx.companyId}/pipelines`,
  );
  const pipeline = pipelines?.find((p: any) => p.key === campaignKey);
  if (pipeline) {
    return { campaignId: pipeline.id, pipelineId: pipeline.id, agentIds: {} };
  }

  // Fall back to campaign lookup from agency campaigns table
  throw new Error(
    `Campaign '${campaignKey}' not found on company ${ctx.companyId}`,
  );
}

async function resolveAgentById(
  api: any,
  companyId: string,
  agentSlug: string,
): Promise<string | null> {
  const agents = (await api.get<any[]>(
    `https://127.0.0.1:3100/api/companies/${companyId}/agents`,
  )) ?? [];
  const agent = agents.find((a: any) => a.role === agentSlug || a.name?.toLowerCase().replace(/\s+/g, "-") === agentSlug);
  return agent?.id ?? null;
}

function formatInlineRecord(obj: Record<string, any>): string {
  return Object.entries(obj)
    .map(([k, v]) => `${k}: ${v}`)
    .join("  ");
}

function printProgressBar(current: number, total: number, label: string): void {
  const pct = Math.round((current / total) * 100);
  const bar = "█".repeat(Math.floor(pct / 5)) + "░".repeat(20 - Math.floor(pct / 5));
  console.log(`  ${pc.blue(label)} [${bar}] ${pc.gray(`${pct}%`)}`);
}

// ── Launch Command ────────────────────────────────────────────────────────────
// Creates a pipeline + campaign tasks from config file.
async function campaignLaunch(opts: CampaignLaunchOptions): Promise<void> {
  const ctx = resolveCommandContext(opts, { requireCompany: true });

  // Load & validate config
  const configContent = await fs.readFile(opts.config, "utf-8");
  const rawConfig = parseJson(configContent) as unknown;
  const config = campaignSchema.parse(rawConfig);

  if (opts.dryRun) {
    console.log(pc.bold("\n═══ Campaign Launch (Dry Run) ═══"));
    console.log(`  Name:        ${config.name}`);
    console.log(`  Channels:    ${config.channels.join(", ")}`);
    console.log(`  Research:    ${config.research.dailyTarget} leads/day`);
    console.log(`  Outreach:    ${config.outreach.dailyLimit} sends/day`);
    console.log(`  Pipeline:    ${CAMPAIGN_PIPELINE_STAGES.map(s => s.key).join(" → ")}`);
    console.log(`  Transitions: ${CAMPAIGN_PIPELINE_TRANSITIONS.length} rules`);
    console.log(pc.gray("\nNo changes made. Remove --dry-run to execute."));
    return;
  }

  console.log(pc.bold("\n═══ Campaign Launch ═══"));

  // Step 1: Create pipeline with campaign stages
  console.log("\n" + pc.bold("  [1/3] Creating campaign pipeline..."));
  try {
    const stages = CAMPAIGN_PIPELINE_STAGES.map(s => ({
      key: s.key,
      name: s.name,
      description: s.description,
    }));

    const pipeline = await ctx.api.post<any>(
      `https://127.0.0.1:3100/api/companies/${ctx.companyId}/pipelines`,
      {
        key: `camp-${config.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/-+$/, "")}`,
        name: config.name,
        description: config.description || `Marketing campaign for ${config.name}`,
        stages,
        enforceTransitions: true,
      },
    );
    console.log(pc.green(`  ✓ Pipeline created: ${pipeline.key} (${pipeline.id})`));

    // Step 2: Create campaign issues for each phase
    console.log("\n" + pc.bold("  [2/3] Creating campaign tasks..."));
    const issueTemplates = buildIssueTemplates(config);
    let issuesCreated = 0;

    for (const template of issueTemplates) {
      const issue = await ctx.api.post<any>(
        `https://127.0.0.1:3100/api/companies/${ctx.companyId}/issues`,
        {
          title: template.title,
          description: template.description,
          status: "backlog",
          priority: template.priority,
          assigneeAgentId: template.assigneeAgentId,
          parentId: undefined, // Will be chained via work products
          workMode: "standard",
        },
      );
      issuesCreated++;
      console.log(
        pc.gray(`    ✓ [${template.phase}] ${template.title} (${issue.id})`),
      );
    }

    // Step 3: Set up automated follow-up routine (if not skipping)
    if (!opts.skipResearch) {
      console.log("\n" + pc.bold("  [3/3] Scheduling daily routines..."));
      console.log(pc.gray(`    Daily research target: ${config.research.dailyTarget} leads`));
      console.log(pc.gray(`    Daily outreach limit:  ${config.outreach.dailyLimit} sends`));
    }

    console.log(pc.green(`\n  Campaign "${config.name}" ready. ${issuesCreated} tasks created.`));
  } catch (err) {
    console.error(pc.red(`  ✗ Failed: ${err instanceof Error ? err.message : String(err)}`));
    throw err;
  }
}

// ── Issue Template Builder ────────────────────────────────────────────────────
// Generates structured issue templates for each campaign phase.
function buildIssueTemplates(config: CampaignConfig): Array<{
  title: string;
  description: string | null;
  assigneeAgentId: string | null;
  priority: string;
  phase: string;
}> {
  const templates: Array<{
    title: string;
    description: string | null;
    assigneeAgentId: string | null;
    priority: string;
    phase: string;
  }> = [];

  // Research phase
  templates.push({
    title: `Research leads for ${config.name}`,
    description: [
      `Find ${config.research.dailyTarget} leads matching the ICP.`,
      `Sources: ${(config.research.sources || ["linkedin", "google"]).join(", ")}`,
      `Enrichment: email=${config.research.enrichment.email}, phone=${config.research.enrichment.phone}`,
      `Quality: min domain age=${config.research.qualityThreshold.minDomainAgeDays}d`,
    ].join("\n"),
    assigneeAgentId: null, // Resolved at runtime
    priority: "high",
    phase: "research",
  });

  // Outreach phase
  templates.push({
    title: `Execute outreach for ${config.name}`,
    description: [
      `Send outreach via ${config.channels.join(", ")}.`,
      `Daily limit: ${config.outreach.dailyLimit}`,
      `Max sequences: ${config.outreach.maxSequences}`,
    ].join("\n"),
    assigneeAgentId: null,
    priority: "high",
    phase: "outreach",
  });

  // Reply handling
  templates.push({
    title: `Process inbound replies for ${config.name}`,
    description: [
      `Auto-qualify replies: ${config.replies.autoQualify}`,
      `Criteria: BA=${config.replies.qualificationCriteria.budget}, ` +
        `need=${config.replies.qualificationCriteria.need}, ` +
        `timeline=${config.replies.qualificationCriteria.timeline}, ` +
        `authority=${config.replies.qualificationCriteria.authority}`,
      config.replies.demoBooking.enabled ? `Demo booking: enabled` : "",
    ].filter(Boolean).join("\n"),
    assigneeAgentId: null,
    priority: "medium",
    phase: "reply",
  });

  // Qualification
  templates.push({
    title: `Qualify leads for ${config.name}`,
    description: `Review and qualify leads from the replied stage. Convert to qualified or return to contacted for follow-up.`,
    assigneeAgentId: null,
    priority: "medium",
    phase: "qualify",
  });

  // Conversion tracking
  templates.push({
    title: `Track conversions for ${config.name}`,
    description: `Monitor converted leads, update analytics, and generate weekly summary.`,
    assigneeAgentId: null,
    priority: "low",
    phase: "convert",
  });

  return templates;
}

// ── Generate Leads Command ────────────────────────────────────────────────────
// Dispatches research tasks to populate the campaign with leads.
async function generateLeads(opts: CampaignLeadsOptions): Promise<void> {
  const ctx = resolveCommandContext(opts, { requireCompany: true });
  const resolved = await resolveCampaign(ctx, opts.campaignKey);

  console.log(pc.bold("\n═══ Generate Leads ═══"));
  console.log(`  Campaign: ${opts.campaignKey}`);
  console.log(`  Target:   ${opts.count ?? "default"}`);

  let leads: LeadTemplate[] = [];

  // Load leads from file or generate from config
  if (opts.fieldsFile) {
    const raw = parseJson(await fs.readFile(opts.fieldsFile, "utf-8")) as unknown;
    if (Array.isArray(raw)) {
      leads = raw.map((l: any) => ({
        firstName: l.firstName ?? l.first_name ?? "",
        lastName: l.lastName ?? l.last_name ?? "",
        title: l.title ?? "",
        company: l.company ?? "",
        email: l.email,
        phone: l.phone,
        linkedin: l.linkedin,
        website: l.website,
        companySize: l.company_size,
        industry: l.industry,
        region: l.region,
        techStack: l.tech_stack ?? l.techStack,
        source: l.source ?? "imported",
        confidence: l.confidence ?? 1.0,
        icpScore: l.icp_score ?? l.icpScore ?? 0,
        notes: l.notes,
      }));
    } else if (typeof raw === "object" && raw !== null) {
      leads = [raw as LeadTemplate];
    }
    console.log(pc.gray(`  Loaded ${leads.length} leads from file.`));
  } else if (opts.fieldsJson) {
    const raw = parseJson(opts.fieldsJson);
    leads = Array.isArray(raw) ? raw : [raw];
    console.log(pc.gray(`  Parsed ${leads.length} leads from JSON.`));
  } else {
    // Generate from ICP — this would call the Lead Researcher agent
    console.log(pc.yellow("  ⚠ No lead data provided. Use --fields-file or --fields-json,"));
    console.log(pc.yellow("    or run 'paperclipai campaign research' first to auto-discover leads."));
    return;
  }

  // Create issues for each lead
  let created = 0;
  for (const lead of leads) {
    const title = `${lead.firstName} ${lead.lastName} — ${lead.title} @ ${lead.company}`;
    const fields = {
      lead_email: lead.email,
      lead_phone: lead.phone,
      lead_linkedin: lead.linkedin,
      company_size: lead.companySize,
      company_industry: lead.industry,
      icp_score: lead.icpScore,
      confidence: lead.confidence,
      source: lead.source,
      notes: lead.notes,
    };

    try {
      const issue = await ctx.api.post<any>(
        `https://127.0.0.1:3100/api/companies/${ctx.companyId}/issues`,
        {
          title,
          description: lead.notes ?? null,
          status: "backlog",
          priority: lead.icpScore >= 70 ? "high" : "medium",
          assigneeAgentId: null,
          fields,
        },
      );
      created++;
      if (ctx.json) {
        printOutput({ lead: title, issueId: issue.id }, { json: true });
      }
    } catch (err) {
      console.error(
        pc.red(`  ✗ Failed to create lead issue: ${err instanceof Error ? err.message : String(err)}`),
      );
    }

    printProgressBar(created, leads.length, "Seeding");
  }

  console.log(pc.green(`  ✓ ${created}/${leads.length} leads processed.`));
}

// ── Outreach Command ──────────────────────────────────────────────────────────
// Dispatches batch outreach messages.
async function outboundOutreach(opts: CampaignOutreachOptions): Promise<void> {
  const ctx = resolveCommandContext(opts, { requireCompany: true });
  const resolved = await resolveCampaign(ctx, opts.campaignKey);

  const channel = opts.channel as "email" | "linkedin" | "twitter" | "webhook";
  console.log(pc.bold("\n═══ Campaign Outreach ═══"));
  console.log(`  Campaign: ${opts.campaignKey}`);
  console.log(`  Channel:  ${channel}`);
  console.log(`  Sequence: ${opts.sequenceIndex ?? "0"}`);

  // Get leads to contact
  const leads = opts.leadIds
    ? opts.leadIds.split(",").filter(Boolean)
    : [];

  if (leads.length === 0) {
    console.log(pc.yellow("  No leads specified. Use --lead-ids or query by pipeline stage."));
    return;
  }

  console.log(pc.gray(`  Dispatching to ${leads.length} leads...`));

  let sent = 0;
  for (const leadId of leads) {
    if (opts.dryRun) {
      console.log(pc.gray(`    [DRY RUN] Would send ${channel} to ${leadId}`));
      sent++;
      continue;
    }

    // Create interaction record for this outreach
    try {
      const interaction = await ctx.api.post<any>(
        `https://127.0.0.1:3100/api/companies/${ctx.companyId}/interactions`,
        {
          type: channel,
          lead_id: leadId,
          campaign_id: resolved.campaignId,
          status: "sent",
          direction: "outbound",
          sequence_index: opts.sequenceIndex ? parseInt(opts.sequenceIndex) : 0,
        },
      );

      // Update lead status to "contacted"
      await ctx.api.patch<any>(
        `https://127.0.0.1:3100/api/leads/${leadId}`,
        { status: "contacted" },
      );

      sent++;
    } catch (err) {
      console.error(
        pc.red(`  ✗ Failed outreach to ${leadId}: ${err instanceof Error ? err.message : String(err)}`),
      );
    }

    printProgressBar(sent, leads.length, "Outreach");
  }

  console.log(pc.green(`  ✓ ${sent}/${leads.length} ${channel} messages sent.`));
}

// ── Handle Replies Command ────────────────────────────────────────────────────
// Processes inbound replies and qualifies leads.
async function handleReplies(opts: CampaignRepliesOptions): Promise<void> {
  const ctx = resolveCommandContext(opts, { requireCompany: true });
  const resolved = await resolveCampaign(ctx, opts.campaignKey);

  console.log(pc.bold("\n═══ Handle Replies ═══"));
  console.log(`  Campaign: ${opts.campaignKey}`);

  let replies: ReplyTemplate[] = [];

  // Load replies from file or JSON
  if (opts.fileId) {
    const raw = parseJson(await fs.readFile(opts.fileId, "utf-8")) as unknown;
    replies = Array.isArray(raw) ? raw : [raw];
  } else if (opts.replyJson) {
    const raw = parseJson(opts.replyJson);
    replies = Array.isArray(raw) ? raw : [raw];
  } else {
    console.log(pc.yellow("  No replies provided. Use --file or --reply-json."));
    return;
  }

  console.log(pc.gray(`  Processing ${replies.length} replies...`));

  let processed = 0;
  for (const reply of replies) {
    try {
      // Create child issue for reply handling
      const issue = await ctx.api.post<any>(
        `https://127.0.0.1:3100/api/companies/${ctx.companyId}/issues`,
        {
          title: `Reply from ${reply.fromName} — ${reply.subject}`,
          description: reply.body ?? null,
          status: "todo",
          priority: reply.sentiment === "positive" ? "high" : "medium",
          assigneeAgentId: reply.bookDemo ? await resolveAgentById(
            ctx.api,
            ctx.companyId!,
            "reply-handler",
          ) : null,
          fields: {
            lead_id: reply.leadId,
            campaign_id: resolved.campaignId,
            from_name: reply.fromName,
            from_email: reply.fromEmail,
            sentiment: reply.sentiment,
            qualified: reply.qualified,
            ba: reply.ba,
            need: reply.need,
            timeline: reply.timeline,
            routing: reply.routing,
            drafted_response: reply.draftedResponse,
          },
        },
      );

      // Update lead status based on qualification
      if (reply.qualified) {
        await ctx.api.patch<any>(
          `https://127.0.0.1:3100/api/leads/${reply.leadId}`,
          { status: "qualified" },
        );
      } else {
        await ctx.api.patch<any>(
          `https://127.0.0.1:3100/api/leads/${reply.leadId}`,
          { status: "replied" },
        );
      }

      processed++;
      console.log(
        pc.gray(`    ✓ ${reply.fromName} → ${reply.sentiment} → ${reply.routing}`),
      );
    } catch (err) {
      console.error(
        pc.red(`  ✗ Failed to process reply: ${err instanceof Error ? err.message : String(err)}`),
      );
    }
  }

  console.log(pc.green(`  ✓ ${processed}/${replies.length} replies processed.`));
}

// ── Follow-ups Command ────────────────────────────────────────────────────────
// Checks for unanswered leads and queues follow-up tasks.
async function followUps(opts: CampaignFollowupsOptions): Promise<void> {
  const ctx = resolveCommandContext(opts, { requireCompany: true });
  const resolved = await resolveCampaign(ctx, opts.campaignKey);

  const daysSince = opts.daysSince ? parseInt(opts.daysSince) : 3;

  console.log(pc.bold("\n═══ Follow-up Queue ═══"));
  console.log(`  Campaign: ${opts.campaignKey}`);
  console.log(`  Cutoff:   ${daysSince} days`);

  // Query the agency_shared DB for leads that haven't received a reply
  // within the specified window (contacted + no replied interaction)
  try {
    const staleLeads = await ctx.api.get<any[]>(
      `https://127.0.0.1:3100/api/companies/${ctx.companyId}/leads?status=contacted&stale_days=${daysSince}`,
    );

    if (!staleLeads || staleLeads.length === 0) {
      console.log(pc.green("  ✓ No stale leads found. All contacts are on track."));
      return;
    }

    console.log(pc.gray(`  Found ${staleLeads.length} leads needing follow-up:`));

    let queued = 0;
    for (const lead of staleLeads) {
      // Create follow-up issue
      const issue = await ctx.api.post<any>(
        `https://127.0.0.1:3100/api/companies/${ctx.companyId}/issues`,
        {
          title: `Follow-up: ${lead.email ?? lead.name} (no reply in ${daysSince}d)`,
          description: `Last contacted: ${lead.last_contacted_at ?? "unknown"}`,
          status: "todo",
          priority: "medium",
          assigneeAgentId: await resolveAgentById(
            ctx.api,
            ctx.companyId!,
            "linkedin-outreach",
          ),
          fields: {
            lead_id: lead.id,
            campaign_id: resolved.campaignId,
            follow_up_type: "sequence",
            days_since_last: daysSince,
          },
        },
      );
      queued++;
      console.log(
        pc.gray(`    ✓ Follow-up queued for ${lead.email ?? lead.name} (${issue.id})`),
      );
    }

    console.log(pc.green(`  ✓ ${queued} follow-up tasks queued.`));
  } catch (err) {
    // DB endpoint may not exist yet — fall back to pipeline status check
    console.log(pc.yellow("  ⚠ DB endpoint not available. Check pipeline status manually."));
    console.log(pc.gray(`  Campaign: ${opts.campaignKey}`));
    console.log(pc.gray(`  Stale cutoff: ${daysSince} days`));

    try {
      const pipeline = await ctx.api.get<any>(
        `https://127.0.0.1:3100/api/pipelines/${resolved.pipelineId}`,
      );
      if (pipeline && pipeline.stages) {
        const contactedStage = pipeline.stages.find((s: any) => s.key === "contacted");
        if (contactedStage) {
          console.log(
            pc.gray(`  Contacted leads: ${contactedStage.caseCount ?? "unknown"}`),
          );
        }
      }
    } catch {
      console.log(pc.gray("  Could not fetch pipeline status."));
    }
  }
}

// ── Report Command ────────────────────────────────────────────────────────────
// Pulls campaign analytics and generates a performance summary.
async function report(opts: CampaignReportOptions): Promise<void> {
  const ctx = resolveCommandContext(opts, { requireCompany: true });
  const resolved = await resolveCampaign(ctx, opts.campaignKey);

  console.log(pc.bold("\n═══ Campaign Report ═══"));
  console.log(`  Campaign: ${opts.campaignKey}`);

  try {
    // Try to get analytics from the agency_shared DB
    const analytics = await ctx.api.get<any>(
      `https://127.0.0.1:3100/api/companies/${ctx.companyId}/campaigns/${resolved.campaignId}/analytics`,
    );

    if (analytics) {
      const reportData = buildReport(analytics, opts.campaignKey);
      console.log(reportData);

      if (opts.json) {
        console.log("\n" + pc.blue("─── JSON Output ───"));
        printOutput(analytics, { json: true });
      }
      return;
    }
  } catch {
    // Analytics endpoint may not be live yet — fall back to pipeline/case data
  }

  // Fallback: build report from pipeline cases
  try {
    const cases = await ctx.api.get<any[]>(
      `https://127.0.0.1:3100/api/companies/${ctx.companyId}/pipelines/${resolved.pipelineId}/cases`,
    );

    if (!cases || cases.length === 0) {
      console.log(pc.gray("  No campaign data available yet."));
      return;
    }

    const counts: Record<string, number> = {};
    for (const c of cases) {
      const stage = c.stageKey ?? c.stage ?? "unknown";
      counts[stage] = (counts[stage] ?? 0) + 1;
    }

    console.log(pc.gray("  Pipeline Status:"));
    for (const [stage, count] of Object.entries(counts).sort()) {
      const stageLabel = CAMPAIGN_PIPELINE_STAGES.find(s => s.key === stage);
      const name = stageLabel ? stageLabel.name : stage;
      console.log(pc.gray(`    ${name.padEnd(15)} ${pc.bold(String(count))}`));
    }

    console.log(pc.gray(`\n  Total cases: ${pc.bold(String(cases.length))}`));
  } catch (err) {
    console.error(
      pc.red(`  ✗ Failed to generate report: ${err instanceof Error ? err.message : String(err)}`),
    );
  }
}

// ── Report Builder ────────────────────────────────────────────────────────────
function buildReport(analytics: any, campaignName: string): string {
  const total = analytics.totalLeads ?? 0;
  const replied = analytics.metrics?.interactionsReplied ?? 0;
  const converted = analytics.leadsByStatus?.converted ?? 0;
  const replyRate = analytics.metrics?.replyRate ?? 0;
  const convRate = analytics.metrics?.conversionRate ?? 0;

  const lines: string[] = [
    "",
    pc.bold(`  Campaign: ${campaignName}`),
    "",
    pc.gray("  ── Funnel ──"),
    `  Leads added:        ${String(total).padEnd(4)}`,
    `  Leads contacted:    ${String(analytics.leadsByStatus?.contacted ?? 0).padEnd(4)}`,
    `  Leads replied:      ${String(replied).padEnd(4)}`,
    `  Leads qualified:    ${String(analytics.leadsByStatus?.qualified ?? 0).padEnd(4)}`,
    `  Leads converted:    ${String(converted).padEnd(4)}`,
    "",
    pc.gray("  ── Rates ──"),
    `  Reply rate:         ${replyRate.toFixed(1)}%`,
    `  Qualification rate: ${((analytics.leadsByStatus?.qualified ?? 0) / Math.max(1, replied) * 100).toFixed(1)}%`,
    `  Conversion rate:    ${convRate.toFixed(1)}%`,
    "",
  ];

  return lines.join("\n");
}

// ── Status Command ────────────────────────────────────────────────────────────
// Quick overview of campaign state.
async function status(opts: CampaignStatusOptions): Promise<void> {
  const ctx = resolveCommandContext(opts, { requireCompany: true });

  try {
    // Get pipeline
    const pipeline = await ctx.api.get<any[]>(
      `https://127.0.0.1:3100/api/companies/${ctx.companyId}/pipelines`,
    );
    const camp = pipeline?.find((p: any) => p.key === opts.campaignKey);

    if (!camp) {
      console.log(pc.red(`  Campaign '${opts.campaignKey}' not found.`));
      return;
    }

    console.log(pc.bold(`  Campaign: ${camp.name}`));
    console.log(`  Key:      ${camp.key}`);
    console.log(`  Status:   ${camp.status ?? "active"}`);
    console.log(`  Created:  ${camp.createdAt ?? camp.created_at ?? "unknown"}`);

    // Stage breakdown
    if (camp.stages) {
      console.log("\n  Pipeline stages:");
      for (const stage of camp.stages) {
        const count = stage.caseCount ?? stage.count ?? 0;
        const marker = count > 0 ? pc.bold(String(count)) : String(count);
        console.log(`    ${stage.name.padEnd(15)} ${marker}`);
      }
    }
  } catch (err) {
    console.error(
      pc.red(`  ✗ Failed to fetch status: ${err instanceof Error ? err.message : String(err)}`),
    );
  }
}

// ── Command Registration ──────────────────────────────────────────────────────
export function registerCampaignCommands(program: any): void {
  const campaigns = program.command("campaign").description("Campaign automation: pipelines, leads, outreach, and analytics");

  // Launch command
  addCommonClientOptions(
    campaigns
      .command("launch")
      .description("Create a campaign pipeline and tasks from config"),
  ).requiredOption("-f, --config <path>", "Campaign config file (JSON)");

  addCommonClientOptions(
    campaigns
      .command("generate-leads")
      .description("Populate campaign with leads from file or JSON"),
  )
    .requiredOption("--campaign-key <key>", "Campaign key")
    .option("--count <n>", "Target lead count (for guided research)")
    .option("--fields-file <path>", "JSON file with lead data array")
    .option("--fields-json <json>", "Inline JSON lead data")
    .option("--skip-enrichment", "Skip enrichment step");

  addCommonClientOptions(
    campaigns
      .command("outreach")
      .description("Dispatch batch outreach messages"),
  )
    .requiredOption("--campaign-key <key>", "Campaign key")
    .requiredOption("--channel <channel>", "Outreach channel (email, linkedin, twitter, webhook)")
    .option("--lead-ids <csv>", "Comma-separated lead IDs")
    .option("--sequence-index <n>", "Sequence index (default: 0)")
    .option("--dry-run", "Preview without sending");

  addCommonClientOptions(
    campaigns
      .command("handle-replies")
      .description("Process inbound replies and qualify leads"),
  )
    .requiredOption("--campaign-key <key>", "Campaign key")
    .option("--file <path>", "JSON file with reply data")
    .option("--reply-json <json>", "Inline JSON reply data");

  addCommonClientOptions(
    campaigns
      .command("followups")
      .description("Check for unanswered leads and queue follow-ups"),
  )
    .requiredOption("--campaign-key <key>", "Campaign key")
    .option("--days-since <n>", "Days since last contact (default: 3)")
    .option("--dry-run", "Preview without queuing");

  addCommonClientOptions(
    campaigns
      .command("report")
      .description("Generate campaign performance report"),
  ).requiredOption("--campaign-key <key>", "Campaign key");

  addCommonClientOptions(
    campaigns
      .command("status")
      .description("Quick overview of campaign state"),
  ).requiredOption("--campaign-key <key>", "Campaign key");

  // ── Action Handlers ────────────────────────────────────────────────────
  campaigns
    .command("launch")
    .action(async (opts: CampaignLaunchOptions) => {
      try {
        await campaignLaunch(opts);
      } catch (err) {
        handleCommandError(err);
      }
    });

  campaigns
    .command("generate-leads")
    .action(async (opts: CampaignLeadsOptions) => {
      try {
        await generateLeads(opts);
      } catch (err) {
        handleCommandError(err);
      }
    });

  campaigns
    .command("outreach")
    .action(async (opts: CampaignOutreachOptions) => {
      try {
        await outboundOutreach(opts);
      } catch (err) {
        handleCommandError(err);
      }
    });

  campaigns
    .command("handle-replies")
    .action(async (opts: CampaignRepliesOptions) => {
      try {
        await handleReplies(opts);
      } catch (err) {
        handleCommandError(err);
      }
    });

  campaigns
    .command("followups")
    .action(async (opts: CampaignFollowupsOptions) => {
      try {
        await followUps(opts);
      } catch (err) {
        handleCommandError(err);
      }
    });

  campaigns
    .command("report")
    .action(async (opts: CampaignReportOptions) => {
      try {
        await report(opts);
      } catch (err) {
        handleCommandError(err);
      }
    });

  campaigns
    .command("status")
    .action(async (opts: CampaignStatusOptions) => {
      try {
        await status(opts);
      } catch (err) {
        handleCommandError(err);
      }
    });
}
