-- Apply once after the normal migrations. The invoking table owner must be the gateway's database login.
BEGIN;

CREATE ROLE visomi_cloud_example_records NOLOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE NOINHERIT;
DO $$
BEGIN
  EXECUTE format('GRANT visomi_cloud_example_records TO %I WITH INHERIT FALSE', current_user);
END $$;

GRANT USAGE ON SCHEMA public TO visomi_cloud_example_records;
GRANT SELECT ON public.persistence_memberships, public.persistence_grants TO visomi_cloud_example_records;
GRANT SELECT, INSERT ON public.persistence_records, public.persistence_commands TO visomi_cloud_example_records;
GRANT UPDATE (title, body, audience, revision, updated_at, deleted_at)
  ON public.persistence_records TO visomi_cloud_example_records;

ALTER TABLE public.persistence_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.persistence_records FORCE ROW LEVEL SECURITY;
ALTER TABLE public.persistence_commands ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.persistence_commands FORCE ROW LEVEL SECURITY;

-- Keep the pre-existing persistence adapter usable in this opted-in database.
CREATE POLICY legacy_persistence_records ON public.persistence_records USING (domain <> 'cloud-notes');
CREATE POLICY legacy_persistence_commands ON public.persistence_commands USING (domain <> 'cloud-notes');

-- This restrictive policy also constrains the role when other permissive policies exist.
CREATE POLICY cloud_example_record_scope ON public.persistence_records
  AS RESTRICTIVE TO visomi_cloud_example_records
  USING (
    domain = 'cloud-notes'
    AND tenant_id::text = current_setting('visomi.cloud_tenant', true)
    AND scope_id::text = current_setting('visomi.cloud_scope', true)
  );

CREATE POLICY cloud_example_read ON public.persistence_records FOR SELECT TO visomi_cloud_example_records
  USING (EXISTS (
    SELECT 1 FROM public.persistence_memberships AS member
    WHERE member.tenant_id = persistence_records.tenant_id
      AND member.user_id = nullif(current_setting('visomi.cloud_actor', true), '')::uuid
      AND member.revoked_at IS NULL
      AND (
        (member.owner AND member.user_id = persistence_records.owner_id)
        OR (persistence_records.audience = 'scope' AND persistence_records.deleted_at IS NULL AND EXISTS (
          SELECT 1 FROM public.persistence_grants AS access_grant
          WHERE access_grant.tenant_id = member.tenant_id
            AND access_grant.user_id = member.user_id
            AND access_grant.scope_id = persistence_records.scope_id
            AND access_grant.role = 'viewer'
        ))
      )
  ));

CREATE POLICY cloud_example_owner_write ON public.persistence_records FOR ALL TO visomi_cloud_example_records
  USING (EXISTS (
    SELECT 1 FROM public.persistence_memberships AS member
    WHERE member.tenant_id = persistence_records.tenant_id
      AND member.user_id = nullif(current_setting('visomi.cloud_actor', true), '')::uuid
      AND member.user_id = persistence_records.owner_id
      AND member.owner AND member.revoked_at IS NULL
  ));

CREATE POLICY cloud_example_command_scope ON public.persistence_commands
  AS RESTRICTIVE TO visomi_cloud_example_records
  USING (
    domain = 'cloud-notes'
    AND tenant_id::text = current_setting('visomi.cloud_tenant', true)
    AND scope_id::text = current_setting('visomi.cloud_scope', true)
    AND user_id = nullif(current_setting('visomi.cloud_actor', true), '')::uuid
  );

CREATE POLICY cloud_example_commands ON public.persistence_commands TO visomi_cloud_example_records
  USING (EXISTS (
    SELECT 1 FROM public.persistence_memberships AS member
    WHERE member.tenant_id = persistence_commands.tenant_id
      AND member.user_id = persistence_commands.user_id
      AND member.owner AND member.revoked_at IS NULL
  ));

COMMIT;
