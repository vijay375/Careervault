import { ensureDatabaseSchema, query } from "@/lib/database";

export type HrNotification = {
  id: string;
  requestId?: string;
  type: string;
  title: string;
  message: string;
  readAt?: string;
  createdAt: string;
};

type NotificationRow = {
  id: string;
  request_id: string | null;
  type: string;
  title: string;
  message: string;
  read_at: Date | string | null;
  created_at: Date | string;
};

export async function listHrNotifications(hrUserId: string) {
  await ensureDatabaseSchema();
  const result = await query<NotificationRow>(
    `select id, request_id, type, title, message, read_at, created_at
     from hr_notifications
     where hr_user_id = $1
     order by created_at desc
     limit 20`,
    [hrUserId],
  );

  return result.rows.map((row) => ({
    id: row.id,
    requestId: row.request_id || undefined,
    type: row.type,
    title: row.title,
    message: row.message,
    readAt: row.read_at ? new Date(row.read_at).toISOString() : undefined,
    createdAt: new Date(row.created_at).toISOString(),
  }));
}

export async function markHrNotificationsRead(hrUserId: string, notificationId?: string) {
  await ensureDatabaseSchema();
  await query(
    `update hr_notifications
     set read_at = coalesce(read_at, now())
     where hr_user_id = $1
       and ($2::uuid is null or id = $2::uuid)`,
    [hrUserId, notificationId || null],
  );
}
