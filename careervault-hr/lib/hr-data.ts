export type DocumentType =
  | "Offer Letter"
  | "Experience Letter"
  | "Relieving Letter"
  | "Salary Slip"
  | "Employment Contract"
  | "Appraisal Letter"
  | "Promotion Letter";

export type RequestStatus = "pending" | "submitted" | "expired";

export const documentTypes: DocumentType[] = [
  "Offer Letter",
  "Experience Letter",
  "Relieving Letter",
  "Salary Slip",
  "Employment Contract",
  "Appraisal Letter",
  "Promotion Letter",
];

export const defaultExpiryHours = 24;
export const expiryHourOptions = [1, 3, 6, 12, 24, 48];

export function formatDate(value?: string) {
  if (!value) {
    return "—";
  }

  return new Intl.DateTimeFormat("en", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(value));
}

export function formatStatus(status: RequestStatus) {
  return status.charAt(0).toUpperCase() + status.slice(1);
}

export function statusBadgeClass(status: RequestStatus) {
  switch (status) {
    case "pending":
      return "bg-amber-50 text-amber-700";
    case "submitted":
      return "bg-emerald-50 text-emerald-700";
    case "expired":
      return "bg-slate-100 text-slate-600";
    default:
      return "bg-slate-100 text-slate-600";
  }
}

export function getUserPortalUrl() {
  return (
    process.env.NEXT_PUBLIC_USER_PORTAL_URL ||
    process.env.NEXT_PUBLIC_APP_URL ||
    "http://localhost:3000"
  );
}
