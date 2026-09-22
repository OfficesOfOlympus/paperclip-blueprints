import { z } from "zod";
import * as p from "@clack/prompts";
import pc from "picocolors";
import fs from "node:fs/promises";
import path from "node:path";
import { execSync } from "node:child_process";
import { resolveCommandContext, addCommonClientOptions, handleCommandError, printOutput, type BaseClientOptions } from "./client/common.js";

// ── Bootstrap Config Schema ──────────────────────────────────────────────────
// Input format for launching a new agency instance.

export const bootstrapAgencySchema = z.object({
  agency: z.object({
    name: z.string().min(1),
    description: z.string().optional(),
    industry: z.string().min(1),
    issuePrefix: z.string().max(10),
    budgetMonthlyCents: z.number().int().nonnegative().optional().default(0),
  }),
  product: z.object({
    name: z.string().min(1),
    description: z.string().min(1),
    websiteUrl: z.string().url().optional(),
    assetPaths: z.array(z.string()).optional(),
    pricing: z.object({
      tier: z.string().optional(),
      pricePoint: z.string().optional(),
    }).optional(),
  }),
  market: z.object({
    industry: z.string().min(1),
    size: z.enum(["startup", "smb", "mid-market", "enterprise"]).optional(),
    regions: z.array(z.string()).optional(),
    competition: z.array(z.string()).optional(),
    channels: z.array(z.string()).min(1),
  }),
  icp: z.object({
    title: z.string().min(1),
    industry: z.string().optional(),
    companySize: z.string().optional(),
    painPoints: z.array(z.string()).min(1),
    goals: z.array(z.string()).min(1),
    objections: z.array(z.string()).optional(),
    budgetAuthority: z.boolean().optional().default(false),
  }),
  campaign: z.object({
    durationDays: z.number().int().positive().optional().default(30),
    dailyLeadTarget: z.number().int().positive().optional().default(5),
    tone: z.object({
      professional: z.number().min(0).max(1).optional().default(0.7),
      casual: z.number().min(0).max(1).optional().default(0.3),
      urgency: z.number().min(0).max(1).optional().default(0.5),
      empathy: z.number().min(0).max(1).optional().default(0.6),
    }),
    languages: z.array(z.string()).optional().default(["en"]),
    maxDailyTasks: z.number().int().positive().optional().default(50),
  }),
  agents: z.array(z.string()).optional(),
});

export type BootstrapConfig = z.infer<typeof bootstrapAgencySchema>;

// ── Default Agent Slots ──────────────────────────────────────────────────────
export const DEFAULT_AGENT_SLOTS = [
  "lead-researcher",
  "content-writer",
  "linkedin-outreach",
  "reply-handler",
  "marketing-manager",
  "data-analyst",
] as const;

export type AgentSlot = (typeof DEFAULT_AGENT_SLOTS)[number];

// ── Agent Role Definitions ───────────────────────────────────────────────────
const AGENT_DEFINITIONS: Record<AgentSlot, { name: string; role: string; adapterType: string; brief: string }> = {
  "lead-researcher": {
    name: "Lead Researcher",
    role: "researcher",
    adapterType: "codex_local",
    brief: `## ROLE
You are the Lead Researcher for [COMPANY_NAME], a [INDUSTRY] marketing agency. Your job is to find, qualify, and enrich target leads for our sales pipeline.

## SOUL
You are methodical and thorough. You don't just find contacts — you understand the companies and decision-makers behind them. You verify information, cross-reference data, and always provide context that makes outreach possible.

## HEARTBEAT
1. **Receive task** — Read the issue for research scope (industry, region, company size, decision-maker title)
2. **Search** — Use web_search and web_extract to find target companies and contacts
3. **Enrich** — Gather company details: size, industry, recent news, tech stack, funding
4. **Qualify** — Score leads based on ICP fit, budget authority, and engagement signals
5. **Output** — Post your research as a structured comment with all findings

## COMPLETION
When you have finished your research:
1. Post a structured comment with company name, contact name, title, email (if found), company details, lead score, and relevant context
2. STOP after posting — do not wait for approval
3. The task is complete once your output is posted`,
  },
  "content-writer": {
    name: "Content Writer",
    role: "writer",
    adapterType: "codex_local",
    brief: `## ROLE
You are the Content Writer for [COMPANY_NAME], a [INDUSTRY] marketing agency. You create all written content — blog articles, cold email copy, follow-up sequences, case studies, and SEO content.

## SOUL
You are a skilled B2B writer. Every piece of content has a job: to inform, persuade, or convert. You research deeply before writing and never produce generic fluff. You adapt your tone to the audience: technical for engineering leads, business-focused for founders, data-driven for CFOs.

## HEARTBEAT
1. **Receive task** — Read the issue for content type, audience, length, and tone
2. **Research** — Research topics, competitors, target audience, relevant data
3. **Draft** — Write content according to specifications (type, audience, length, CTA)
4. **Self-review** — Review for clarity, accuracy, and persuasiveness
5. **Output** — Post your complete draft as a single comment on this issue

## COMPLETION
When you have finished writing:
1. Post your complete draft as a single comment on this issue
2. Include relevant metadata (word count, target keyword, CTA used)
3. STOP after posting — do not wait for approval or handoff
4. The task is complete once your output is posted`,
  },
  "linkedin-outreach": {
    name: "LinkedIn Outreach Specialist",
    role: "outreach",
    adapterType: "codex_local",
    brief: `## ROLE
You are the LinkedIn Outreach Specialist for [COMPANY_NAME], a [INDUSTRY] marketing agency. Your job is to craft and personalize LinkedIn connection requests, InMails, and follow-up messages for our target prospects.

## SOUL
You understand LinkedIn is about relationships, not broadcasts. Every message is personalized, relevant, and respectful of the recipient's time. You reference the prospect's work, company news, or shared connections to make each message feel like it was written just for them.

## HEARTBEAT
1. **Receive task** — Read the issue for target prospects and campaign goals
2. **Research** — Research each prospect's background, company, and recent activity
3. **Draft** — Write personalized connection notes (under 200 chars) and InMail sequences
4. **Variations** — Create A/B test versions with different angles
5. **Output** — Post your messages as a structured comment

## COMPLETION
When you have finished:
1. Post all messages with clear labels (connection note, InMail 1, InMail 2, follow-up)
2. Include the prospect name and reason for personalization for each message
3. STOP after posting — do not wait for approval
4. The task is complete once your output is posted`,
  },
  "reply-handler": {
    name: "Reply Handler",
    role: "support",
    adapterType: "codex_local",
    brief: `## ROLE
You are the Reply Handler for [COMPANY_NAME], a [INDUSTRY] marketing agency. Your job is to respond to inbound leads and replies from outreach campaigns — qualifying interest, booking demos, and routing conversations appropriately.

## SOUL
You are quick, helpful, and conversational. You never sound like a template. You ask the right questions to qualify leads without being pushy, and you always move the conversation toward the next step. You maintain the brand's tone — professional yet approachable.

## HEARTBEAT
1. **Receive task** — Read the issue containing the inbound lead message or reply
2. **Analyze** — Identify intent (interested, not now, needs more info, wrong timing)
3. **Draft** — Write a personalized reply that acknowledges their message and moves toward the next step
4. **Output** — Post your reply draft as a comment

## COMPLETION
When you have finished:
1. Post the reply draft with a brief analysis of the lead's intent and recommended next step
2. STOP after posting — do not wait for approval
3. The task is complete once your output is posted`,
  },
  "marketing-manager": {
    name: "Marketing Manager",
    role: "manager",
    adapterType: "codex_local",
    brief: `## ROLE
You are the Marketing Manager for [COMPANY_NAME], a [INDUSTRY] marketing agency. You oversee campaign strategy, content planning, SEO, and performance analysis. You make decisions about what to create, where to focus effort, and what's working.

## SOUL
You are strategic and data-informed. You don't just execute — you evaluate what's working, adjust course, and prioritize based on impact. You balance short-term wins with long-term brand building. You communicate clearly with the team and make decisive recommendations.

## HEARTBEAT
1. **Receive task** — Read the issue for the specific marketing question or decision needed
2. **Analyze** — Review current campaign performance, content gaps, and market trends
3. **Recommend** — Provide clear recommendations with reasoning
4. **Output** — Post your analysis and recommendations as a comment

## COMPLETION
When you have finished:
1. Post your analysis with specific, actionable recommendations
2. Include relevant metrics or benchmarks where applicable
3. STOP after posting — do not wait for approval
4. The task is complete once your output is posted`,
  },
  "data-analyst": {
    name: "Data Analyst",
    role: "analyst",
    adapterType: "codex_local",
    brief: `## ROLE
You are the Data Analyst for [COMPANY_NAME], a [INDUSTRY] marketing agency. You track campaign performance, lead pipeline metrics, and ROI. You turn raw data into actionable insights that the team uses to make better decisions.

## SOUL
You are precise and curious. You don't just report numbers — you tell the story behind them. You find patterns, identify anomalies, and connect data to business outcomes. You present findings clearly so anyone on the team can act on them.

## HEARTBEAT
1. **Receive task** — Read the issue for the specific analysis requested
2. **Query** — Pull relevant data from shared databases and tracking systems
3. **Analyze** — Calculate metrics, identify trends, and spot opportunities
4. **Visualize** — Create simple charts or tables to illustrate findings
5. **Output** — Post your analysis with clear conclusions and recommendations

## COMPLETION
When you have finished:
1. Post your analysis with key metrics, trends, and specific recommendations
2. Include raw data tables or visualizations where helpful
3. STOP after posting — do not wait for approval
4. The task is complete once your output is posted`,
  },
};

// ── Brief Generator ──────────────────────────────────────────────────────────
function generateAgentBrief(config: BootstrapConfig, slot: AgentSlot): string {
  const def = AGENT_DEFINITIONS[slot];
  if (!def) throw new Error(`Unknown agent slot: ${slot}`);

  return def.brief
    .replace(/\[COMPANY_NAME\]/g, config.agency.name)
    .replace(/\[INDUSTRY\]/g, config.agency.industry);
}

// ── Bootstrap Command ────────────────────────────────────────────────────────
export function bootstrapCommand(program: ReturnType<typeof import("commander").Command>): void {
  const bootstrap = program.command("bootstrap").description("Launch a new agency from a configuration file");

  addCommonClientOptions(
    bootstrap
      .command("launch")
      .description("Create a company, provision agents, write briefs, and start the agency")
      .requiredOption("-f, --config <path>", "Path to bootstrap config JSON file")
      .option("-C, --company-id <id>", "Company ID (for existing company — skips company creation)")
      .option("--skip-agents", "Skip agent provisioning (company only)")
      .option("--dry-run", "Validate config and show what would happen without making changes")
      .option("--json", "Output machine-readable JSON")
      .action(async (opts: {
        config: string;
        companyId?: string;
        skipAgents?: boolean;
        dryRun?: boolean;
        json?: boolean;
      }) => {
        try {
          // 1. Read and validate config
          const configRaw = await fs.readFile(opts.config, "utf8");
          let config: BootstrapConfig;
          try {
            config = bootstrapAgencySchema.parse(JSON.parse(configRaw));
          } catch (err) {
            const zodErr = err as z.ZodError;
            throw new Error(`Invalid bootstrap config: ${zodErr.errors.map(e => `${e.path.join('.')}: ${e.message}`).join(', ')}`);
          }

          if (opts.dryRun) {
            const agents = opts.skipAgents ? [] : (config.agents || [...DEFAULT_AGENT_SLOTS]);
            printOutput({
              dryRun: true,
              config: {
                agency: config.agency.name,
                industry: config.agency.industry,
                product: config.product.name,
                icp: config.icp.title,
                channels: config.market.channels,
                agents: agents,
              },
            }, { json: opts.json });
            return;
          }

          // 2. Resolve context
          const ctx = resolveCommandContext(opts, { requireCompany: false });
          const api = ctx.api;

          let companyId: string;
          let companyName: string;

          if (opts.companyId) {
            // Use existing company
            const company = await api.get<any>(`/api/companies/${opts.companyId}`);
            if (!company) throw new Error(`Company ${opts.companyId} not found`);
            companyId = opts.companyId;
            companyName = company.name;
          } else {
            // 3. Create company
            const companyPayload = {
              name: config.agency.name,
              description: config.agency.description || `${config.agency.name} — ${config.agency.industry} marketing agency`,
              budgetMonthlyCents: config.agency.budgetMonthlyCents,
            };
            const created = await api.post("/api/companies", companyPayload);
            companyId = created.id;
            companyName = created.name;
            console.log(`${pc.green("✓")} Company created: ${companyName} (${companyId})`);
          }

          // 4. Provision agents
          const agentsCreated = [];
          const briefsWritten: string[] = [];

          if (!opts.skipAgents) {
            const slots = config.agents || [...DEFAULT_AGENT_SLOTS];
            const total = slots.length;

            for (let i = 0; i < slots.length; i++) {
              const slot = slots[i] as AgentSlot;
              const def = AGENT_DEFINITIONS[slot];
              if (!def) {
                console.warn(`${pc.yellow("⚠")} Unknown agent slot: ${slot} — skipping`);
                continue;
              }

              console.log(`[${pc.cyan(`${i + 1}/${total}`)}] Provisioning ${def.name}...`);

              // Create agent via API
              const agentPayload = {
                name: def.name,
                role: def.role,
                title: `${def.name}`,
                adapterType: def.adapterType,
                adapterConfig: {},
                instructionsBundle: {
                  mode: "file" as const,
                  files: [
                    {
                      path: "AGENTS.md",
                      content: generateAgentBrief(config, slot),
                    },
                  ],
                },
              };

              try {
                const agent = await api.post<any>(`/api/companies/${companyId}/agents`, agentPayload);
                console.log(`${pc.green("✓")} Agent created: ${def.name} (${agent.id})`);
                agentsCreated.push({
                  slug: slot,
                  name: def.name,
                  agentId: agent.id,
                });
                briefsWritten.push(`AGENTS.md for ${def.name}`);
              } catch (err) {
                const msg = err instanceof Error ? err.message : String(err);
                console.error(`${pc.red("✗")} Failed to create ${def.name}: ${msg}`);
                // Continue to next agent — don't fail the whole bootstrap
              }
            }
          }

          // 5. Output result
          printOutput({
            ok: true,
            companyId,
            companyName,
            agentsCreated,
            briefsWritten,
          }, { json: opts.json });

        } catch (err) {
          handleCommandError(err);
        }
      }),
  );

  // ── Bootstrap Config Command ───────────────────────────────────────────────
  addCommonClientOptions(
    bootstrap
      .command("config:init")
      .description("Generate a bootstrap config template from a company profile")
      .requiredOption("-f, --output <path>", "Output config file path")
      .option("-j, --json", "Output machine-readable JSON")
      .action(async (opts: {
        output: string;
        json?: boolean;
      }) => {
        try {
          const template = {
            agency: {
              name: "Acme Corp",
              description: "B2B SaaS marketing agency helping fintech companies grow",
              industry: "fintech",
              issuePrefix: "FINT",
              budgetMonthlyCents: 500000, // $5,000/mo
            },
            product: {
              name: "GrowthEngine",
              description: "Automated lead generation and nurturing platform for B2B SaaS",
              websiteUrl: "https://example.com",
              assetPaths: ["./docs/product.md", "./docs/brand-guide.md"],
              pricing: {
                tier: "SMB",
                pricePoint: "$499/mo",
              },
            },
            market: {
              industry: "fintech",
              size: "smb",
              regions: ["US", "EU"],
              competition: ["Outreach.io", "Apollo.io", "Leadfeeder"],
              channels: ["email", "linkedin"],
            },
            icp: {
              title: "Head of Growth",
              industry: "fintech",
              companySize: "10-50",
              painPoints: [
                "Inconsistent lead flow",
                "Long sales cycles",
                "Content production bottlenecks",
              ],
              goals: [
                "Fill pipeline with qualified leads",
                "Reduce CAC by 30%",
                "Scale content output 3x",
              ],
              objections: [
                "Already using an agency",
                "Budget constraints",
                "Skepticism about AI quality",
              ],
              budgetAuthority: true,
            },
            campaign: {
              durationDays: 30,
              dailyLeadTarget: 10,
              tone: {
                professional: 0.7,
                casual: 0.3,
                urgency: 0.5,
                empathy: 0.6,
              },
              languages: ["en"],
              maxDailyTasks: 50,
            },
          };

          await fs.writeFile(opts.output, JSON.stringify(template, null, 2));
          console.log(`${pc.green("✓")} Bootstrap config template written to ${opts.output}`);

          if (opts.json) {
            printOutput({ template, outputPath: opts.output }, { json: true });
          }
        } catch (err) {
          handleCommandError(err);
        }
      }),
  );
}
