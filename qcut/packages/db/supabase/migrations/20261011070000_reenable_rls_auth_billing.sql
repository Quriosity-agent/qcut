-- Supabase serves every table in "public" through its REST API, and the anon
-- and authenticated roles hold ALL privileges on new tables by default, so
-- RLS is what keeps the public anon key out: these tables must never run with
-- it disabled. QCut reads and writes them only as their owner (postgres,
-- through Hyperdrive), which RLS does not restrict, so no policies are added
-- and the API roles are denied outright.
alter table public.users enable row level security;
alter table public.accounts enable row level security;
alter table public.sessions enable row level security;
alter table public.verifications enable row level security;
alter table public.waitlist enable row level security;
alter table public.licenses enable row level security;
alter table public.device_activations enable row level security;
alter table public.credit_balances enable row level security;
alter table public.credit_transactions enable row level security;
alter table public.usage_records enable row level security;
alter table public.stripe_webhook_events enable row level security;

revoke all on table
	public.users,
	public.accounts,
	public.sessions,
	public.verifications,
	public.waitlist,
	public.licenses,
	public.device_activations,
	public.credit_balances,
	public.credit_transactions,
	public.usage_records,
	public.stripe_webhook_events
from anon, authenticated;
