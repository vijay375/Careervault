import { Pool, type PoolClient, type QueryResultRow } from "pg";

const schemaLockId = 2_146_781_903;

const initialSchemaSql = `
  create extension if not exists pgcrypto;

  create table if not exists users (
    id uuid primary key default gen_random_uuid(),
    name text not null,
    email text not null unique,
    password_hash text not null,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
  );

  create table if not exists sessions (
    token_hash text primary key,
    user_id uuid not null references users(id) on delete cascade,
    expires_at timestamptz not null,
    created_at timestamptz not null default now()
  );

  create table if not exists password_resets (
    email text primary key references users(email) on delete cascade,
    code_hash text not null,
    salt text not null,
    expires_at timestamptz not null,
    resend_available_at timestamptz not null,
    verified boolean not null default false,
    attempts integer not null default 0 check (attempts >= 0),
    updated_at timestamptz not null default now()
  );

  create table if not exists documents (
    id uuid primary key default gen_random_uuid(),
    user_id uuid not null references users(id) on delete cascade,
    company_name text not null,
    employee_name text not null,
    designation text not null,
    joining_date date not null,
    relieving_date date,
    document_type text not null,
    salary_info text,
    file_name text not null,
    file_size text not null,
    uploaded_at timestamptz not null default now(),
    status text not null,
    description text,
    file_type text not null,
    extracted_text text,
    extracted_at date,
    employment_period text,
    salary_month text,
    original_file_name text,
    file_mime_type text,
    file_data text not null,
    last_viewed date,
    updated_at timestamptz not null default now()
  );

  create table if not exists hr_users (
    id uuid primary key default gen_random_uuid(),
    name text not null,
    email text not null unique,
    password_hash text not null,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
  );

  create table if not exists hr_sessions (
    token_hash text primary key,
    user_id uuid not null references hr_users(id) on delete cascade,
    expires_at timestamptz not null,
    created_at timestamptz not null default now()
  );

  create table if not exists document_requests (
    id uuid primary key default gen_random_uuid(),
    token_hash text not null unique,
    access_token text unique,
    candidate_name text not null,
    candidate_email text not null,
    status text not null default 'pending'
      check (status in ('pending', 'submitted', 'expired', 'cancelled')),
    expires_at timestamptz not null,
    created_at timestamptz not null default now(),
    submitted_at timestamptz,
    cancelled_at timestamptz,
    created_by_hr_id uuid references hr_users(id) on delete set null,
    updated_at timestamptz not null default now()
  );

  alter table document_requests
    add column if not exists access_token text;

  create table if not exists document_request_items (
    id uuid primary key default gen_random_uuid(),
    request_id uuid not null references document_requests(id) on delete cascade,
    document_label text not null,
    is_custom boolean not null default false,
    sort_order integer not null default 0 check (sort_order >= 0),
    submitted_document_id uuid references documents(id) on delete restrict,
    submitted_file_name text,
    created_at timestamptz not null default now(),
    unique (request_id, sort_order)
  );

  create index if not exists sessions_user_id_idx on sessions (user_id);
  create index if not exists sessions_expires_at_idx on sessions (expires_at);
  create index if not exists password_resets_expires_at_idx on password_resets (expires_at);
  create index if not exists documents_user_uploaded_idx
    on documents (user_id, uploaded_at desc);
  create index if not exists hr_sessions_user_id_idx on hr_sessions (user_id);
  create index if not exists hr_sessions_expires_at_idx on hr_sessions (expires_at);
  create index if not exists document_requests_email_idx on document_requests (candidate_email);
  create index if not exists document_requests_status_idx on document_requests (status);
  create unique index if not exists document_requests_access_token_uidx
    on document_requests (access_token) where access_token is not null;
  create index if not exists document_requests_status_expiry_idx
    on document_requests (status, expires_at);
  create index if not exists document_request_items_request_idx
    on document_request_items (request_id, sort_order);
  create unique index if not exists document_request_items_request_sort_uidx
    on document_request_items (request_id, sort_order);
`;

const hardenExistingSchemaSql = `
  alter table document_request_items
    drop constraint if exists document_request_items_submitted_document_id_fkey;
  alter table document_request_items
    add constraint document_request_items_submitted_document_id_fkey
    foreign key (submitted_document_id) references documents(id) on delete restrict;

  do $migration$
  begin
    if not exists (
      select 1 from pg_constraint
      where conname = 'password_resets_email_fkey'
    ) then
      alter table password_resets
        add constraint password_resets_email_fkey
        foreign key (email) references users(email) on delete cascade;
    end if;

    if not exists (
      select 1 from pg_constraint
      where conname = 'document_requests_status_check'
    ) then
      alter table document_requests
        add constraint document_requests_status_check
        check (status in ('pending', 'submitted', 'expired', 'cancelled'));
    end if;

    if not exists (
      select 1 from pg_constraint
      where conname = 'password_resets_attempts_check'
    ) then
      alter table password_resets
        add constraint password_resets_attempts_check
        check (attempts >= 0);
    end if;

    if not exists (
      select 1 from pg_constraint
      where conname = 'document_request_items_sort_order_check'
    ) then
      alter table document_request_items
        add constraint document_request_items_sort_order_check
        check (sort_order >= 0);
    end if;
  end
  $migration$;
`;

const requestWorkflowSchemaSql = `
  alter table document_requests
    drop constraint if exists document_requests_status_check;

  update document_requests
  set status = 'sent'
  where status = 'pending';

  alter table document_requests
    alter column status set default 'draft';

  alter table document_requests
    add constraint document_requests_status_check
    check (status in (
      'draft', 'sent', 'delivered', 'viewed', 'in_progress',
      'submitted', 'completed', 'expired', 'cancelled'
    ));

  alter table document_requests
    add column if not exists sent_at timestamptz,
    add column if not exists delivered_at timestamptz,
    add column if not exists viewed_at timestamptz,
    add column if not exists in_progress_at timestamptz,
    add column if not exists completed_at timestamptz;

  update document_requests
  set sent_at = coalesce(sent_at, created_at)
  where status in ('sent', 'delivered', 'viewed', 'in_progress', 'submitted', 'completed');

  create table if not exists request_secure_tokens (
    id uuid primary key default gen_random_uuid(),
    request_id uuid not null references document_requests(id) on delete cascade,
    token_hash text not null unique,
    expires_at timestamptz not null,
    invalidated_at timestamptz,
    invalidation_reason text,
    used_at timestamptz,
    created_by_hr_id uuid references hr_users(id) on delete set null,
    created_at timestamptz not null default now()
  );

  insert into request_secure_tokens (
    request_id, token_hash, expires_at, invalidated_at, invalidation_reason,
    used_at, created_by_hr_id, created_at
  )
  select
    id,
    token_hash,
    expires_at,
    case when status in ('expired', 'cancelled', 'submitted', 'completed') then updated_at end,
    case
      when status = 'expired' then 'expired'
      when status = 'cancelled' then 'cancelled'
      when status in ('submitted', 'completed') then 'submitted'
    end,
    case when status in ('submitted', 'completed') then coalesce(submitted_at, updated_at) end,
    created_by_hr_id,
    created_at
  from document_requests
  on conflict (token_hash) do nothing;

  alter table document_requests
    add column if not exists current_token_id uuid;

  do $migration$
  begin
    if not exists (
      select 1 from pg_constraint
      where conname = 'document_requests_current_token_id_fkey'
    ) then
      alter table document_requests
        add constraint document_requests_current_token_id_fkey
        foreign key (current_token_id) references request_secure_tokens(id) on delete set null;
    end if;
  end
  $migration$;

  update document_requests requests
  set current_token_id = (
    select id
    from request_secure_tokens
    where request_id = requests.id
    order by created_at desc
    limit 1
  )
  where requests.current_token_id is null;

  create table if not exists request_email_deliveries (
    id uuid primary key default gen_random_uuid(),
    request_id uuid not null references document_requests(id) on delete cascade,
    token_id uuid references request_secure_tokens(id) on delete set null,
    email_type text not null check (email_type in ('candidate_request', 'hr_submission')),
    recipient_email text not null,
    status text not null check (status in ('pending', 'sent', 'failed', 'unconfigured')),
    provider text,
    provider_message_id text,
    error_message text,
    attempted_at timestamptz not null default now(),
    sent_at timestamptz
  );

  create table if not exists request_status_history (
    id uuid primary key default gen_random_uuid(),
    request_id uuid not null references document_requests(id) on delete cascade,
    from_status text,
    to_status text not null,
    changed_by_type text not null check (changed_by_type in ('system', 'hr', 'candidate')),
    changed_by_id uuid,
    note text,
    created_at timestamptz not null default now()
  );

  create table if not exists hr_notifications (
    id uuid primary key default gen_random_uuid(),
    hr_user_id uuid not null references hr_users(id) on delete cascade,
    request_id uuid references document_requests(id) on delete cascade,
    type text not null,
    title text not null,
    message text not null,
    read_at timestamptz,
    created_at timestamptz not null default now()
  );

  create table if not exists audit_logs (
    id uuid primary key default gen_random_uuid(),
    actor_type text not null check (actor_type in ('system', 'hr', 'candidate')),
    actor_id uuid,
    action text not null,
    entity_type text not null,
    entity_id uuid,
    metadata jsonb not null default '{}'::jsonb,
    created_at timestamptz not null default now()
  );

  alter table document_request_items
    add column if not exists submitted_at timestamptz;

  insert into request_status_history (request_id, to_status, changed_by_type, note, created_at)
  select id, status, 'system', 'Workflow migration baseline', updated_at
  from document_requests
  where not exists (
    select 1 from request_status_history history where history.request_id = document_requests.id
  );

  create unique index if not exists request_secure_tokens_one_active_idx
    on request_secure_tokens (request_id)
    where invalidated_at is null and used_at is null;
  create index if not exists request_secure_tokens_request_idx
    on request_secure_tokens (request_id, created_at desc);
  create index if not exists request_secure_tokens_expiry_idx
    on request_secure_tokens (expires_at);
  create index if not exists request_email_deliveries_request_idx
    on request_email_deliveries (request_id, attempted_at desc);
  create index if not exists request_status_history_request_idx
    on request_status_history (request_id, created_at asc);
  create index if not exists hr_notifications_user_unread_idx
    on hr_notifications (hr_user_id, read_at, created_at desc);
  create index if not exists audit_logs_entity_idx
    on audit_logs (entity_type, entity_id, created_at desc);
`;

const requestWorkflowCompatibilitySql = `
  alter table document_requests
    alter column access_token drop not null;
`;

const roleBasedAuthenticationSql = `
  alter table users
    add column if not exists role text;

  update users
  set role = 'employee'
  where role is null;

  insert into users (id, name, email, password_hash, role, created_at, updated_at)
  select id, name, lower(email), password_hash, 'recruiter', created_at, updated_at
  from hr_users
  on conflict (email) do update
  set name = excluded.name,
      password_hash = excluded.password_hash,
      role = 'recruiter',
      updated_at = now();

  alter table users
    alter column role set default 'employee',
    alter column role set not null;

  alter table users
    drop constraint if exists users_role_check;
  alter table users
    add constraint users_role_check check (role in ('employee', 'recruiter'));

  create index if not exists users_role_idx on users (role);
`;

const signupEmailVerificationSql = `
  create table if not exists signup_verifications (
    email text primary key,
    name text not null,
    role text not null check (role in ('employee', 'recruiter')),
    code_hash text not null,
    salt text not null,
    expires_at timestamptz not null,
    resend_available_at timestamptz not null,
    verified boolean not null default false,
    attempts integer not null default 0 check (attempts >= 0),
    updated_at timestamptz not null default now()
  );

  create index if not exists signup_verifications_expires_at_idx
    on signup_verifications (expires_at);
`;

const otpSendRateLimitSql = `
  alter table signup_verifications
    add column if not exists send_count integer not null default 0 check (send_count >= 0),
    add column if not exists send_window_started_at timestamptz;

  alter table password_resets
    add column if not exists send_count integer not null default 0 check (send_count >= 0),
    add column if not exists send_window_started_at timestamptz;
`;

const signupMagicLinkSql = `
  alter table signup_verifications
    add column if not exists first_name text,
    add column if not exists last_name text,
    add column if not exists token_hash text,
    add column if not exists used_at timestamptz,
    add column if not exists password_setup_token_hash text,
    add column if not exists password_setup_expires_at timestamptz;

  create index if not exists signup_verifications_token_hash_idx
    on signup_verifications (token_hash)
    where token_hash is not null;

  create index if not exists signup_verifications_password_setup_token_hash_idx
    on signup_verifications (password_setup_token_hash)
    where password_setup_token_hash is not null;
`;

const userFirstLastNameSql = `
  alter table users
    add column if not exists first_name text,
    add column if not exists last_name text;

  update users
  set first_name = split_part(trim(name), ' ', 1)
  where first_name is null or first_name = '';

  update users
  set last_name = nullif(trim(regexp_replace(trim(name), '^\\S+\\s*', '')), '')
  where (last_name is null or last_name = '')
    and position(' ' in trim(name)) > 0;

  alter table hr_users
    add column if not exists first_name text,
    add column if not exists last_name text;

  update hr_users
  set first_name = split_part(trim(name), ' ', 1)
  where first_name is null or first_name = '';

  update hr_users
  set last_name = nullif(trim(regexp_replace(trim(name), '^\\S+\\s*', '')), '')
  where (last_name is null or last_name = '')
    and position(' ' in trim(name)) > 0;
`;

const migrations = [
  { version: "001_initial_schema", sql: initialSchemaSql },
  { version: "002_harden_existing_schema", sql: hardenExistingSchemaSql },
  { version: "003_request_workflow", sql: requestWorkflowSchemaSql },
  { version: "004_request_workflow_compatibility", sql: requestWorkflowCompatibilitySql },
  { version: "005_role_based_authentication", sql: roleBasedAuthenticationSql },
  { version: "006_signup_email_verification", sql: signupEmailVerificationSql },
  { version: "007_otp_send_rate_limits", sql: otpSendRateLimitSql },
  { version: "008_signup_magic_link", sql: signupMagicLinkSql },
  { version: "009_user_first_last_name", sql: userFirstLastNameSql },
];

type DatabaseGlobals = typeof globalThis & {
  __careervaultPool?: Pool;
  __careervaultSchemaPromise?: Promise<void>;
  __careervaultAppliedMigrationCount?: number;
};

const databaseGlobals = globalThis as DatabaseGlobals;

export function getDatabasePool() {
  if (databaseGlobals.__careervaultPool) {
    return databaseGlobals.__careervaultPool;
  }

  const databaseUrl = process.env.DATABASE_URL?.trim();
  if (!databaseUrl) {
    throw new Error("DATABASE_URL is not configured.");
  }

  let parsedUrl: URL;
  try {
    parsedUrl = new URL(databaseUrl);
  } catch {
    throw new Error("DATABASE_URL is not a valid PostgreSQL connection URL.");
  }

  if (!["postgres:", "postgresql:"].includes(parsedUrl.protocol)) {
    throw new Error("DATABASE_URL must use the postgres or postgresql protocol.");
  }

  const pool = new Pool({
    connectionString: databaseUrl,
    ssl: parsedUrl.hostname.endsWith("supabase.com")
      ? { rejectUnauthorized: false }
      : undefined,
    max: Number(process.env.DATABASE_POOL_MAX || 5),
    connectionTimeoutMillis: Number(process.env.DATABASE_CONNECT_TIMEOUT_MS || 10_000),
    idleTimeoutMillis: 30_000,
  });

  databaseGlobals.__careervaultPool = pool;
  return pool;
}

export async function query<T extends QueryResultRow = QueryResultRow>(
  sql: string,
  values: unknown[] = [],
) {
  return getDatabasePool().query<T>(sql, values);
}

export async function withTransaction<T>(callback: (client: PoolClient) => Promise<T>) {
  const client = await getDatabasePool().connect();

  try {
    await client.query("begin");
    const result = await callback(client);
    await client.query("commit");
    return result;
  } catch (error) {
    await client.query("rollback").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

export async function ensureDatabaseSchema() {
  const expectedMigrationCount = migrations.length;

  if (
    databaseGlobals.__careervaultSchemaPromise &&
    databaseGlobals.__careervaultAppliedMigrationCount === expectedMigrationCount
  ) {
    return databaseGlobals.__careervaultSchemaPromise;
  }

  databaseGlobals.__careervaultSchemaPromise = migrateDatabase()
    .then(() => {
      databaseGlobals.__careervaultAppliedMigrationCount = expectedMigrationCount;
    })
    .catch((error) => {
      databaseGlobals.__careervaultSchemaPromise = undefined;
      databaseGlobals.__careervaultAppliedMigrationCount = undefined;
      throw error;
    });

  return databaseGlobals.__careervaultSchemaPromise;
}

async function migrateDatabase() {
  await withTransaction(async (client) => {
    await client.query("select pg_advisory_xact_lock($1)", [schemaLockId]);
    await client.query(`
      create table if not exists schema_migrations (
        version text primary key,
        applied_at timestamptz not null default now()
      )
    `);

    for (const migration of migrations) {
      const applied = await client.query<{ version: string }>(
        "select version from schema_migrations where version = $1",
        [migration.version],
      );

      if (!applied.rowCount) {
        await client.query(migration.sql);
        await client.query("insert into schema_migrations (version) values ($1)", [
          migration.version,
        ]);
      }
    }
  });
}

export function describeDatabaseError(error: unknown) {
  const databaseError = error as { code?: string; message?: string };
  const message = databaseError?.message || "";

  if (databaseError?.code === "XX000" && message.includes("tenant/user")) {
    return "The configured Supabase project does not exist or the pooler URI is obsolete.";
  }

  if (databaseError?.code === "28P01") {
    return "Database authentication failed. Verify the username and password in DATABASE_URL.";
  }

  if (databaseError?.code === "3D000") {
    return "The database named in DATABASE_URL does not exist.";
  }

  if (databaseError?.code === "42501") {
    return "The database user does not have permission to initialize the CareerVault schema.";
  }

  if (databaseError?.code === "42P01") {
    return "The database schema is incomplete. Please restart the app so migrations can finish applying.";
  }

  if (databaseError?.code === "ENOTFOUND") {
    return "The database host could not be resolved. Verify the host in DATABASE_URL.";
  }

  if (databaseError?.code === "ECONNREFUSED" || databaseError?.code === "ETIMEDOUT") {
    return "The database server is unreachable. Verify its status, host, port, and network access.";
  }

  return "The database operation failed. Check the server logs for the PostgreSQL error.";
}
