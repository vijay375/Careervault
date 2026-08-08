import { NextRequest, NextResponse } from "next/server";
import { handleApiOperation } from "@/lib/api-errors";
import { listHrNotifications, markHrNotificationsRead } from "@/lib/notifications";
import { requireHrUser, unauthorized } from "@/lib/server-session";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  return handleApiOperation("notification list", async () => {
    const user = await requireHrUser(request);
    if (!user) {
      return unauthorized();
    }

    const notifications = await listHrNotifications(user.id);
    return NextResponse.json({
      ok: true,
      notifications,
      unreadCount: notifications.filter((notification) => !notification.readAt).length,
    });
  });
}

export async function PATCH(request: NextRequest) {
  return handleApiOperation("notification update", async () => {
    const user = await requireHrUser(request);
    if (!user) {
      return unauthorized();
    }

    const body = (await request.json().catch(() => ({}))) as { id?: string };
    await markHrNotificationsRead(user.id, body.id);
    return NextResponse.json({ ok: true });
  });
}
