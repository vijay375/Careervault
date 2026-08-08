import { createHash, randomBytes } from "node:crypto";
import { ensureDatabaseSchema, query, withTransaction } from "@/lib/database";
import { documentTypes, type DocumentType } from "@/lib/hr-data";

export type RequestStatus =
  | "draft"
  | "sent"
  | "delivered"
  | "viewed"
  | "in_progress"
  | "submitted"
  | "completed"
  | "expired"
  | "cancelled";

export type DisplayRequestStatus = "pending" | "submitted" | "expired";

export const activeRequestStatuses: RequestStatus[] = [
  "sent",
  "delivered",
  "viewed",
  "in_progress",
];

export type DocumentRequestItem = {
  id: string;
  documentLabel: string;
  isCustom: boolean;
  sortOrder: number;
  submittedDocumentId?: string;
  submittedFileName?: string;
};

export type DocumentRequestRecord = {
  id: string;
  candidateName: string;
  candidateEmail: string;
  status: DisplayRequestStatus;
  expiresAt: string;
  createdAt: string;
  submittedAt?: string;
  cancelledAt?: string;
  completedAt?: string;
  emailStatus?: "sent" | "failed" | "unconfigured";
  items: DocumentRequestItem[];
  requestLink?: string;
};

export type CreateDocumentRequestInput = {
  candidateName: string;
  candidateEmail: string;
  /** Optional User Portal account id — preferred when selecting a registered candidate. */
  candidateUserId?: string;
  documentLabels: string[];
  customDocuments: string[];
  expiryHours?: number;
  expiresAt?: string;
  replaceRequestId?: string;
  userPortalUrl: string;
};

export type RegisteredCandidateAccount = {
  id: string;
  email: string;
  name: string;
  firstName: string;
  lastName: string;
  role: string;
};

export type SubmitDocumentRequestInput = {
  token: string;
  userId: string;
  userEmail: string;
  submissions: Array<{ itemId: string; documentId: string }>;
};

export const defaultExpiryHours = 24;
export const expiryHourOptions = [1, 3, 6, 12, 24, 48];

type RequestRow = {
  id: string;
  access_token?: string | null;
  candidate_name: string;
  candidate_email: string;
  status: RequestStatus;
  expires_at: Date | string;
  created_at: Date | string;
  submitted_at?: Date | string | null;
  cancelled_at?: Date | string | null;
  completed_at?: Date | string | null;
  current_token_id?: string | null;
  created_by_hr_id?: string | null;
};

type ItemRow = {
  id: string;
  request_id: string;
  document_label: string;
  is_custom: boolean;
  sort_order: number;
  submitted_document_id?: string | null;
  submitted_file_name?: string | null;
};

export function normalizeEmail(email: string) {
  return email.trim().toLowerCase();
}

export function hashRequestToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

export async function ensureRequestSchema() {
  return ensureDatabaseSchema();
}

function displayAccountName(account: {
  name: string;
  first_name?: string | null;
  last_name?: string | null;
}) {
  const first = String(account.first_name || "").trim();
  const last = String(account.last_name || "").trim();
  const combined = [first, last].filter(Boolean).join(" ");
  return combined || String(account.name || "").trim() || "Candidate";
}

/**
 * Resolve the CareerVault account owner who should receive the document-request email.
 * Always returns the registered users.email from the database — never the HR session email.
 */
export async function resolveRegisteredCandidateAccount(input: {
  candidateEmail?: string;
  candidateUserId?: string;
}): Promise<
  | { ok: true; account: RegisteredCandidateAccount }
  | { ok: false; status: number; message: string }
> {
  await ensureRequestSchema();

  const candidateUserId = String(input.candidateUserId || "").trim();
  const candidateEmail = normalizeEmail(input.candidateEmail || "");

  if (!candidateUserId && !candidateEmail) {
    return {
      ok: false,
      status: 400,
      message: "Select a registered candidate or enter their CareerVault account email.",
    };
  }

  if (candidateEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(candidateEmail)) {
    return { ok: false, status: 400, message: "Enter a valid candidate email." };
  }

  const result = candidateUserId
    ? await query<{
        id: string;
        name: string;
        email: string;
        first_name: string | null;
        last_name: string | null;
        role: string;
      }>(
        `select id, name, email, first_name, last_name, role
         from users
         where id = $1
         limit 1`,
        [candidateUserId],
      )
    : await query<{
        id: string;
        name: string;
        email: string;
        first_name: string | null;
        last_name: string | null;
        role: string;
      }>(
        `select id, name, email, first_name, last_name, role
         from users
         where lower(email) = $1
         limit 1`,
        [candidateEmail],
      );

  const row = result.rows[0];
  if (!row) {
    return {
      ok: false,
      status: 404,
      message:
        "No CareerVault account was found for that email. Use the candidate's registered account email so they can open the request and submit documents.",
    };
  }

  return {
    ok: true,
    account: {
      id: row.id,
      email: normalizeEmail(row.email),
      name: displayAccountName(row),
      firstName: String(row.first_name || "").trim(),
      lastName: String(row.last_name || "").trim(),
      role: row.role,
    },
  };
}

export async function searchRegisteredCandidateAccounts(search: string, limit = 8) {
  await ensureRequestSchema();
  const term = search.trim().toLowerCase();
  if (term.length < 2) {
    return [] as RegisteredCandidateAccount[];
  }

  const result = await query<{
    id: string;
    name: string;
    email: string;
    first_name: string | null;
    last_name: string | null;
    role: string;
  }>(
    `select id, name, email, first_name, last_name, role
     from users
     where role = 'employee'
       and (
         lower(email) like $1
         or lower(name) like $1
         or lower(coalesce(first_name, '')) like $1
         or lower(coalesce(last_name, '')) like $1
       )
     order by name asc
     limit $2`,
    [`%${term}%`, Math.min(Math.max(limit, 1), 20)],
  );

  return result.rows.map((row) => ({
    id: row.id,
    email: normalizeEmail(row.email),
    name: displayAccountName(row),
    firstName: String(row.first_name || "").trim(),
    lastName: String(row.last_name || "").trim(),
    role: row.role,
  }));
}

export async function expireStaleRequests() {
  await ensureRequestSchema();
  await withTransaction(async (client) => {
    const expired = await client.query<{ id: string; status: RequestStatus }>(
      `update document_requests
       set status = 'expired', access_token = null, updated_at = now()
       where status = any($1::text[]) and expires_at <= now()
       returning id, status`,
      [activeRequestStatuses],
    );

    for (const request of expired.rows) {
      await client.query(
        `update request_secure_tokens
         set invalidated_at = coalesce(invalidated_at, now()),
             invalidation_reason = coalesce(invalidation_reason, 'expired')
         where request_id = $1 and invalidated_at is null`,
        [request.id],
      );
      await client.query(
        `insert into request_status_history
          (request_id, from_status, to_status, changed_by_type, note)
         values ($1, null, 'expired', 'system', 'Link expiration reached')`,
        [request.id],
      );
    }
  });
}

export async function createDocumentRequest(
  input: CreateDocumentRequestInput,
  hrUserId?: string,
) {
  await ensureRequestSchema();
  await expireStaleRequests();

  const labels = Array.from(new Set([
    ...input.documentLabels.filter(Boolean),
    ...input.customDocuments.map((value) => value.trim()).filter(Boolean),
  ]));

  const accountResult = await resolveRegisteredCandidateAccount({
    candidateEmail: input.candidateEmail,
    candidateUserId: input.candidateUserId,
  });
  if (!accountResult.ok) {
    return {
      ok: false as const,
      status: accountResult.status,
      message: accountResult.message,
    };
  }

  const candidateEmail = accountResult.account.email;
  const candidateName =
    String(input.candidateName || "").trim() || accountResult.account.name;

  if (!candidateName) {
    return { ok: false as const, status: 400, message: "Candidate name is required." };
  }

  if (!labels.length) {
    return {
      ok: false as const,
      status: 400,
      message: "Select at least one document for the request.",
    };
  }

  const expiresAt = resolveExpiration(input);
  if (!expiresAt) {
    return {
      ok: false as const,
      status: 400,
      message: "Select a valid future expiration date and time.",
    };
  }

  const token = randomBytes(32).toString("base64url");
  const tokenHash = hashRequestToken(token);
  const predefinedSet = new Set<string>(documentTypes);
  const created = await withTransaction(async (client) => {
    if (input.replaceRequestId && hrUserId) {
      const replaced = await client.query<{ id: string; status: RequestStatus }>(
        `update document_requests
         set status = 'cancelled', cancelled_at = now(), access_token = null, updated_at = now()
         where id = $1 and created_by_hr_id = $2 and status = any($3::text[])
         returning id, status`,
        [input.replaceRequestId, hrUserId, activeRequestStatuses],
      );
      if (replaced.rowCount) {
        await client.query(
          `update request_secure_tokens
           set invalidated_at = coalesce(invalidated_at, now()),
               invalidation_reason = coalesce(invalidation_reason, 'replaced')
           where request_id = $1 and invalidated_at is null`,
          [input.replaceRequestId],
        );
        await client.query(
          `insert into request_status_history
            (request_id, from_status, to_status, changed_by_type, changed_by_id, note)
           values ($1, $2, 'cancelled', 'hr', $3, 'Replaced by a new Send Request action')`,
          [input.replaceRequestId, replaced.rows[0].status, hrUserId],
        );
      }
    }

    const requestResult = await client.query<RequestRow>(
      `insert into document_requests
        (token_hash, access_token, candidate_name, candidate_email, status, expires_at,
         created_by_hr_id, sent_at)
       values ($1, $2, $3, $4, 'sent', $5, $6, now())
       returning *`,
      [
        tokenHash,
        token,
        candidateName,
        candidateEmail,
        expiresAt,
        hrUserId || null,
      ],
    );
    const createdRequest = requestResult.rows[0];
    const tokenResult = await client.query<{ id: string }>(
      `insert into request_secure_tokens
        (request_id, token_hash, expires_at, created_by_hr_id)
       values ($1, $2, $3, $4)
       returning id`,
      [createdRequest.id, tokenHash, expiresAt, hrUserId || null],
    );
    const tokenId = tokenResult.rows[0].id;
    await client.query(
      "update document_requests set current_token_id = $1 where id = $2",
      [tokenId, createdRequest.id],
    );

    for (const [index, label] of labels.entries()) {
      await client.query(
        `insert into document_request_items
          (request_id, document_label, is_custom, sort_order)
         values ($1, $2, $3, $4)`,
        [createdRequest.id, label, !predefinedSet.has(label as DocumentType), index],
      );
    }

    await client.query(
      `insert into request_status_history
        (request_id, from_status, to_status, changed_by_type, changed_by_id, note)
       values ($1, 'draft', 'sent', 'hr', $2, 'Secure request link generated')`,
      [createdRequest.id, hrUserId || null],
    );
    await client.query(
      `insert into audit_logs
        (actor_type, actor_id, action, entity_type, entity_id, metadata)
       values ('hr', $1, 'request.sent', 'document_request', $2, $3::jsonb)`,
      [
        hrUserId || null,
        createdRequest.id,
        JSON.stringify({
          candidateEmail,
          candidateUserId: accountResult.account.id,
          documentCount: labels.length,
          expiresAt,
        }),
      ],
    );

    return { request: { ...createdRequest, current_token_id: tokenId }, tokenId };
  });

  const items = await loadRequestItems(created.request.id);
  const requestLink = `${input.userPortalUrl.replace(/\/$/, "")}/request/${token}`;

  return {
    ok: true as const,
    status: 201,
    request: toRequestRecord(created.request, items, requestLink),
    tokenId: created.tokenId,
    token,
    requestLink,
    recipientEmail: candidateEmail,
    candidateUserId: accountResult.account.id,
    message: "Document request created and ready to email.",
  };
}

export async function listDocumentRequests(options: {
  search?: string;
  status?: DisplayRequestStatus | "all";
  sortBy?: "name" | "requestDate" | "expiryDate";
  sortDirection?: "asc" | "desc";
  page?: number;
  pageSize?: number;
  userPortalUrl?: string;
  hrUserId?: string;
}) {
  await ensureRequestSchema();
  await expireStaleRequests();

  const requestedPage = Number.isFinite(options.page) ? Number(options.page) : 1;
  const requestedPageSize = Number.isFinite(options.pageSize) ? Number(options.pageSize) : 10;
  const page = Math.max(1, Math.floor(requestedPage));
  const pageSize = Math.min(100, Math.max(1, Math.floor(requestedPageSize)));
  const offset = (page - 1) * pageSize;
  const filters: string[] = [];
  const values: unknown[] = [];

  if (options.hrUserId) {
    values.push(options.hrUserId);
    filters.push(`created_by_hr_id = $${values.length}`);
  }

  if (options.search?.trim()) {
    values.push(`%${options.search.trim().toLowerCase()}%`);
    filters.push(
      `(lower(candidate_name) like $${values.length}
        or lower(candidate_email) like $${values.length}
        or lower(id::text) like $${values.length})`,
    );
  }

  if (options.status && options.status !== "all") {
    const matchingStatuses: RequestStatus[] =
      options.status === "pending"
        ? activeRequestStatuses
        : options.status === "submitted"
          ? ["submitted", "completed"]
          : ["expired", "cancelled"];
    values.push(matchingStatuses);
    filters.push(`status = any($${values.length}::text[])`);
  }

  const whereClause = filters.length ? `where ${filters.join(" and ")}` : "";
  const sortColumn =
    options.sortBy === "name"
      ? "candidate_name"
      : options.sortBy === "expiryDate"
        ? "expires_at"
        : "created_at";
  const sortDirection = options.sortDirection === "asc" ? "asc" : "desc";

  const countResult = await query<{ count: string }>(
    `select count(*)::text as count from document_requests ${whereClause}`,
    values,
  );

  const listValues = [...values, pageSize, offset];
  const result = await query<RequestRow>(
    `select * from document_requests
     ${whereClause}
     order by ${sortColumn} ${sortDirection}
     limit $${listValues.length - 1} offset $${listValues.length}`,
    listValues,
  );

  const userPortalUrl = options.userPortalUrl?.replace(/\/$/, "");

  const requests = await Promise.all(
    result.rows.map(async (row) => {
      const items = await loadRequestItems(row.id);
      const emailStatus = await loadLatestEmailStatus(row.id);
      const requestLink =
        userPortalUrl && row.access_token && activeRequestStatuses.includes(row.status)
          ? `${userPortalUrl}/request/${row.access_token}`
          : undefined;
      return { ...toRequestRecord(row, items, requestLink), emailStatus };
    }),
  );

  return {
    requests,
    total: Number(countResult.rows[0]?.count || 0),
    page,
    pageSize,
  };
}

export async function searchDocumentRequests(
  search: string,
  limit = 8,
  hrUserId?: string,
) {
  await ensureRequestSchema();
  await expireStaleRequests();

  const term = search.trim().toLowerCase();
  if (term.length < 2) {
    return [];
  }

  const values: unknown[] = [`%${term}%`];
  let ownerFilter = "";
  if (hrUserId) {
    values.push(hrUserId);
    ownerFilter = `and dr.created_by_hr_id = $${values.length}`;
  }
  values.push(Math.min(20, Math.max(1, limit)));

  const result = await query<{
    id: string;
    candidate_name: string;
    candidate_email: string;
    status: RequestStatus;
    created_at: Date | string;
    documents: string[];
  }>(
    `select
       dr.id,
       dr.candidate_name,
       dr.candidate_email,
       dr.status,
       dr.created_at,
       coalesce(
         array_agg(distinct dri.document_label) filter (where dri.document_label is not null),
         array[]::text[]
       ) as documents
     from document_requests dr
     left join document_request_items dri on dri.request_id = dr.id
     where (
        lower(dr.candidate_name) like $1
        or lower(dr.candidate_email) like $1
        or lower(dr.id::text) like $1
        or lower(coalesce(dri.document_label, '')) like $1
     )
     ${ownerFilter}
     group by dr.id
     order by dr.created_at desc
     limit $${values.length}`,
    values,
  );

  return result.rows.map((row) => ({
    id: row.id,
    candidateName: row.candidate_name,
    candidateEmail: row.candidate_email,
    status: toDisplayStatus(row.status),
    createdAt: toIso(row.created_at),
    documents: row.documents,
  }));
}

function toDisplayStatus(status: RequestStatus): DisplayRequestStatus {
  if (status === "submitted" || status === "completed") {
    return "submitted";
  }

  if (status === "expired" || status === "cancelled") {
    return "expired";
  }

  return "pending";
}

export async function getDocumentRequestById(id: string, hrUserId?: string) {
  await ensureRequestSchema();
  await expireStaleRequests();

  const values: unknown[] = [id];
  let ownerFilter = "";
  if (hrUserId) {
    values.push(hrUserId);
    ownerFilter = `and created_by_hr_id = $${values.length}`;
  }

  const result = await query<RequestRow>(
    `select * from document_requests where id = $1 ${ownerFilter}`,
    values,
  );
  const row = result.rows[0];

  if (!row) {
    return null;
  }

  const items = await loadRequestItems(row.id);
  const emailStatus = await loadLatestEmailStatus(row.id);
  return { ...toRequestRecord(row, items, buildRequestLink(row)), emailStatus };
}

export async function getDocumentRequestByToken(token: string) {
  await ensureRequestSchema();
  await expireStaleRequests();

  const result = await query<
    RequestRow & {
      secure_token_id: string;
      token_invalidated_at?: Date | string | null;
      token_invalidation_reason?: string | null;
      token_used_at?: Date | string | null;
      token_expires_at: Date | string;
    }
  >(
    `select requests.*,
            tokens.id as secure_token_id,
            tokens.invalidated_at as token_invalidated_at,
            tokens.invalidation_reason as token_invalidation_reason,
            tokens.used_at as token_used_at,
            tokens.expires_at as token_expires_at
     from request_secure_tokens tokens
     join document_requests requests on requests.id = tokens.request_id
     where tokens.token_hash = $1`,
    [hashRequestToken(token)],
  );
  const row = result.rows[0];

  if (!row) {
    return null;
  }

  if (
    row.current_token_id &&
    row.current_token_id !== row.secure_token_id &&
    !["submitted", "expired"].includes(row.token_invalidation_reason || "")
  ) {
    return null;
  }

  const tokenExpired =
    Boolean(row.token_invalidated_at) ||
    Boolean(row.token_used_at) ||
    new Date(row.token_expires_at).getTime() <= Date.now() ||
    new Date(row.expires_at).getTime() <= Date.now();

  if (activeRequestStatuses.includes(row.status) && tokenExpired) {
    await withTransaction(async (client) => {
      await client.query(
        `update document_requests
         set status = 'expired', access_token = null, updated_at = now()
         where id = $1 and status = any($2::text[])`,
        [row.id, activeRequestStatuses],
      );
      await client.query(
        `update request_secure_tokens
         set invalidated_at = coalesce(invalidated_at, now()),
             invalidation_reason = coalesce(invalidation_reason, 'expired')
         where request_id = $1 and invalidated_at is null`,
        [row.id],
      );
    });
    row.status = "expired";
    row.access_token = null;
  }

  if (row.status === "sent" || row.status === "delivered") {
    await withTransaction(async (client) => {
      const viewed = await client.query<{ status: RequestStatus }>(
        `update document_requests
         set status = 'viewed', viewed_at = coalesce(viewed_at, now()), updated_at = now()
         where id = $1 and status in ('sent', 'delivered')
         returning status`,
        [row.id],
      );
      if (viewed.rowCount) {
        await client.query(
          `insert into request_status_history
            (request_id, from_status, to_status, changed_by_type, note)
           values ($1, $2, 'viewed', 'candidate', 'Secure request link opened')`,
          [row.id, row.status],
        );
      }
    });
    row.status = "viewed";
  }

  const items = await loadRequestItems(row.id);
  return toRequestRecord(row, items);
}

export async function cancelDocumentRequest(id: string, hrUserId?: string) {
  await ensureRequestSchema();
  return withTransaction(async (client) => {
    const existing = await client.query<RequestRow>(
      `select * from document_requests
       where id = $1
         ${hrUserId ? "and created_by_hr_id = $2" : ""}
       for update`,
      hrUserId ? [id, hrUserId] : [id],
    );
    const current = existing.rows[0];
    if (!current || !activeRequestStatuses.includes(current.status)) {
      return {
        ok: false as const,
        status: 404,
        message: "Request not found or cannot be cancelled.",
      };
    }

    const result = await client.query<RequestRow>(
      `update document_requests
       set status = 'cancelled', cancelled_at = now(), access_token = null, updated_at = now()
       where id = $1
       returning *`,
      [id],
    );
    await client.query(
      `update request_secure_tokens
       set invalidated_at = coalesce(invalidated_at, now()),
           invalidation_reason = coalesce(invalidation_reason, 'cancelled')
       where request_id = $1 and invalidated_at is null`,
      [id],
    );
    await client.query(
      `insert into request_status_history
        (request_id, from_status, to_status, changed_by_type, note)
       values ($1, $2, 'cancelled', 'hr', 'Request cancelled by HR')`,
      [id, current.status],
    );
    await client.query(
      `insert into audit_logs
        (actor_type, action, entity_type, entity_id)
       values ('hr', 'request.cancelled', 'document_request', $1)`,
      [id],
    );

    const row = result.rows[0];
    const items = await loadRequestItems(row.id);
    return {
      ok: true as const,
      status: 200,
      request: toRequestRecord(row, items),
      message: "Request cancelled successfully.",
    };
  });
}

export async function resendDocumentRequest(
  id: string,
  input: { userPortalUrl: string },
  hrUserId?: string,
) {
  await ensureRequestSchema();
  await expireStaleRequests();
  const result = await query<RequestRow>(
    `select * from document_requests
     where id = $1
       ${hrUserId ? "and created_by_hr_id = $2" : ""}`,
    hrUserId ? [id, hrUserId] : [id],
  );
  const request = result.rows[0];

  if (
    !request ||
    !activeRequestStatuses.includes(request.status) ||
    !request.access_token ||
    new Date(request.expires_at).getTime() <= Date.now()
  ) {
    return {
      ok: false as const,
      status: 400,
      message: "Only an active request email can be resent. Create a new request if it expired.",
    };
  }

  const items = await loadRequestItems(request.id);
  const requestLink = `${input.userPortalUrl.replace(/\/$/, "")}/request/${request.access_token}`;
  return {
    ok: true as const,
    status: 200,
    request: toRequestRecord(request, items, requestLink),
    tokenId: request.current_token_id || undefined,
    requestLink,
    message: "Request email is ready to resend using the existing secure link.",
  };
}

export async function recordCandidateEmailDelivery(input: {
  requestId: string;
  tokenId?: string;
  recipientEmail: string;
  result:
    | { ok: true; provider: "brevo" | "resend" | "development"; messageId?: string }
    | { ok: false; provider: "none" | "brevo" | "resend" | "development"; error: string };
}) {
  await ensureRequestSchema();
  return withTransaction(async (client) => {
    const deliveryStatus = input.result.ok
      ? "sent"
      : input.result.provider === "none"
        ? "unconfigured"
        : "failed";
    await client.query(
      `insert into request_email_deliveries
        (request_id, token_id, email_type, recipient_email, status, provider,
         provider_message_id, error_message, sent_at)
       values ($1, $2, 'candidate_request', $3, $4, $5, $6, $7, $8)`,
      [
        input.requestId,
        input.tokenId || null,
        normalizeEmail(input.recipientEmail),
        deliveryStatus,
        input.result.provider,
        input.result.ok ? input.result.messageId || null : null,
        input.result.ok ? null : input.result.error,
        input.result.ok ? new Date() : null,
      ],
    );

    if (input.result.ok) {
      const updated = await client.query(
        `update document_requests
         set status = 'delivered',
             delivered_at = coalesce(delivered_at, now()),
             updated_at = now()
         where id = $1 and status = 'sent'`,
        [input.requestId],
      );
      if (updated.rowCount) {
        await client.query(
          `insert into request_status_history
            (request_id, from_status, to_status, changed_by_type, note)
           values ($1, 'sent', 'delivered', 'system', 'Email accepted by delivery provider')`,
          [input.requestId],
        );
      }
    }

    await client.query(
      `insert into audit_logs
        (actor_type, action, entity_type, entity_id, metadata)
       values ('system', $1, 'document_request', $2, $3::jsonb)`,
      [
        input.result.ok ? "email.candidate_sent" : "email.candidate_failed",
        input.requestId,
        JSON.stringify({
          recipient: normalizeEmail(input.recipientEmail),
          provider: input.result.provider,
        }),
      ],
    );
  });
}

export async function completeDocumentRequest(id: string, hrUserId: string) {
  await ensureRequestSchema();
  return withTransaction(async (client) => {
    const existing = await client.query<RequestRow>(
      `select * from document_requests
       where id = $1 and created_by_hr_id = $2
       for update`,
      [id, hrUserId],
    );
    const current = existing.rows[0];
    if (!current || current.status !== "submitted") {
      return {
        ok: false as const,
        status: 400,
        message: "Only a submitted request can be marked completed.",
      };
    }

    const updated = await client.query<RequestRow>(
      `update document_requests
       set status = 'completed', completed_at = now(), updated_at = now()
       where id = $1
       returning *`,
      [id],
    );
    await client.query(
      `insert into request_status_history
        (request_id, from_status, to_status, changed_by_type, changed_by_id, note)
       values ($1, 'submitted', 'completed', 'hr', $2, 'Submission reviewed by HR')`,
      [id, hrUserId],
    );
    await client.query(
      `insert into audit_logs
        (actor_type, actor_id, action, entity_type, entity_id)
       values ('hr', $1, 'request.completed', 'document_request', $2)`,
      [hrUserId, id],
    );

    const items = await loadRequestItems(id);
    return {
      ok: true as const,
      status: 200,
      message: "Request marked as completed.",
      request: toRequestRecord(updated.rows[0], items),
    };
  });
}

export async function submitDocumentRequest(input: SubmitDocumentRequestInput) {
  await ensureRequestSchema();
  await expireStaleRequests();

  const request = await getDocumentRequestByToken(input.token);

  if (!request) {
    return { ok: false as const, status: 404, message: "This request link is invalid." };
  }

  if (request.status === "expired") {
    return {
      ok: false as const,
      status: 410,
      message: "This request link has expired. Please contact HR for a new link.",
    };
  }

  if (request.status === "submitted") {
    return {
      ok: false as const,
      status: 409,
      message: "Documents have already been submitted for this request.",
    };
  }

  if (normalizeEmail(input.userEmail) !== request.candidateEmail) {
    return {
      ok: false as const,
      status: 403,
      message: "Sign in with the email address that received this request.",
    };
  }

  if (input.submissions.length !== request.items.length) {
    return {
      ok: false as const,
      status: 400,
      message: "Please provide a document for every requested item.",
    };
  }

  const itemIds = new Set(request.items.map((item) => item.id));
  const submittedItemIds = new Set(input.submissions.map((submission) => submission.itemId));
  if (submittedItemIds.size !== request.items.length) {
    return {
      ok: false as const,
      status: 400,
      message: "Each requested item must have exactly one document.",
    };
  }

  for (const submission of input.submissions) {
    if (!itemIds.has(submission.itemId)) {
      return { ok: false as const, status: 400, message: "Invalid request item submitted." };
    }
  }

  return withTransaction(async (client) => {
    const lockedResult = await client.query<RequestRow>(
      "select * from document_requests where id = $1 for update",
      [request.id],
    );
    const lockedRequest = lockedResult.rows[0];

    if (!lockedRequest || !activeRequestStatuses.includes(lockedRequest.status)) {
      return {
        ok: false as const,
        status: 409,
        message: "This request is no longer available for submission.",
      };
    }

    if (new Date(lockedRequest.expires_at).getTime() <= Date.now()) {
      await client.query(
        `update document_requests
         set status = 'expired', updated_at = now()
         where id = $1`,
        [request.id],
      );
      return {
        ok: false as const,
        status: 410,
        message: "This request link has expired. Please contact HR for a new link.",
      };
    }

    const documents: Array<{ id: string; file_name: string; itemId: string }> = [];
    for (const submission of input.submissions) {
      const documentResult = await client.query<{ id: string; file_name: string }>(
        "select id, file_name from documents where id = $1 and user_id = $2",
        [submission.documentId, input.userId],
      );
      const document = documentResult.rows[0];

      if (!document) {
        return {
          ok: false as const,
          status: 400,
          message: "One or more selected documents could not be found in your vault.",
        };
      }

      documents.push({ ...document, itemId: submission.itemId });
    }

    for (const document of documents) {
      await client.query(
        `update document_request_items
         set submitted_document_id = $1, submitted_file_name = $2
         where id = $3 and request_id = $4`,
        [document.id, document.file_name, document.itemId, request.id],
      );
    }

    const updated = await client.query<RequestRow>(
      `update document_requests
       set status = 'submitted', submitted_at = now(), updated_at = now()
       where id = $1
       returning *`,
      [request.id],
    );
    const itemsResult = await client.query<ItemRow>(
      `select id, request_id, document_label, is_custom, sort_order,
              submitted_document_id, submitted_file_name
       from document_request_items
       where request_id = $1
       order by sort_order asc, created_at asc`,
      [request.id],
    );
    const items = itemsResult.rows.map(toDocumentRequestItem);

    return {
      ok: true as const,
      status: 200,
      request: toRequestRecord(updated.rows[0], items),
      message: "Your documents were submitted successfully.",
    };
  });
}

export async function getDashboardStats(hrUserId?: string) {
  await ensureRequestSchema();
  await expireStaleRequests();

  const values: unknown[] = [];
  let ownerFilter = "";
  if (hrUserId) {
    values.push(hrUserId);
    ownerFilter = `where created_by_hr_id = $1`;
  }

  const result = await query<{
    total: string;
    pending: string;
    submitted: string;
    expired: string;
    active: string;
  }>(
    `
    select
      count(*)::text as total,
      count(*) filter (
        where status in ('sent', 'delivered', 'viewed', 'in_progress')
      )::text as pending,
      count(*) filter (where status in ('submitted', 'completed'))::text as submitted,
      count(*) filter (where status = 'expired')::text as expired,
      count(*) filter (
        where status in ('sent', 'delivered', 'viewed', 'in_progress') and expires_at > now()
      )::text as active
    from document_requests
    ${ownerFilter}
  `,
    values,
  );

  const stats = result.rows[0];
  const recentResult = await listDocumentRequests({
    sortBy: "requestDate",
    sortDirection: "desc",
    page: 1,
    pageSize: 6,
    hrUserId,
    userPortalUrl: (
      process.env.NEXT_PUBLIC_USER_PORTAL_URL ||
      process.env.NEXT_PUBLIC_APP_URL ||
      "http://localhost:3000"
    ).replace(/\/$/, ""),
  });

  return {
    total: Number(stats.total),
    pending: Number(stats.pending),
    submitted: Number(stats.submitted),
    expired: Number(stats.expired),
    active: Number(stats.active),
    recentActivity: recentResult.requests,
  };
}

export async function getSubmittedDocumentForDownload(
  requestId: string,
  documentId: string,
  hrUserId?: string,
) {
  await ensureRequestSchema();
  const values: unknown[] = [requestId, documentId];
  let ownerFilter = "";
  if (hrUserId) {
    values.push(hrUserId);
    ownerFilter = `and requests.created_by_hr_id = $${values.length}`;
  }

  const result = await query<{
    document_label: string;
    file_data: string;
    file_mime_type: string | null;
    file_name: string;
    original_file_name: string | null;
  }>(
    `select request_items.document_label,
            documents.file_data,
            documents.file_mime_type,
            documents.file_name,
            documents.original_file_name
     from document_requests requests
     join document_request_items request_items on request_items.request_id = requests.id
     join documents on documents.id = request_items.submitted_document_id
     where requests.id = $1
       and requests.status in ('submitted', 'completed')
       and documents.id = $2
       ${ownerFilter}`,
    values,
  );
  const file = result.rows[0];

  if (!file) {
    return null;
  }

  return {
    label: file.document_label,
    documentId,
    fileName: file.original_file_name || file.file_name,
    mimeType: file.file_mime_type,
    data: Buffer.from(file.file_data, "base64"),
  };
}

async function loadRequestItems(requestId: string) {
  const result = await query<ItemRow>(
    `select id, request_id, document_label, is_custom, sort_order,
            submitted_document_id, submitted_file_name
     from document_request_items
     where request_id = $1
     order by sort_order asc, created_at asc`,
    [requestId],
  );

  return result.rows.map(toDocumentRequestItem);
}

async function loadLatestEmailStatus(requestId: string) {
  const result = await query<{ status: "sent" | "failed" | "unconfigured" }>(
    `select status
     from request_email_deliveries
     where request_id = $1 and email_type = 'candidate_request'
     order by attempted_at desc
     limit 1`,
    [requestId],
  );
  return result.rows[0]?.status;
}

function toDocumentRequestItem(row: ItemRow): DocumentRequestItem {
  return {
    id: row.id,
    documentLabel: row.document_label,
    isCustom: row.is_custom,
    sortOrder: row.sort_order,
    submittedDocumentId: row.submitted_document_id || undefined,
    submittedFileName: row.submitted_file_name || undefined,
  };
}

function toRequestRecord(
  row: RequestRow,
  items: DocumentRequestItem[],
  requestLink?: string,
): DocumentRequestRecord {
  return {
    id: row.id,
    candidateName: row.candidate_name,
    candidateEmail: row.candidate_email,
    status: toDisplayStatus(row.status),
    expiresAt: toIso(row.expires_at),
    createdAt: toIso(row.created_at),
    submittedAt: row.submitted_at ? toIso(row.submitted_at) : undefined,
    cancelledAt: row.cancelled_at ? toIso(row.cancelled_at) : undefined,
    completedAt: row.completed_at ? toIso(row.completed_at) : undefined,
    items,
    requestLink,
  };
}

function toIso(value: Date | string) {
  return new Date(value).toISOString();
}

function buildRequestLink(row: RequestRow) {
  const userPortalUrl = (
    process.env.NEXT_PUBLIC_USER_PORTAL_URL ||
    process.env.NEXT_PUBLIC_APP_URL ||
    "http://localhost:3000"
  ).replace(/\/$/, "");

  if (!row.access_token || !activeRequestStatuses.includes(row.status)) {
    return undefined;
  }

  return `${userPortalUrl}/request/${row.access_token}`;
}

function resolveExpiration(input: CreateDocumentRequestInput) {
  let expiresAt: Date;

  if (input.expiresAt) {
    expiresAt = new Date(input.expiresAt);
  } else if (input.expiryHours && expiryHourOptions.includes(input.expiryHours)) {
    expiresAt = new Date(Date.now() + input.expiryHours * 60 * 60 * 1000);
  } else {
    return null;
  }

  const minimum = Date.now() + 5 * 60 * 1000;
  const maximum = Date.now() + 365 * 24 * 60 * 60 * 1000;
  if (!Number.isFinite(expiresAt.getTime()) || expiresAt.getTime() < minimum || expiresAt.getTime() > maximum) {
    return null;
  }

  return expiresAt;
}
