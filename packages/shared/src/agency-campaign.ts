import { z } from "zod";

// ── Campaign Config Schema ────────────────────────────────────────────────────
// Input format for launching a marketing campaign.
// Consumed by the `paperclipai campaign` commands to create pipelines,
// provision tasks, and manage the lead lifecycle.

// ── Campaign Definition ──────────────────────────────────────────────────────
export const campaignSchema = z.object({
  name: z.string().min(1).describe("Campaign name"),
  description: z.string().optional().describe("Campaign description"),
  startDate: z.string().datetime().optional().describe("ISO start date (defaults to now)"),
  endDate: z.string().datetime().optional().describe("ISO end date"),

  // Campaign channels
  channels: z.array(z.string())
    .min(1)
    .max(5)
    .describe("Channels: email, linkedin, twitter, cold-call, webhook"),

  // Lead research targets
  research: z.object({
    dailyTarget: z.number().int().positive().optional().default(5),
    maxDailyTasks: z.number().int().positive().optional().default(20),
    // Where to find leads
    sources: z.array(z.string()).optional().describe(
      "Data sources: linkedin, google, crunchbase, hunter, apollo"
    ),
    enrichment: z.object({
      email: z.boolean().optional().default(true),
      phone: z.boolean().optional().default(false),
      socialProfiles: z.boolean().optional().default(true),
      companyInfo: z.boolean().optional().default(true),
    }),
    // Quality filters
    qualityThreshold: z.object({
      minDomainAgeDays: z.number().int().positive().optional().default(365),
      minEmployees: z.number().int().nonnegative().optional(),
      maxEmployees: z.number().int().nonnegative().optional(),
      requiredTechStack: z.array(z.string()).optional().describe("Must-have technologies"),
    }),
  }),

  // Outreach configuration
  outreach: z.object({
    dailyLimit: z.number().int().positive().optional().default(20),
    maxSequences: z.number().int().positive().optional().default(4),
    // Sequences
    sequence: z.object({
      daysBetween: z.number().int().positive().optional().default(3),
      maxOpensBeforeReply: z.number().int().positive().optional().default(3),
      templates: z.object({
        initialEmail: z.string().min(1).describe("First cold email template"),
        followUp: z.array(z.string()).min(1).max(5).describe("Follow-up email templates"),
        linkedinNote: z.string().min(1).describe("LinkedIn connection note"),
        linkedinInMail: z.string().min(1).describe("LinkedIn InMail template"),
        voicemail: z.string().min(1).optional().describe("Voicemail script"),
      }),
    }),
  }),

  // Reply handling
  replies: z.object({
    autoQualify: z.boolean().optional().default(true),
    qualificationCriteria: z.object({
      budget: z.boolean().optional().default(true),
      timeline: z.boolean().optional().default(true),
      authority: z.boolean().optional().default(true),
      need: z.boolean().optional().default(true),
    }),
    demoBooking: z.object({
      enabled: z.boolean().optional().default(true),
      calendarLink: z.string().url().optional(),
      slotBufferMin: z.number().int().positive().optional().default(15),
    }),
  }),

  // Reporting
  reporting: z.object({
    daily: z.boolean().optional().default(true),
    summaryTemplate: z.object({
      includeMetrics: z.array(z.string()).optional().default([
        "leads_added",
        "leads_contacted",
        "leads_replied",
        "leads_qualified",
        "reply_rate",
        "conversion_rate",
      ]),
    }),
  }),
});

export type CampaignConfig = z.infer<typeof campaignSchema>;

// ── Lead Pipeline Stages ──────────────────────────────────────────────────────
// The canonical stage flow for any marketing campaign.
export const CAMPAIGN_PIPELINE_STAGES = [
  {
    key: "prospect",
    name: "Prospect",
    description: "Raw lead from research — not yet verified",
  },
  {
    key: "verified",
    name: "Verified",
    description: "Contact info confirmed, ready for outreach",
  },
  {
    key: "contacted",
    name: "Contacted",
    description: "First outreach sent",
  },
  {
    key: "replied",
    name: "Replied",
    description: "Lead responded — inbound interest",
  },
  {
    key: "qualified",
    name: "Qualified",
    description: "BAU/NBA confirmed — sales-qualified",
  },
  {
    key: "converted",
    name: "Converted",
    description: "Deal closed / demo completed",
  },
  {
    key: "unsubscribed",
    name: "Unsubscribed",
    description: "Opted out — no further contact",
  },
  {
    key: "blacklisted",
    name: "Blacklisted",
    description: "Invalid / do-not-contact — exclude permanently",
  },
] as const;

export const CAMPAIGN_PIPELINE_TRANSITIONS = [
  // prospect -> verified
  { from: "prospect", to: "verified" },
  // verified -> contacted
  { from: "verified", to: "contacted" },
  // contacted -> replied
  { from: "contacted", to: "replied" },
  // contacted -> unsubscribed (opt-out)
  { from: "contacted", to: "unsubscribed" },
  // contacted -> blacklisted (invalid)
  { from: "contacted", to: "blacklisted" },
  // replied -> qualified
  { from: "replied", to: "qualified" },
  // replied -> contacted (follow-up sequence)
  { from: "replied", to: "contacted" },
  // qualified -> converted
  { from: "qualified", to: "converted" },
  // verified -> contacted (after research)
  { from: "verified", to: "contacted" },
  // prospect -> blacklisted (bad data)
  { from: "prospect", to: "blacklisted" },
];

// ── Campaign Issue Templates ─────────────────────────────────────────────────
// Structured task templates for each campaign phase.
export const campaignIssueTemplateSchema = z.object({
  title: z.string().min(1),
  description: z.string().optional().nullable(),
  // Agent assignment — references agent slug or ID
  assigneeAgentId: z.string().uuid().optional().nullable(),
  assigneeAgentSlug: z.string().optional().nullable(),
  priority: z.enum(["critical", "high", "medium", "low"]).default("medium"),
  // Phase this task belongs to
  phase: z.enum(["research", "outreach", "followup", "reply", "qualify", "convert"]),
  // Fields to seed on lead/interaction records
  leadFields: z.record(z.unknown()).optional().nullable(),
  // Output format expectations
  outputFormat: z.enum(["markdown", "json", "text"]).optional().default("markdown"),
});

export type CampaignIssueTemplate = z.infer<typeof campaignIssueTemplateSchema>;

// ── Lead Enrichment Template ──────────────────────────────────────────────────
// Structured data from the Lead Researcher for each prospect.
export const leadTemplateSchema = z.object({
  firstName: z.string().min(1),
  lastName: z.string().min(1),
  title: z.string().min(1),
  company: z.string().min(1),
  email: z.string().email().optional(),
  phone: z.string().optional(),
  linkedin: z.string().url().optional(),
  website: z.string().url().optional(),
  companySize: z.string().optional(),
  industry: z.string().optional(),
  region: z.string().optional(),
  techStack: z.array(z.string()).optional(),
  // Enrichment sources used
  source: z.string().optional(),
  confidence: z.number().min(0).max(1).optional().default(1.0),
  // ICP match scoring
  icpScore: z.number().min(0).max(100).optional().default(0),
  // Notes for the outreach agent
  notes: z.string().optional(),
});

export type LeadTemplate = z.infer<typeof leadTemplateSchema>;

// ── Outreach Batch Template ───────────────────────────────────────────────────
// Structured data for bulk outreach dispatch.
export const outreachBatchSchema = z.object({
  campaignId: z.string().uuid(),
  leadIds: z.array(z.string().uuid()).min(1),
  channel: z.enum(["email", "linkedin", "twitter", "webhook"]),
  templateId: z.string().uuid(),
  sequenceIndex: z.number().int().nonnegative().optional().default(0),
  sendAt: z.string().datetime().optional(),
  personalization: z.record(z.string()).optional().describe("Template variable overrides per lead"),
});

export type OutreachBatch = z.infer<typeof outreachBatchSchema>;

// ── Reply Processing Template ─────────────────────────────────────────────────
// Structured data from Reply Handler for each inbound message.
export const replyTemplateSchema = z.object({
  leadId: z.string().uuid(),
  fromName: z.string(),
  fromEmail: z.string(),
  subject: z.string(),
  body: z.string(),
  // Qualification results
  qualified: z.boolean(),
  ba: z.boolean().optional().describe("Budget authority confirmed"),
  need: z.boolean().optional().describe("Clear need identified"),
  timeline: z.string().optional().describe("Decision timeline"),
  sentiment: z.enum(["positive", "neutral", "negative", "unknown"]).default("neutral"),
  // Next steps
  bookDemo: z.boolean().optional().default(false),
  demoNotes: z.string().optional(),
  routing: z.enum(["sales", "support", "newsletter", "spam"]).default("sales"),
  // Response drafted (for agent to send)
  draftedResponse: z.string().optional(),
});

export type ReplyTemplate = z.infer<typeof replyTemplateSchema>;

// ── Campaign Analytics ────────────────────────────────────────────────────────
// Output schema for campaign report generation.
export const campaignAnalyticsSchema = z.object({
  campaignId: z.string().uuid(),
  campaignName: z.string(),
  totalLeads: z.number().int().nonnegative(),
  leadsByStatus: z.object({
    prospect: z.number(),
    verified: z.number(),
    contacted: z.number(),
    replied: z.number(),
    qualified: z.number(),
    converted: z.number(),
    unsubscribed: z.number(),
    blacklisted: z.number(),
  }),
  metrics: z.object({
    replyRate: z.number().min(0).max(100).nullable(),
    qualificationRate: z.number().min(0).max(100).nullable(),
    conversionRate: z.number().min(0).max(100).nullable(),
    totalInteractions: z.number().int().nonnegative(),
    interactionsDelivered: z.number().int().nonnegative(),
    interactionsOpened: z.number().int().nonnegative(),
    interactionsClicked: z.number().int().nonnegative(),
  }),
  generatedAt: z.string().datetime(),
});

export type CampaignAnalytics = z.infer<typeof campaignAnalyticsSchema>;

// ── Campaign Launch Result ────────────────────────────────────────────────────
// Output from the `paperclipai campaign launch` command.
export const campaignLaunchResultSchema = z.object({
  success: z.boolean(),
  campaignId: z.string().uuid().optional(),
  pipelineId: z.string().uuid().optional(),
  pipelineKey: z.string().optional(),
  agentIds: z.record(z.string().uuid()).optional().describe("agent slug -> ID mapping"),
  issuesCreated: z.number().int().nonnegative().optional().default(0),
  errors: z.array(z.string()).optional().default([]),
  warnings: z.array(z.string()).optional().default([]),
});

export type CampaignLaunchResult = z.infer<typeof campaignLaunchResultSchema>;
