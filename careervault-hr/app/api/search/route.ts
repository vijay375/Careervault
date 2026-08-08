import { NextRequest, NextResponse } from "next/server";
import { handleApiOperation } from "@/lib/api-errors";
import { searchDocumentRequests } from "@/lib/document-requests";
import { requireHrUser, unauthorized } from "@/lib/server-session";

export const runtime = "nodejs";

const modules = [
  {
    id: "dashboard",
    title: "Dashboard",
    subtitle: "Overview and recent activity",
    href: "/",
    keywords: "dashboard overview statistics activity",
  },
  {
    id: "candidates",
    title: "Candidates",
    subtitle: "Search and review candidate requests",
    href: "/candidates",
    keywords: "candidates document requests submissions",
  },
  {
    id: "requests",
    title: "Create Request",
    subtitle: "Send a new document request",
    href: "/requests",
    keywords: "requests create send documents",
  },
];

export async function GET(request: NextRequest) {
  return handleApiOperation("global search", async () => {
    const user = await requireHrUser(request);
    if (!user) {
      return unauthorized();
    }

    const query = request.nextUrl.searchParams.get("q")?.trim() || "";
    if (query.length < 2) {
      return NextResponse.json({ ok: true, results: [] });
    }

    const normalizedQuery = query.toLowerCase();
    const moduleResults = modules
      .filter((module) =>
        `${module.title} ${module.subtitle} ${module.keywords}`.toLowerCase().includes(normalizedQuery),
      )
      .map((module) => ({
        id: module.id,
        title: module.title,
        subtitle: module.subtitle,
        href: module.href,
        type: "module" as const,
      }));
    const requestResults = (await searchDocumentRequests(query, 8, user.id)).map((result) => ({
      id: result.id,
      type: "request" as const,
      title: result.candidateName,
      subtitle: `${result.candidateEmail} · ${result.documents.join(", ") || "Document request"}`,
      status: result.status,
      href: `/candidates?search=${encodeURIComponent(result.id)}&request=${encodeURIComponent(result.id)}`,
    }));

    return NextResponse.json({
      ok: true,
      results: [...moduleResults, ...requestResults].slice(0, 10),
    });
  });
}
