# QCut Payment System — Implementation Plan

## Overview

The QCut payment system has two sides: **Web** (collect payments, manage subscriptions) and **App** (validate license, prompt upgrades). They connect through a **License Server**.

---

## Architecture Overview

```
┌─────────────────┐     ┌──────────────────┐     ┌─────────────────┐
│   QCut App      │────▶│  License Server   │◀────│   QCut Web      │
│   (Electron)    │     │  (API + DB)       │     │  (nexusai-site) │
│                 │     │                   │     │                 │
│ • License check │     │ • Extend @qcut/db │     │ • Pricing page  │
│ • Feature gates │     │ • Stripe webhooks │     │ • Stripe Checkout│
│ • Upgrade CTA   │     │ • Usage tracking  │     │ • Account mgmt  │
│ • Deep link ✅  │     │ • BetterAuth SSO  │     │ • Dashboard     │
└─────────────────┘     └──────────────────┘     └─────────────────┘
                              │
                              ▼
                        ┌──────────┐
                        │  Stripe  │
                        │  API     │
                        └──────────┘
```

> ✅ = Already exists in codebase

---

## Existing Infrastructure (Must Reuse)

Before building, these already exist and MUST be reused:

| Existing | Location | Purpose |
|----------|----------|---------|
| **BetterAuth** | `packages/auth/` | Email/password auth, JWT sessions, Drizzle adapter |
| **PostgreSQL + Drizzle ORM** | `packages/db/` | `users`, `sessions`, `accounts` tables, RLS enabled |
| **`qcut://` protocol** | `electron/main.ts` + `package.json` | Deep link already registered, extend directly |
| **`safeStorage` encryption** | `electron/api-key-handler.ts` | Electron secure storage API, use for offline license cache |
| **IPC handler pattern** | `electron/*-handler.ts` (21 handlers) | `ipcMain.handle('namespace:action')` standard pattern |
| **Zustand store pattern** | `apps/web/src/stores/` (15 stores) | `create<State>((set, get) => ({...}))` + toast notifications |
| **ElectronAPI type system** | `apps/web/src/types/electron/` | 22 modular type files, composed into `ElectronAPI` |
| **QCut Website** | `nexusai-website/` (separate repo) | Static HTML + Tailwind + vanilla JS, i18n (EN/ZH/JA), dark mode. Currently "100% free" messaging — no auth or payments |

---

## Pricing Plans

| Plan | Price | Credits/month | Features |
|------|-------|---------------|----------|
| **Free** | $0 | 50 credits | 720p export, watermark, basic templates, BYOK supported |
| **Pro** | $9.99/mo or $99/yr | 500 credits | 4K export, no watermark, all templates, priority rendering |
| **Team** | $29.99/mo or $299/yr | 2000 credits | Everything in Pro + team collaboration, API access, custom branding |

### Credit Top-ups (One-time Purchase)

| Pack | Price | Credits | Bonus |
|------|-------|---------|-------|
| Starter | $4.99 | 50 | — |
| Standard | $9.99 | 120 | +20% |
| Pro | $24.99 | 350 | +40% |
| Mega | $49.99 | 800 | +60% |

Top-up credits never expire. Monthly plan credits reset each billing cycle.

---

## Credits System

### How Credits Work

1 credit ≈ $0.10 of AI compute. Credits are a universal currency across all AI operations.

Users have two credit sources:
- **Plan credits** — Included with subscription, reset monthly
- **Top-up credits** — Purchased separately, never expire, consumed after plan credits are used up

### BYOK (Bring Your Own Key) Compatibility

- **Free users**: Get 50 credits/month. Can also use their own API keys for unlimited usage (current model preserved)
- **Pro/Team users**: Get plan credits. Can also use BYOK to skip credit deduction
- **Logic**: If user has their own API key configured for a provider, use it directly (no credits deducted). Otherwise, use QCut's managed API key and deduct credits.

### Credit Costs by Operation

Costs are derived from the existing cost calculator in `electron/native-pipeline/infra/cost-calculator.ts`.

| Operation | Example Model | USD Cost | Credits |
|-----------|---------------|----------|---------|
| **Text-to-Image** | FLUX.1 Schnell | $0.001 | 0.1 |
| **Text-to-Image** | Seedream v3 | $0.002 | 0.2 |
| **Text-to-Image** | Google Imagen 4 | $0.004 | 0.4 |
| **Text-to-Image** | Reve T2I | $0.04 | 0.5 |
| **Text-to-Video (5s)** | LTX V2 Fast 1080p | $0.20 | 2 |
| **Text-to-Video (5s)** | Kling v2.6 Pro | $0.35 | 4 |
| **Text-to-Video (5s)** | WAN v2.6 1080p | $0.75 | 8 |
| **Text-to-Video (5s)** | Google Veo 3 | $2.50 | 25 |
| **Image-to-Video** | Kling v2.1 | $0.05 | 0.5 |
| **Image-to-Video** | MiniMax Hailuo-02 | $0.05 | 0.5 |
| **Image-to-Video** | Sora 2 (5s) | $0.50 | 5 |
| **Avatar Video (5s)** | Kling Avatar v2 Std | $0.056 | 0.6 |
| **Avatar Video (5s)** | OmniHuman v1.5 | $0.80 | 8 |
| **TTS (100 chars)** | ElevenLabs | $0.003 | 0.1 |
| **Transcription (1 min)** | ElevenLabs Scribe | $0.008 | 0.1 |
| **Video Upscale** | ByteDance Upscaler | $0.05 | 0.5 |
| **Image Edit** | FLUX Kontext | $0.025 | 0.3 |
| **Prompt Generation** | OpenRouter | $0.002 | 0.1 |

> Credit costs are rounded to simple values. The mapping lives in a config file so it can be adjusted without code changes.

### Credit Deduction Flow

```
User clicks "Generate" in QCut App
    ↓
Check: Does user have their own API key for this provider?
    ├── YES → Use BYOK key, no credits deducted, call provider directly
    └── NO  → Check credit balance (plan + top-up)
                ├── Sufficient → Deduct credits, use QCut's managed API key
                └── Insufficient → Show upgrade/buy-credits prompt
```

---

## Phase 1: Database + License Server (Backend)

### Tech Choices (Aligned with Existing Stack)

| Decision | Choice | Reason |
|----------|--------|--------|
| **Auth** | Extend existing BetterAuth | `users/sessions` tables already exist, don't rebuild |
| **Database** | Extend existing PostgreSQL + Drizzle | `@qcut/db` already exists, just add new tables |
| **HTTP framework** | Hono | License server deploys independently, lightweight |
| **Deployment** | Cloudflare Workers or Vercel Edge | License API needs low latency |

### Data Model (Extend `packages/db/src/schema.ts`)

```typescript
// Add to packages/db/src/schema.ts — reuse existing users table id as foreign key

import { pgTable, text, timestamp, boolean, integer } from "drizzle-orm/pg-core";

// licenses table
export const licenses = pgTable("licenses", {
  id: text("id").primaryKey(),
  userId: text("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  plan: text("plan", { enum: ["free", "pro", "team"] }).notNull().default("free"),
  status: text("status", { enum: ["active", "past_due", "cancelled", "expired"] })
    .notNull()
    .default("active"),
  stripeCustomerId: text("stripe_customer_id"),
  stripeSubscriptionId: text("stripe_subscription_id"),
  currentPeriodEnd: timestamp("current_period_end"),
  maxDevices: integer("max_devices").notNull().default(1),
  createdAt: timestamp("created_at").$defaultFn(() => new Date()).notNull(),
  updatedAt: timestamp("updated_at").$defaultFn(() => new Date()).notNull(),
}).enableRLS();

// device_activations table
export const deviceActivations = pgTable("device_activations", {
  id: text("id").primaryKey(),
  licenseId: text("license_id")
    .notNull()
    .references(() => licenses.id, { onDelete: "cascade" }),
  deviceFingerprint: text("device_fingerprint").notNull(),
  deviceName: text("device_name").notNull(),
  lastSeenAt: timestamp("last_seen_at").$defaultFn(() => new Date()).notNull(),
  isActive: boolean("is_active").notNull().default(true),
}).enableRLS();

// credit_balances table — tracks current credit balance per user
export const creditBalances = pgTable("credit_balances", {
  id: text("id").primaryKey(),
  userId: text("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" })
    .unique(),
  planCredits: integer("plan_credits").notNull().default(50),      // resets monthly
  topUpCredits: integer("top_up_credits").notNull().default(0),    // never expires
  planCreditsResetAt: timestamp("plan_credits_reset_at").notNull(),
  updatedAt: timestamp("updated_at").$defaultFn(() => new Date()).notNull(),
}).enableRLS();

// credit_transactions table — audit log of every credit change
export const creditTransactions = pgTable("credit_transactions", {
  id: text("id").primaryKey(),
  userId: text("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  type: text("type", {
    enum: ["plan_grant", "top_up", "deduction", "refund", "expiry"]
  }).notNull(),
  amount: integer("amount").notNull(),                             // positive = add, negative = deduct
  balanceAfter: integer("balance_after").notNull(),
  description: text("description"),                                // e.g. "Kling v2.6 Pro — 5s video"
  modelKey: text("model_key"),                                     // e.g. "kling-v2.6-pro"
  stripePaymentId: text("stripe_payment_id"),                      // for top-up purchases
  createdAt: timestamp("created_at").$defaultFn(() => new Date()).notNull(),
}).enableRLS();
```

### API Endpoints

```
# Auth — reuse BetterAuth, don't rebuild
# License Server handles license + credits + stripe

GET    /api/license                 — Get current license (by userId from BetterAuth session)
POST   /api/license/activate       — Activate device
DELETE /api/license/deactivate     — Deactivate device

GET    /api/credits                 — Get current credit balance (plan + top-up)
POST   /api/credits/deduct         — Deduct credits for an AI operation
GET    /api/credits/history         — Get credit transaction history
POST   /api/credits/topup          — Create Stripe Checkout for credit pack purchase

POST   /api/stripe/checkout        — Create Stripe Checkout session (plan subscription)
POST   /api/stripe/topup           — Create Stripe Checkout session (one-time credit pack)
POST   /api/stripe/portal          — Create Stripe Customer Portal session
POST   /api/stripe/webhook         — Stripe webhook callback
```

> Note: No `/api/auth/*` endpoints needed — authentication is already handled by BetterAuth (`packages/auth/`)

### Stripe Webhook Handling

```typescript
switch (event.type) {
  case 'checkout.session.completed':
    // Check metadata.type to distinguish:
    //   "subscription" → Create/upgrade license + grant plan credits
    //   "topup"        → Add top-up credits to balance
    break;
  case 'customer.subscription.updated': // Update license status + adjust plan credits
  case 'customer.subscription.deleted': // Downgrade to free (50 credits), keep top-up credits
  case 'invoice.payment_succeeded':     // Monthly renewal → reset plan credits
  case 'invoice.payment_failed':        // Mark as past_due, keep existing credits
}
```

---

## Phase 2: QCut Web (Frontend Payments)

### Current State of nexusai-website

The website (`github.com/donghaozhang/nexusai-website`) is a **static HTML/CSS/JS site** — no framework:
- **Stack**: Static HTML + Tailwind CSS + vanilla JavaScript
- **Pages**: `index.html`, `about.html`, `solutions.html`, `blog.html`, `case-studies.html`, `releases.html`
- **Features**: i18n (EN/ZH/JA via `i18n.js`), dark mode (`theme.js`), responsive
- **Current pricing model**: "100% free" — users bring their own API keys, pay-per-use AI costs
- **No auth, no Stripe, no payment code exists**

### Decision: Static HTML Pages vs Framework Migration

Since the site is static HTML, payment pages should match the existing pattern. No need to migrate to React/Next.js just for 3 pages. Stripe Checkout handles the heavy lifting (hosted payment form), so client-side complexity is minimal.

### New Pages (Static HTML)

1. **`pricing.html`** — Pricing + Credits page
   - Top section: Plan comparison (Free/Pro/Team) with "Upgrade" buttons
   - Bottom section (`#credits`): Credit top-up packs with "Buy" buttons
   - Matches existing Tailwind + i18n pattern from `index.html`
   - "Upgrade" button → `fetch('/api/stripe/checkout')` → Stripe hosted payment
   - "Buy Credits" button → `fetch('/api/stripe/topup')` → Stripe hosted payment
   - Already has an AI Models pricing section on `index.html` — link to this page from there
2. **`account.html`** — Account management (plan, credits, devices, billing)
   - Shows: current plan, credit balance (plan + top-up), usage history, active devices
   - "Manage Subscription" → Stripe Customer Portal
   - "Buy More Credits" → scrolls to `pricing.html#credits`
   - Credit transaction history table (fetches from `GET /api/credits/history`)
   - Login state managed via JWT in `localStorage` (from BetterAuth)
3. **`success.html`** — Payment success page
   - Shows confirmation + deep link button: `qcut://activate?token=xxx`
   - For credit purchases: shows new credit balance
   - Fallback download link if deep link doesn't work
4. **`login.html`** — Login/register page
   - Simple email/password form posting to BetterAuth endpoints
   - Stores JWT in `localStorage` for `account.html` and `pricing.html` API calls

### Key Interactions

**Plan upgrade (from QCut App or Web):**
1. User clicks "Upgrade" in QCut App → `shell.openExternal('https://quriosity.com.au/pricing')`
2. On `pricing.html` → clicks plan → `fetch('/api/stripe/checkout')` → Stripe hosted payment
3. Payment complete → Stripe redirects to `success.html` → deep link `qcut://activate?token=xxx`
4. QCut App receives deep link → refreshes license + credits

**Credit top-up (from QCut App or Web):**
1. User clicks "Buy Credits" in QCut App → `shell.openExternal('https://quriosity.com.au/pricing#credits')`
2. On `pricing.html#credits` → picks pack → `fetch('/api/stripe/topup')` → Stripe hosted payment
3. Payment complete → webhook adds top-up credits → `success.html` shows new balance
4. QCut App refreshes credit balance on next `license:check`

**Manage subscription:**
- `account.html` → "Manage Subscription" → `fetch('/api/stripe/portal')` → Stripe Customer Portal

All payment UI is Stripe-hosted — no need for client-side Stripe.js or card forms.

### Messaging Transition

Current site says "100% free, no watermarks, no subscriptions." This needs a careful messaging update:
- Free tier remains generous (keeps current BYOK model)
- Pro/Team adds managed AI credits, higher quality exports, no watermark
- Update `index.html` hero section and FAQ to reflect freemium model

---

## Phase 3: QCut App (Electron Side)

### 3.1 License Store (Aligned with Existing Zustand Pattern)

```typescript
// apps/web/src/stores/license/license-store.ts
// Follows existing pattern: create<State>((set, get) => ({...})) + toast

import { create } from "zustand";
import { toast } from "sonner";
import { shell } from "electron";

type Plan = "free" | "pro" | "team";
type FeatureName = "ai-generation" | "export-4k" | "no-watermark" | "all-templates" | "team-collab" | "api-access";

interface CreditBalance {
  planCredits: number;          // resets monthly
  topUpCredits: number;         // never expires
  totalCredits: number;         // planCredits + topUpCredits
  planCreditsResetAt: string;
}

interface LicenseInfo {
  plan: Plan;
  status: "active" | "past_due" | "cancelled" | "expired";
  currentPeriodEnd?: string;
  credits: CreditBalance;
}

interface LicenseState {
  license: LicenseInfo | null;
  isLoading: boolean;

  checkLicense: () => Promise<void>;
  canUseFeature: (feature: FeatureName) => boolean;
  hasCredits: (amount: number) => boolean;
  deductCredits: (amount: number, modelKey: string, description: string) => Promise<boolean>;
  openPricingPage: () => void;
  openBuyCreditsPage: () => void;
  clearLicense: () => void;
}

export const useLicenseStore = create<LicenseState>((set, get) => ({
  license: null,
  isLoading: false,

  checkLicense: async () => {
    set({ isLoading: true });
    try {
      if (window.electronAPI?.license) {
        const license = await window.electronAPI.license.check();
        set({ license });
      }
    } catch (error) {
      toast.error("License validation failed");
    } finally {
      set({ isLoading: false });
    }
  },

  canUseFeature: (feature: FeatureName) => {
    const { license } = get();
    if (!license) return feature === "ai-generation";
    return FEATURE_GATES[feature].includes(license.plan);
  },

  hasCredits: (amount: number) => {
    const { license } = get();
    if (!license) return false;
    return license.credits.totalCredits >= amount;
  },

  deductCredits: async (amount, modelKey, description) => {
    if (window.electronAPI?.license) {
      const success = await window.electronAPI.license.deductCredits(amount, modelKey, description);
      if (success) {
        // Refresh balance after deduction
        const license = await window.electronAPI.license.check();
        set({ license });
      }
      return success;
    }
    return false;
  },

  // Opens web pricing page — user clicks "Upgrade" button in QCut
  openPricingPage: () => {
    shell.openExternal("https://quriosity.com.au/pricing");
  },

  // Opens web credits purchase page — user clicks "Buy Credits" in QCut
  openBuyCreditsPage: () => {
    shell.openExternal("https://quriosity.com.au/pricing#credits");
  },

  clearLicense: () => set({ license: null }),
}));
```

### 3.2 Feature Gating

```typescript
// apps/web/src/lib/feature-gates.ts

const FEATURE_GATES: Record<string, Plan[]> = {
  "ai-generation": ["free", "pro", "team"],  // free has usage limits
  "export-4k": ["pro", "team"],
  "no-watermark": ["pro", "team"],
  "all-templates": ["pro", "team"],
  "team-collab": ["team"],
  "api-access": ["team"],
};
```

### 3.3 License IPC Handler (Aligned with Existing Handler Pattern)

```typescript
// electron/license-handler.ts
// Follows existing pattern: ipcMain.handle + safeStorage encryption

import { ipcMain, safeStorage } from "electron";
import path from "path";
import fs from "fs";

const LICENSE_CACHE_FILE = "license-cache.enc";
const OFFLINE_GRACE_DAYS = 7;

export function setupLicenseIPC() {
  ipcMain.handle("license:check", async () => {
    // 1. Try online: GET /api/license + GET /api/credits
    // 2. On failure: read safeStorage-encrypted local cache
    // 3. Cache older than 7 days → downgrade to free (50 credits)
    // Returns: LicenseInfo including CreditBalance
  });

  ipcMain.handle("license:activate", async (_event, token: string) => {
    // Handle qcut://activate?token=xxx deep link
  });

  ipcMain.handle("license:deduct-credits", async (_event, amount: number, modelKey: string, description: string) => {
    // POST /api/credits/deduct { amount, modelKey, description }
    // Update local cache with new balance
    // Returns: boolean success
  });

  ipcMain.handle("license:deactivate", async () => {
    // Deactivate device
  });
}
```

### 3.4 ElectronAPI Type Extension

```typescript
// apps/web/src/types/electron/license.d.ts — new file
// Follows existing pattern of 22 modular type files

export interface ElectronLicenseOps {
  check: () => Promise<LicenseInfo>;
  activate: (token: string) => Promise<boolean>;
  deductCredits: (amount: number, modelKey: string, description: string) => Promise<boolean>;
  deactivate: () => Promise<boolean>;
}

// Extend ElectronAPI in apps/web/src/types/electron/index.d.ts:
// license?: ElectronLicenseOps;
```

### 3.5 Upgrade & Buy Credits Prompts (In-App → Opens Web)

All payment happens on the website. QCut App only shows prompts and opens the browser.

**Trigger: Pro feature locked**
```
┌──────────────────────────────────────┐
│  This is a Pro feature               │
│                                      │
│  Upgrade to Pro to unlock 4K export, │
│  no watermark, and 500 credits/month │
│                                      │
│  [ View Plans ]     [ Maybe Later ]  │
└──────────────────────────────────────┘
→ "View Plans" calls shell.openExternal('https://quriosity.com.au/pricing')
```

**Trigger: Insufficient credits (no BYOK key)**
```
┌──────────────────────────────────────┐
│  Not enough credits                  │
│                                      │
│  This operation costs 4 credits.     │
│  You have 2 credits remaining.       │
│                                      │
│  [ Buy Credits ]  [ Add API Key ]    │
└──────────────────────────────────────┘
→ "Buy Credits" calls shell.openExternal('https://quriosity.com.au/pricing#credits')
→ "Add API Key" opens the existing API key settings panel
```

**Credit balance display** — Show remaining credits in the editor toolbar/status bar:
```
Credits: 42 remaining  [ + Buy More ]
```

### 3.6 Deep Link Activation (Infrastructure Already Exists)

```
qcut:// protocol is already registered in package.json and electron/main.ts ✅
After payment → qcut://activate?token=xxx → App auto-activates
Need to add activate route handler in main.ts protocol handler
```

### 3.7 Offline Validation

- License cache encrypted with `safeStorage.encryptString()` (reuses existing API key encryption pattern)
- Allow 7-day offline use
- Cache expired → downgrade to free
- Refresh cache on every successful online validation

---

## Phase 4: USDC/Crypto (Optional)

**Simplest approach: Use Stripe's built-in crypto payment option, zero additional code.**

Advanced approach: Circle / Coinbase Commerce / on-chain contracts (consider later).

---

## Dependencies to Install

```bash
# License Server
bun add stripe hono

# QCut App (no stripe client needed — payments happen in browser)
# No new dependencies needed, reuse existing BetterAuth + Zustand
```

---

## File Structure

### License Server (New Workspace Package)
```
packages/license-server/
├── src/
│   ├── routes/          (license, usage, stripe-webhook)
│   ├── services/        (stripe, license, device)
│   └── index.ts         (Hono app entry)
├── package.json
└── wrangler.toml        (Cloudflare Workers deployment)
```

> Note: No auth routes needed — reuse BetterAuth from `packages/auth/`

### Database Extension (Not a New Package)
```
packages/db/
├── src/schema.ts        ← Add licenses, deviceActivations, creditBalances, creditTransactions tables
└── migrations/          ← New migration files
```

### QCut App Additions
```
apps/web/src/
├── stores/license/
│   └── license-store.ts        ← New Zustand store (license + credits)
├── lib/
│   ├── feature-gates.ts        ← Feature gating config
│   └── credit-costs.ts         ← Credit cost mapping per model (from cost-calculator.ts pricing)
├── components/
│   ├── upgrade-prompt.tsx       ← Upgrade modal ("This is a Pro feature")
│   ├── buy-credits-prompt.tsx   ← Buy credits modal ("Not enough credits")
│   └── credit-balance.tsx       ← Status bar credit display
└── types/electron/
    └── license.d.ts             ← New type definitions

electron/
└── license-handler.ts           ← New IPC handler (license + credits)
```

### QCut Web Additions (nexusai-website — static HTML)
```
nexusai-website/
├── pricing.html         (Pricing page — Tailwind + i18n, same pattern as index.html)
├── account.html         (Account management — fetches from License Server API)
├── success.html         (Payment success + deep link to qcut://activate)
├── login.html           (Login/register form → BetterAuth endpoints)
└── js/
    └── payment.js       (Shared fetch helpers for License Server API calls)
```

---

## Security Considerations

1. License validation must happen server-side — never client-only
2. Device fingerprint must be stable — can't change on every reinstall
3. Stripe webhooks must verify signatures — `stripe.webhooks.constructEvent()`
4. Offline cache uses `safeStorage` encryption — reuse existing Electron secure storage
5. Client never stores Stripe keys — proxy through License Server
6. Auth token sharing — BetterAuth session shared between web and license server

---

## Integration Points with Existing System

| Integration Point | Existing Code | What to Do |
|--------------------|---------------|------------|
| Auth | `packages/auth/` BetterAuth | Share session, license server validates same JWT |
| DB | `packages/db/` Drizzle + PG | Add 4 new tables to `schema.ts` |
| Deep link | `electron/main.ts` `qcut://` | Add `activate` route handler |
| Encrypted storage | `electron/api-key-handler.ts` `safeStorage` | Reuse pattern to encrypt license + credit cache |
| IPC pattern | `electron/*-handler.ts` | Add `license-handler.ts`, register in main.ts |
| Type system | `apps/web/src/types/electron/` | Add `license.d.ts` + extend `ElectronAPI` |
| Store pattern | `apps/web/src/stores/` | Add `license/license-store.ts` |
| Cost calculator | `electron/native-pipeline/infra/cost-calculator.ts` | Map existing USD costs → credit amounts in `credit-costs.ts` |
| AI generators | `apps/web/src/lib/ai-video/generators/` | Add credit check before each generation call |
| API key handler | `electron/api-key-handler.ts` | Check BYOK key availability to decide credits vs direct API call |
