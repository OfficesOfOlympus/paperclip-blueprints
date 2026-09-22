# Agency Bootstrap Config Schema

This is the input format for launching a new agency instance. The schema defines all required fields that get seeded into the `agency_brief` table and consumed by all agents.

## Structure

```json
{
  "agency": {
    "name": "string — display name for the agency",
    "timezone": "string — ISO 8601 timezone for scheduling (default: UTC)"
  },
  "product": {
    "description": "string — what the agency sells, 1-3 sentences",
    "pricing_model": "string — e.g. 'retainer', 'per-project', 'tiered-saas'",
    "key_differentiators": ["string" — 3-5 unique selling points"],
    "product_files": ["string or object — URLs/paths to product docs, specs, media"],
    "brand_guidelines": {
      "tone": "string — e.g. 'professional, direct, data-driven'",
      "voice": "string — e.g. 'consultative, authoritative, approachable'",
      "language": "string — default 'en'",
      "avoid": ["string — things to never say or do"]
    }
  },
  "market": {
    "industry": "string — primary industry vertical",
    "target_region": "string — geographic focus (default: global)",
    "market_size": "string — total addressable market description",
    "competitors": [
      {
        "name": "string",
        "positioning": "string — how they're perceived in the market",
        "weakness": "string — where they fall short"
      }
    ],
    "market_trends": ["string — 3-5 relevant trends"]
  },
  "icp": {
    "company_size": {
      "min_employees": "number",
      "max_employees": "number"
    },
    "industries": ["string — target industries"],
    "job_titles": ["string — target decision maker titles"],
    "tech_stack": ["string — common tools used by this ICP"],
    "pain_points": ["string — 3-5 key problems this ICP faces"],
    "budget_range": "string — e.g. '$10k-$50k/mo'",
    "geography": ["string — regions where ICP operates"],
    "triggers": ["string — events that signal readiness to buy"]
  },
  "campaign": {
    "channels": ["email" | "linkedin" | "twitter" | "phone"],
    "cadence": {
      "days_between": "number — minimum days between touches to same lead",
      "max_touches_per_lead": "number — max interactions per lead",
      "work_hours": "string — e.g. '09:00-17:00', 'UTC'"
    },
    "goals": {
      "leads_per_week": "number",
      "reply_rate_target": "number — percentage, e.g. 15 for 15%",
      "qualified_rate_target": "number — percentage"
    }
  }
}
```

## Validation Rules

- `product.description` — required, 10-1000 chars
- `product.key_differentiators` — required, 3-5 items, each 10-200 chars
- `icp.company_size` — `min_employees` and `max_employees` required, min >= 1
- `icp.job_titles` — required, 3-10 items
- `icp.pain_points` — required, 3-5 items
- `campaign.channels` — required, at least 1 item
- `campaign.cadence.days_between` — required, 1-14
- `campaign.cadence.max_touches_per_lead` — required, 3-50
- `brand_guidelines.tone` — required, 10-200 chars
- All strings trimmed and lowercase where appropriate

## File Format

Configs can be:
1. **JSON file** — passed to `paperclipai bootstrap` command
2. **Interactive prompts** — CLI wizard fills gaps with reasonable defaults
3. **Directory structure** — `company/` folder with:
   ```
   company/
     ├── brief.json        # main config above
     ├── product-files/    # specs, docs, media
     ├── competitive/      # competitor analysis docs
     └── ICP/              # ICP research data
   ```

## Seed Output

When `paperclipai bootstrap company/` runs, it:

1. Validates the config against the schema above
2. Creates a new company in Paperclip
3. Seeds `agency_brief` table with the config data
4. Creates an initial `campaign` record in `campaigns` table
5. Copies product files into the company's asset store
6. Updates each agent's `AGENTS.md` to reference the brief
7. Starts the agency service running

## Example

```json
{
  "agency": {
    "name": "Fintech Growth Co",
    "timezone": "America/New_York"
  },
  "product": {
    "description": "AI-powered outbound lead generation platform for B2B fintech companies. We identify, reach out to, and qualify decision makers so your sales team only talks to warm leads.",
    "pricing_model": "tiered-saas",
    "key_differentiators": [
      "Built exclusively for fintech verticals",
      "Proprietary lead scoring based on buying signals",
      "Full integration with HubSpot, Salesforce, and Outreach"
    ],
    "product_files": [
      "https://example.com/fintech-platform-datasheet.pdf",
      "https://example.com/customer-testimonials.mp4"
    ],
    "brand_guidelines": {
      "tone": "professional, data-driven, concise",
      "voice": "consultative expert",
      "language": "en",
      "avoid": ["overpromising ROI", "competitor bashing", "jargon-heavy language"]
    }
  },
  "market": {
    "industry": "fintech",
    "target_region": "North America",
    "market_size": "$15B B2B sales software market, growing 25% YoY",
    "competitors": [
      {
        "name": "SalesGen AI",
        "positioning": "generalist outbound automation",
        "weakness": "no industry specialization, generic messaging"
      }
    ],
    "market_trends": [
      "Fintech companies shifting to outbound-led growth",
      "AI-powered personalization becoming table stakes",
      "Buyer trust declining, requiring more proof signals"
    ]
  },
  "icp": {
    "company_size": {
      "min_employees": 50,
      "max_employees": 500
    },
    "industries": ["payments", "neobanking", "insurtech", "lending-tech"],
    "job_titles": ["VP of Growth", "Head of Revenue", "CMO", "CEO", "VP of Sales"],
    "tech_stack": ["HubSpot", "Salesforce", "Outreach", "LinkedIn Sales Nav", "ZoomInfo"],
    "pain_points": [
      "Inbound leads not enough to fill pipeline",
      "Sales team wastes time on unqualified prospects",
      "Cold outreach has low reply rates (<5%)",
      "No consistency in outbound execution"
    ],
    "budget_range": "$10k-$50k/mo",
    "geography": ["United States", "Canada", "United Kingdom"],
    "triggers": ["new funding round", "hiring sales team", "new product launch", "expansion to new market"]
  },
  "campaign": {
    "channels": ["email", "linkedin"],
    "cadence": {
      "days_between": 3,
      "max_touches_per_lead": 12,
      "work_hours": "09:00-17:00, America/New_York"
    },
    "goals": {
      "leads_per_week": 100,
      "reply_rate_target": 15,
      "qualified_rate_target": 25
    }
  }
}
```
