-- QCut reaches this database only as the table owner (postgres, through
-- Hyperdrive) and as service_role, never as anon or authenticated, so those
-- API roles hold nothing in "public": SECURITY DEFINER functions would
-- otherwise run past RLS for anyone with the public anon key, and Supabase's
-- default privileges would hand them ALL on every object created here later.
revoke all on all tables in schema public from anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;
-- Every role inherits PUBLIC, which can execute any function until revoked;
-- with the default grants below gone, a new SECURITY DEFINER function here
-- is closed by `revoke execute on function ... from public` alone.
revoke all on all functions in schema public from public, anon, authenticated;
-- The agent worker claims queued jobs through this RPC with the service_role key.
grant execute on function public.claim_one_agent_job(text) to service_role;

alter default privileges for role postgres in schema public
	revoke all on tables from anon, authenticated;
alter default privileges for role postgres in schema public
	revoke all on sequences from anon, authenticated;
alter default privileges for role postgres in schema public
	revoke all on functions from anon, authenticated;
