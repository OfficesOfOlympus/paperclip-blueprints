-- =====================================================
-- 0284: Shared Agency Database Foundation
--
-- Adds a shared company database layer for the
-- marketing agency blueprint. All agency agents
-- read from/write to a single source of truth:
--   - agency_brief    : product, ICP, market, tone
--   - campaigns       : active/past campaigns
--   - leads           : single target list
--   - interactions    : every outbound touch
--   - assets          : reusable templates/content
--   - analytics       : daily performance metrics
-- =====================================================

-- ---- agency_brief: single source of truth for all agents ----
CREATE TABLE IF NOT EXISTS "agency_brief" (
    "company_id" uuid PRIMARY KEY NOT NULL REFERENCES "companies"("id") ON DELETE CASCADE,
    "company_name" text NOT NULL,
    "product_desc" text,
    "target_market" text,
    "ideal_customer_profile" jsonb,
    "competitive_landscape" text,
    "tone_of_voice" text,
    "pricing_model" text,
    "key_differentiators" jsonb,
    "product_files" jsonb,
    "status" text DEFAULT 'draft' NOT NULL,
    "created_at" timestamp with time zone DEFAULT now() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS "idx_agency_brief_status" ON "agency_brief"("status");

-- ---- campaigns: run tracking with goals ----
CREATE TABLE IF NOT EXISTS "campaigns" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
    "company_id" uuid NOT NULL REFERENCES "companies"("id") ON DELETE CASCADE,
    "name" text NOT NULL,
    "status" text DEFAULT 'planning' NOT NULL CHECK ("status" IN ('planning','active','paused','completed','archived')),
    "industry" text,
    "target_icp" jsonb,
    "budget" numeric(12,2),
    "start_date" date,
    "end_date" date,
    "goals" jsonb,
    "lead_source_count" integer DEFAULT 0 NOT NULL,
    "created_at" timestamp with time zone DEFAULT now() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS "idx_campaigns_company" ON "campaigns"("company_id");
CREATE INDEX IF NOT EXISTS "idx_campaigns_status" ON "campaigns"("status");

-- ---- leads: single source of truth for targets ----
CREATE TABLE IF NOT EXISTS "leads" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
    "company_id" uuid NOT NULL REFERENCES "companies"("id") ON DELETE CASCADE,
    "campaign_id" uuid REFERENCES "campaigns"("id") ON DELETE SET NULL,
    "company_name" text NOT NULL,
    "contact_name" text,
    "contact_title" text,
    "email" text,
    "phone" text,
    "linkedin_url" text,
    "industry" text,
    "company_size" text,
    "lead_score" integer DEFAULT 0 NOT NULL CHECK ("lead_score" BETWEEN 0 AND 100),
    "status" text DEFAULT 'new' NOT NULL CHECK ("status" IN ('new','contacted','replied','qualified','converted','unqualified','unsubscribed')),
    "source" text,
    "notes" text,
    "created_at" timestamp with time zone DEFAULT now() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
    "last_contacted_at" timestamp with time zone,
    "next_follow_up" timestamp with time zone
);

CREATE INDEX IF NOT EXISTS "idx_leads_company" ON "leads"("company_id");
CREATE INDEX IF NOT EXISTS "idx_leads_campaign" ON "leads"("campaign_id");
CREATE INDEX IF NOT EXISTS "idx_leads_status" ON "leads"("status");
CREATE INDEX IF NOT EXISTS "idx_leads_source" ON "leads"("source");
CREATE INDEX IF NOT EXISTS "idx_leads_email" ON "leads"("email");
CREATE INDEX IF NOT EXISTS "idx_leads_score" ON "leads"("lead_score" DESC);
CREATE UNIQUE INDEX IF NOT EXISTS "idx_leads_company_email" ON "leads"("company_id", "email") WHERE "email" IS NOT NULL;

-- ---- interactions: every outbound touch ----
CREATE TABLE IF NOT EXISTS "interactions" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
    "company_id" uuid NOT NULL REFERENCES "companies"("id") ON DELETE CASCADE,
    "lead_id" uuid NOT NULL REFERENCES "leads"("id") ON DELETE CASCADE,
    "campaign_id" uuid REFERENCES "campaigns"("id") ON DELETE SET NULL,
    "channel" text NOT NULL CHECK ("channel" IN ('email','linkedin','twitter','phone','other')),
    "type" text NOT NULL CHECK ("type" IN ('outbound','inbound','follow_up','meeting')),
    "content" jsonb,
    "content_text" text,
    "sent_at" timestamp with time zone DEFAULT now() NOT NULL,
    "delivered" boolean DEFAULT false NOT NULL,
    "opened" boolean DEFAULT false NOT NULL,
    "clicked" boolean DEFAULT false NOT NULL,
    "replied" boolean DEFAULT false NOT NULL,
    "reply_body" text,
    "reply_at" timestamp with time zone,
    "status" text DEFAULT 'sent' NOT NULL CHECK ("status" IN ('queued','sent','delivered','failed','bounced')),
    "created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS "idx_interactions_lead" ON "interactions"("lead_id");
CREATE INDEX IF NOT EXISTS "idx_interactions_campaign" ON "interactions"("campaign_id");
CREATE INDEX IF NOT EXISTS "idx_interactions_channel" ON "interactions"("channel");
CREATE INDEX IF NOT EXISTS "idx_interactions_company_time" ON "interactions"("company_id", "sent_at" DESC);
CREATE INDEX IF NOT EXISTS "idx_interactions_replied" ON "interactions"("lead_id") WHERE "replied" = true;

-- ---- assets: reusable templates & content ----
CREATE TABLE IF NOT EXISTS "agency_assets" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
    "company_id" uuid NOT NULL REFERENCES "companies"("id") ON DELETE CASCADE,
    "campaign_id" uuid REFERENCES "campaigns"("id") ON DELETE SET NULL,
    "type" text NOT NULL CHECK ("type" IN ('email_template','ad_copy','survey','social_post','landing_page','case_study','other')),
    "name" text NOT NULL,
    "content" text,
    "content_json" jsonb,
    "version" integer DEFAULT 1 NOT NULL,
    "created_by" text,
    "is_active" boolean DEFAULT true NOT NULL,
    "created_at" timestamp with time zone DEFAULT now() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS "idx_agency_assets_company" ON "agency_assets"("company_id");
CREATE INDEX IF NOT EXISTS "idx_agency_assets_type" ON "agency_assets"("type");
CREATE INDEX IF NOT EXISTS "idx_agency_assets_active" ON "agency_assets"("company_id", "type") WHERE "is_active" = true;

-- ---- analytics: daily rollup metrics ----
CREATE TABLE IF NOT EXISTS "analytics_daily" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
    "company_id" uuid NOT NULL REFERENCES "companies"("id") ON DELETE CASCADE,
    "campaign_id" uuid REFERENCES "campaigns"("id") ON DELETE SET NULL,
    "date" date NOT NULL,
    "leads_added" integer DEFAULT 0 NOT NULL,
    "leads_contacted" integer DEFAULT 0 NOT NULL,
    "leads_replied" integer DEFAULT 0 NOT NULL,
    "leads_qualified" integer DEFAULT 0 NOT NULL,
    "leads_converted" integer DEFAULT 0 NOT NULL,
    "interactions_sent" integer DEFAULT 0 NOT NULL,
    "interactions_delivered" integer DEFAULT 0 NOT NULL,
    "interactions_opened" integer DEFAULT 0 NOT NULL,
    "interactions_clicked" integer DEFAULT 0 NOT NULL,
    "interactions_replied" integer DEFAULT 0 NOT NULL,
    "interactions_failed" integer DEFAULT 0 NOT NULL,
    "reply_rate" numeric(5,2),
    "open_rate" numeric(5,2),
    "click_rate" numeric(5,2),
    "conversion_rate" numeric(5,2),
    "created_at" timestamp with time zone DEFAULT now() NOT NULL,
    UNIQUE("company_id", "campaign_id", "date")
);

CREATE INDEX IF NOT EXISTS "idx_analytics_daily_company" ON "analytics_daily"("company_id", "date" DESC);
CREATE INDEX IF NOT EXISTS "idx_analytics_daily_campaign" ON "analytics_daily"("campaign_id", "date" DESC);

-- ---- agency_run_log: track agency agent executions ----
CREATE TABLE IF NOT EXISTS "agency_run_log" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
    "company_id" uuid NOT NULL REFERENCES "companies"("id") ON DELETE CASCADE,
    "agent_id" uuid NOT NULL,
    "agent_name" text,
    "issue_id" uuid,
    "task_description" text,
    "status" text DEFAULT 'running' NOT NULL CHECK ("status" IN ('queued','running','completed','failed','cancelled')),
    "output" jsonb,
    "error" text,
    "started_at" timestamp with time zone DEFAULT now() NOT NULL,
    "completed_at" timestamp with time zone,
    "duration_ms" integer
);

CREATE INDEX IF NOT EXISTS "idx_agency_run_log_company" ON "agency_run_log"("company_id");
CREATE INDEX IF NOT EXISTS "idx_agency_run_log_agent" ON "agency_run_log"("agent_id");
CREATE INDEX IF NOT EXISTS "idx_agency_run_log_status" ON "agency_run_log"("status");

-- ---- Triggers: enforce lead status transitions ----
CREATE OR REPLACE FUNCTION enforce_lead_status_transition()
RETURNS TRIGGER AS $$
BEGIN
    IF OLD.status = 'converted' AND NEW.status NOT IN ('converted', 'unsubscribed') THEN
        RAISE EXCEPTION 'Lead is already converted. Can only transition to unsubscribed.';
    END IF;
    IF OLD.status = 'unsubscribed' THEN
        RAISE EXCEPTION 'Lead is unsubscribed. No further actions allowed.';
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS "tr_lead_status_enforcement" ON "leads";
CREATE TRIGGER "tr_lead_status_enforcement"
BEFORE UPDATE ON "leads"
FOR EACH ROW
EXECUTE FUNCTION enforce_lead_status_transition();

-- ---- Triggers: update updated_at on row change ----
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS "tr_agency_brief_updated" ON "agency_brief";
CREATE TRIGGER "tr_agency_brief_updated" BEFORE UPDATE ON "agency_brief"
FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS "tr_campaigns_updated" ON "campaigns";
CREATE TRIGGER "tr_campaigns_updated" BEFORE UPDATE ON "campaigns"
FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS "tr_leads_updated" ON "leads";
CREATE TRIGGER "tr_leads_updated" BEFORE UPDATE ON "leads"
FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS "tr_agency_assets_updated" ON "agency_assets";
CREATE TRIGGER "tr_agency_assets_updated" BEFORE UPDATE ON "agency_assets"
FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ---- Views: common queries ----
CREATE OR REPLACE VIEW "campaign_metrics" AS
SELECT
    c.id AS campaign_id,
    c.name AS campaign_name,
    c.status,
    c.industry,
    COUNT(DISTINCT l.id) AS total_leads,
    COUNT(DISTINCT CASE WHEN l.status = 'qualified' THEN l.id END) AS qualified_leads,
    COUNT(DISTINCT CASE WHEN l.status = 'converted' THEN l.id END) AS converted_leads,
    COUNT(DISTINCT CASE WHEN l.status = 'contacted' THEN l.id END) AS contacted_leads,
    COUNT(DISTINCT i.id) AS total_interactions,
    COUNT(DISTINCT CASE WHEN i.replied = true THEN i.id END) AS replies_received,
    COUNT(DISTINCT CASE WHEN i.delivered = true THEN i.id END) AS delivered_interactions
FROM "campaigns" c
LEFT JOIN "leads" l ON l.campaign_id = c.id
LEFT JOIN "interactions" i ON i.lead_id = l.id
GROUP BY c.id, c.name, c.status, c.industry;

CREATE OR REPLACE VIEW "lead_last_interaction" AS
SELECT
    l.id AS lead_id,
    l.company_name,
    l.contact_name,
    l.status AS lead_status,
    i.channel,
    i.type,
    i.content_text,
    i.sent_at AS last_contacted,
    i.replied
FROM "leads" l
LEFT JOIN LATERAL (
    SELECT * FROM "interactions" WHERE lead_id = l.id
    ORDER BY sent_at DESC LIMIT 1
) i ON true;
