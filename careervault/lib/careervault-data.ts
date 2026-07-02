export type DocumentType =
  | "Offer Letter"
  | "Experience Letter"
  | "Relieving Letter"
  | "Salary Slip"
  | "Employment Contract"
  | "Appraisal Letter"
  | "Promotion Letter";

export type VaultDocument = {
  id: string;
  companyName: string;
  employeeName: string;
  designation: string;
  joiningDate: string;
  relievingDate?: string;
  documentType: DocumentType;
  salaryInfo?: string;
  fileName: string;
  fileSize: string;
  uploadedAt: string;
  status: "Verified" | "Review needed";
  shareLink?: string;
};

export type ExtractedDocumentFields = Pick<
  VaultDocument,
  | "companyName"
  | "employeeName"
  | "designation"
  | "joiningDate"
  | "relievingDate"
  | "documentType"
  | "salaryInfo"
>;

export const documentTypes: DocumentType[] = [
  "Offer Letter",
  "Experience Letter",
  "Relieving Letter",
  "Salary Slip",
  "Employment Contract",
  "Appraisal Letter",
  "Promotion Letter",
];

export const initialDocuments: VaultDocument[] = [];

export function formatDate(value?: string) {
  if (!value) {
    return "Present";
  }

  return new Intl.DateTimeFormat("en", {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(new Date(value));
}
