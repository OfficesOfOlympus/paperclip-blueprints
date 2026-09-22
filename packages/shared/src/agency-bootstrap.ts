import { z } from "zod";

// ── Bootstrap Config Schema ──────────────────────────────────────────────────
// Input format for launching a new agency instance.
// Consumed by the `paperclipai bootstrap` command to create a company,
// seed agents, generate briefs, and start the agency.

export const bootstrapAgencySchema = z.object({
  // ── Agency ─────────────────────────────────────────────────────────────
  agency: z.object({
    name: z.string().min(1).describe("Company/legal name"),
    description: z.string().optional().describe("1-2 sentence company description"),
    industry: z.string().min(1).describe("Target industry (e.g. 'fintech', 'healthcare', 'edtech')"),
    issuePrefix: z.string().max(10).describe("Short prefix for issue identifiers (e.g. 'FINT')"),
    logoAssetId: z.string().uuid().optional().nullable(),
    budgetMonthlyCents: z.number().int().nonnegative().optional().default(0),
  }),

  // ── Product ────────────────────────────────────────────────────────────
  product: z.object({
    name: z.string().min(1),
    description: z.string().min(1).describe("What the company sells"),
    websiteUrl: z.string().url().optional(),
    // File paths or URLs to product documentation/marketing assets
    assetPaths: z.array(z.string()).optional().describe("Paths to product docs, brand guides, etc."),
    pricing: z.object({
      tier: z.string().optional().describe("Primary pricing tier (e.g. 'SMB', 'Enterprise')"),
      pricePoint: z.string().optional().describe("Price anchor (e.g. '$499/mo', 'Custom')"),
    }).optional(),
  }),

  // ── Target Market ──────────────────────────────────────────────────────
  market: z.object({
    industry: z.string().min(1).describe("Primary target industry"),
    size: z.enum(["startup", "smb", "mid-market", "enterprise"]).optional(),
    regions: z.array(z.string()).optional().describe("Geographic regions (e.g. ['US', 'EU'])"),
    competition: z.array(z.string()).optional().describe("Key competitors or alternatives"),
    channels: z.array(z.string())
      .min(1)
      .describe("Preferred outreach channels (e.g. ['email', 'linkedin', 'twitter'])"),
  }),

  // ── Ideal Customer Profile ─────────────────────────────────────────────
  icp: z.object({
    title: z.string().min(1).describe("Job title (e.g. 'Head of Growth', 'CMO')"),
    industry: z.string().optional(),
    companySize: z.string().optional().describe("Team size (e.g. '10-50', '500+')"),
    painPoints: z.array(z.string())
      .min(1)
      .describe("Key problems they face (e.g. ['lead gen', 'content bottlenecks'])"),
    goals: z.array(z.string())
      .min(1)
      .describe("What they're trying to achieve"),
    objections: z.array(z.string()).optional().describe("Common objections to overcome"),
    budgetAuthority: z.boolean().optional().default(false).describe("Does ICP hold budget?"),
  }),

  // ── Campaign Defaults ──────────────────────────────────────────────────
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

  // ── Agents ─────────────────────────────────────────────────────────────
  // Which agents to provision on launch. Defaults to full set if omitted.
  agents: z.array(z.string()).optional().describe(
    "Agent slugs to provision. Omit for full default set: ['lead-researcher', 'content-writer', 'linkedin-outreach', 'reply-handler', 'marketing-manager', 'data-analyst']"
  ),
});

export type BootstrapConfig = z.infer<typeof bootstrapAgencySchema>;

// ── Default Agent Roster ────────────────────────────────────────────────────
// Agents that come with every agency launch.
export const DEFAULT_AGENT_SLOTS = [
  "lead-researcher",
  "content-writer",
  "linkedin-outreach",
  "reply-handler",
  "marketing-manager",
  "data-analyst",
] as const;

export type AgentSlot = (typeof DEFAULT_AGENT_SLOTS)[number];

// ── Brief Generator Output ──────────────────────────────────────────────────
// The structured brief that each agent receives at launch.
export const agencyBriefSchema = z.object({
  company: z.object({
    name: z.string(),
    description: z.string(),
    industry: z.string(),
    issuePrefix: z.string(),
  }),
  product: z.object({
    name: z.string(),
    description: z.string(),
    websiteUrl: z.string().url().optional(),
    assetPaths: z.array(z.string()).optional(),
    pricing: z.object({
      tier: z.string().optional(),
      pricePoint: z.string().optional(),
    }).optional(),
  }),
  market: z.object({
    industry: z.string(),
    size: z.string().optional(),
    regions: z.array(z.string()).optional(),
    competition: z.array(z.string()).optional(),
    channels: z.array(z.string()),
  }),
  icp: z.object({
    title: z.string(),
    industry: z.string().optional(),
    companySize: z.string().optional(),
    painPoints: z.array(z.string()),
    goals: z.array(z.string()),
    objections: z.array(z.string()).optional(),
    budgetAuthority: z.boolean(),
  }),
  campaign: z.object({
    durationDays: z.number(),
    dailyLeadTarget: z.number(),
    tone: z.object({
      professional: z.number(),
      casual: z.number(),
      urgency: z.number(),
      empathy: z.number(),
    }),
    languages: z.array(z.string()),
    maxDailyTasks: z.number(),
  }),
  // Per-agent instructions generated from the config + agent slot
  agentBrief: z.string().describe("Human-readable instructions tailored to this agent's role"),
});

export type AgencyBrief = z.infer<typeof agencyBriefSchema>;

// ── Launch Result ────────────────────────────────────────────────────────────
export const launchResultSchema = z.object({
  ok: z.boolean(),
  companyId: z.string().optional(),
  companyName: z.string().optional(),
  agentsCreated: z.array(z.object({
    slug: z.string(),
    agentId: z.string(),
    briefPath: z.string(),
  })),
  briefsWritten: z.array(z.string()),
  warnings: z.array(z.string()).optional(),
});

export type LaunchResult = z.infer<typeof launchResultSchema>;
