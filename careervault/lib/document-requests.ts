import { createHash, randomBytes } from "node:crypto";
import { documentTypes, type DocumentType } from "@/lib/careervault-data";
import { ensureDatabaseSchema, query, withTransaction } from "@/lib/database";
import { buildHrSubmissionEmail, sendRequestEmail } from "@/lib/request-email";

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
  items: DocumentRequestItem[];
  requestLink?: string;
};

export type CreateDocumentRequestInput = {
  candidateName: string;
  candidateEmail: string;
  documentLabels: string[];
  customDocuments: string[];
  expiryHours?: number;
  expiresAt?: string;
  userPortalUrl: string;
};

export type SubmitDocumentRequestInput = {
  token: string;
  userId: string;
  userEmail: string;
  submissions: Array<{ itemId: string; documentId: string }>;
};

export const defaultExpiryHours = 168;
export const expiryHourOptions = [24, 72, 168, 360, 720];

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

type TokenRequestRow = RequestRow & {
  secure_token_id: string;
  token_invalidated_at: Date | string | null;
  token_invalidation_reason: string | null;
  token_used_at: Date | string | null;
  token_expires_at: Date | string;
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

export async function expireStaleRequests() {
  await ensureRequestSchema();
  await withTransaction(async (client) => {
    const expired = await client.query<{ id: string }>(
      `update document_requests
       set status = 'expired', access_token = null, updated_at = now()
       where status = any($1::text[]) and expires_at <= now()
       returning id`,
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
          (request_id, to_status, changed_by_type, note)
         values ($1, 'expired', 'system', 'Link expiration reached')`,
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

  if (!input.candidateName.trim()) {
    return { ok: false as const, status: 400, message: "Candidate name is required." };
  }

  const candidateEmail = normalizeEmail(input.candidateEmail);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(candidateEmail)) {
    return { ok: false as const, status: 400, message: "Enter a valid candidate email." };
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
    const requestResult = await client.query<RequestRow>(
      `insert into document_requests
        (token_hash, access_token, candidate_name, candidate_email, status, expires_at,
         created_by_hr_id, sent_at)
       values ($1, $2, $3, $4, 'sent', $5, $6, now())
       returning *`,
      [
        tokenHash,
        token,
        input.candidateName.trim(),
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
    message: "Document request created successfully.",
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
}) {
  await ensureRequestSchema();
  await expireStaleRequests();

  const requestedPage = Number.isFinite(options.page) ? Number(options.page) : 1;
  const requestedPageSize = Number.isFinite(options.pageSize) ? Number(options.pageSize) : 10;
  const page = Math.max(1, Math.floor(requestedPage));
  const pageSize = Math.min(50, Math.max(1, Math.floor(requestedPageSize)));
  const offset = (page - 1) * pageSize;
  const filters: string[] = [];
  const values: unknown[] = [];

  if (options.search?.trim()) {
    values.push(`%${options.search.trim().toLowerCase()}%`);
    filters.push(
      `(lower(candidate_name) like $${values.length} or lower(candidate_email) like $${values.length})`,
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
      const requestLink =
        userPortalUrl && row.access_token && activeRequestStatuses.includes(row.status)
          ? `${userPortalUrl}/request/${row.access_token}`
          : undefined;
      return toRequestRecord(row, items, requestLink);
    }),
  );

  return {
    requests,
    total: Number(countResult.rows[0]?.count || 0),
    page,
    pageSize,
  };
}

export async function getDocumentRequestById(id: string) {
  await ensureRequestSchema();
  await expireStaleRequests();

  const result = await query<RequestRow>("select * from document_requests where id = $1", [id]);
  const row = result.rows[0];

  if (!row) {
    return null;
  }

  const items = await loadRequestItems(row.id);
  return toRequestRecord(row, items, buildRequestLink(row));
}

export async function getDocumentRequestByToken(token: string) {
  await ensureRequestSchema();
  await expireStaleRequests();

  const result = await query<TokenRequestRow>(
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
      await client.query(
        `insert into request_status_history
          (request_id, from_status, to_status, changed_by_type, note)
         values ($1, $2, 'expired', 'system', 'Secure request link expired')`,
        [row.id, row.status],
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
        await client.query(
          `insert into audit_logs
            (actor_type, action, entity_type, entity_id)
           values ('candidate', 'request.viewed', 'document_request', $1)`,
          [row.id],
        );
      }
    });
    row.status = "viewed";
  }

  const items = await loadRequestItems(row.id);
  return toRequestRecord(row, items);
}

export async function markDocumentRequestInProgress(input: {
  token: string;
  userId: string;
  userEmail: string;
}) {
  await ensureRequestSchema();
  const request = await getDocumentRequestByToken(input.token);
  if (!request) {
    return { ok: false as const, status: 404, message: "This request link is invalid." };
  }
  if (normalizeEmail(input.userEmail) !== request.candidateEmail) {
    return {
      ok: false as const,
      status: 403,
      message: "Sign in with the email address that received this request.",
    };
  }
  if (request.status !== "pending") {
    return { ok: false as const, status: 409, message: "This request is no longer active." };
  }

  await withTransaction(async (client) => {
    const updated = await client.query(
      `update document_requests
       set status = 'in_progress', in_progress_at = coalesce(in_progress_at, now()), updated_at = now()
       where id = $1 and status in ('sent', 'delivered', 'viewed')`,
      [request.id],
    );
    if (updated.rowCount) {
      await client.query(
        `insert into request_status_history
          (request_id, from_status, to_status, changed_by_type, changed_by_id, note)
         values ($1, $2, 'in_progress', 'candidate', $3, 'Candidate selected a document')`,
        [request.id, "pending", input.userId],
      );
    }
  });

  return { ok: true as const, status: 200, message: "Request marked in progress." };
}

export async function cancelDocumentRequest(id: string) {
  await ensureRequestSchema();
  const result = await query<RequestRow>(
    `update document_requests
     set status = 'cancelled', cancelled_at = now(), access_token = null, updated_at = now()
     where id = $1 and status = any($2::text[])
     returning *`,
    [id, activeRequestStatuses],
  );

  const row = result.rows[0];
  if (!row) {
    return {
      ok: false as const,
      status: 404,
      message: "Request not found or cannot be cancelled.",
    };
  }

  await query(
    `update request_secure_tokens
     set invalidated_at = coalesce(invalidated_at, now()),
         invalidation_reason = coalesce(invalidation_reason, 'cancelled')
     where request_id = $1 and invalidated_at is null`,
    [id],
  );

  const items = await loadRequestItems(row.id);
  return {
    ok: true as const,
    status: 200,
    request: toRequestRecord(row, items),
    message: "Request cancelled successfully.",
  };
}

export async function resendDocumentRequest(
  id: string,
  input: { userPortalUrl: string },
) {
  await ensureRequestSchema();
  await expireStaleRequests();
  const result = await query<RequestRow>(
    "select * from document_requests where id = $1",
    [id],
  );
  const request = result.rows[0];
  if (!request || !activeRequestStatuses.includes(request.status) || !request.access_token) {
    return {
      ok: false as const,
      status: 400,
      message: "Only an active request email can be resent.",
    };
  }

  const items = await loadRequestItems(request.id);
  const requestLink = `${input.userPortalUrl.replace(/\/$/, "")}/request/${request.access_token}`;
  return {
    ok: true as const,
    status: 200,
    request: toRequestRecord(request, items, requestLink),
    requestLink,
    message: "Request email is ready to resend using the existing secure link.",
  };
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

  if (request.status !== "pending") {
    return {
      ok: false as const,
      status: 409,
      message: "This request is no longer available for submission.",
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

  const submissionResult = await withTransaction(async (client) => {
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

    const tokenResult = await client.query<{ id: string }>(
      `select id
       from request_secure_tokens
       where request_id = $1
         and token_hash = $2
         and invalidated_at is null
         and used_at is null
         and expires_at > now()
       for update`,
      [request.id, hashRequestToken(input.token)],
    );
    const secureToken = tokenResult.rows[0];
    if (!secureToken || secureToken.id !== lockedRequest.current_token_id) {
      return {
        ok: false as const,
        status: 409,
        message: "This secure link is no longer active.",
      };
    }

    if (new Date(lockedRequest.expires_at).getTime() <= Date.now()) {
      await client.query(
        `update document_requests
         set status = 'expired', access_token = null, updated_at = now()
         where id = $1`,
        [request.id],
      );
      await client.query(
        `update request_secure_tokens
         set invalidated_at = coalesce(invalidated_at, now()),
             invalidation_reason = coalesce(invalidation_reason, 'expired')
         where request_id = $1 and invalidated_at is null`,
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
         set submitted_document_id = $1, submitted_file_name = $2, submitted_at = now()
         where id = $3 and request_id = $4`,
        [document.id, document.file_name, document.itemId, request.id],
      );
    }

    const updated = await client.query<RequestRow>(
      `update document_requests
       set status = 'submitted', submitted_at = now(), access_token = null, updated_at = now()
       where id = $1
       returning *`,
      [request.id],
    );
    await client.query(
      `update request_secure_tokens
       set used_at = now(), invalidated_at = now(), invalidation_reason = 'submitted'
       where id = $1`,
      [secureToken.id],
    );
    await client.query(
      `insert into request_status_history
        (request_id, from_status, to_status, changed_by_type, changed_by_id, note)
       values ($1, $2, 'submitted', 'candidate', $3, 'All requested documents submitted')`,
      [request.id, lockedRequest.status, input.userId],
    );
    await client.query(
      `insert into audit_logs
        (actor_type, actor_id, action, entity_type, entity_id, metadata)
       values ('candidate', $1, 'request.submitted', 'document_request', $2, $3::jsonb)`,
      [
        input.userId,
        request.id,
        JSON.stringify({ documentCount: documents.length }),
      ],
    );
    const hrResult = await client.query<{ id: string; name: string; email: string }>(
      `select hr_users.id, hr_users.name, hr_users.email
       from document_requests
       join hr_users on hr_users.id = document_requests.created_by_hr_id
       where document_requests.id = $1`,
      [request.id],
    );
    const hr = hrResult.rows[0];
    if (hr) {
      await client.query(
        `insert into hr_notifications
          (hr_user_id, request_id, type, title, message)
         values ($1, $2, 'request_submitted', $3, $4)`,
        [
          hr.id,
          request.id,
          `${request.candidateName} submitted documents`,
          `${documents.length} requested document${documents.length === 1 ? "" : "s"} received.`,
        ],
      );
    }
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
      hr,
      documentCount: documents.length,
      message: "Your documents were submitted successfully.",
    };
  });

  if (submissionResult.ok && submissionResult.hr) {
    const submittedAt = submissionResult.request.submittedAt || new Date().toISOString();
    const emailResult = await sendRequestEmail(
      submissionResult.hr.email,
      buildHrSubmissionEmail({
        hrName: submissionResult.hr.name,
        candidateName: submissionResult.request.candidateName,
        submittedAt,
        documentCount: submissionResult.documentCount,
        hrPortalUrl: (
          process.env.NEXT_PUBLIC_HR_PORTAL_URL || "http://localhost:3001"
        ).replace(/\/$/, "") + "/candidates",
      }),
      { idempotencyKey: `hr-submission/${submissionResult.request.id}` },
    );
    await query(
      `insert into request_email_deliveries
        (request_id, email_type, recipient_email, status, provider,
         provider_message_id, error_message, sent_at)
       values ($1, 'hr_submission', $2, $3, $4, $5, $6, $7)`,
      [
        submissionResult.request.id,
        submissionResult.hr.email,
        emailResult.ok
          ? "sent"
          : emailResult.provider === "none"
            ? "unconfigured"
            : "failed",
        emailResult.provider,
        emailResult.ok ? emailResult.messageId || null : null,
        emailResult.ok ? null : emailResult.error,
        emailResult.ok ? new Date() : null,
      ],
    );
  }

  return {
    ok: submissionResult.ok,
    status: submissionResult.status,
    message: submissionResult.message,
    request: submissionResult.ok ? submissionResult.request : undefined,
  };
}

export async function getDashboardStats() {
  await ensureRequestSchema();
  await expireStaleRequests();

  const result = await query<{
    total: string;
    pending: string;
    submitted: string;
    expired: string;
    active: string;
  }>(`
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
  `);

  const stats = result.rows[0];
  const recentResult = await listDocumentRequests({
    sortBy: "requestDate",
    sortDirection: "desc",
    page: 1,
    pageSize: 6,
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

export async function getSubmittedDocumentsForDownload(requestId: string) {
  await ensureRequestSchema();
  const request = await getDocumentRequestById(requestId);

  if (!request || !["submitted", "completed"].includes(request.status)) {
    return [];
  }

  const downloads: Array<{
    itemId: string;
    label: string;
    documentId: string;
    fileName: string;
    mimeType: string | null;
    data: Buffer;
  }> = [];

  for (const item of request.items) {
    if (!item.submittedDocumentId) {
      continue;
    }

    const fileResult = await query<{
      file_data: string;
      file_mime_type: string | null;
      file_name: string;
      original_file_name: string | null;
    }>(
      `select file_data, file_mime_type, file_name, original_file_name
       from documents where id = $1`,
      [item.submittedDocumentId],
    );

    const file = fileResult.rows[0];
    if (!file) {
      continue;
    }

    downloads.push({
      itemId: item.id,
      label: item.documentLabel,
      documentId: item.submittedDocumentId,
      fileName: file.original_file_name || file.file_name,
      mimeType: file.file_mime_type,
      data: Buffer.from(file.file_data, "base64"),
    });
  }

  return downloads;
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

function toDisplayStatus(status: RequestStatus): DisplayRequestStatus {
  if (status === "submitted" || status === "completed") {
    return "submitted";
  }

  if (status === "expired" || status === "cancelled") {
    return "expired";
  }

  return "pending";
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
