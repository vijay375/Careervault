"use client";

import * as Dialog from "@radix-ui/react-dialog";
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import {
  Bell,
  BriefcaseBusiness,
  ChevronDown,
  CloudUpload,
  Download,
  Eye,
  EyeOff,
  FileText,
  HelpCircle,
  LayoutDashboard,
  Pencil,
  Search,
  Settings,
  ShieldCheck,
  Trash2,
  UploadCloud,
  User,
  X,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import { ChangeEvent, FormEvent, useEffect, useMemo, useState } from "react";
import {
  documentTypes,
  formatDate,
  initialDocuments,
  VaultDocument,
} from "@/lib/careervault-data";

type Screen = "dashboard" | "documents" | "upload" | "viewer";
type AuthMode = "login" | "signup" | "forgot" | "verify" | "reset";
type SortMode = "Newest" | "Name" | "Category";

type ManagedDocument = VaultDocument & {
  description?: string;
  fileType: "PDF" | "DOC" | "DOCX" | "JPG" | "PNG";
  lastViewed?: string;
  extractedText?: string;
  extractedAt?: string;
  employmentPeriod?: string;
  salaryMonth?: string;
  originalFileName?: string;
  fileUrl?: string;
};

type UserProfile = {
  name: string;
  email: string;
};

type AuthApiResponse = {
  ok: boolean;
  message: string;
  user?: UserProfile;
  resendAvailableAt?: number;
};

const defaultUser = {
  name: "",
  email: "",
};

const allowedExtensions = ["pdf", "doc", "docx", "jpg", "jpeg", "png"];
const resendCooldownMs = 60 * 1000;

function getPasswordPolicyMessage(password: string) {
  if (password.length < 8) {
    return "Password must be at least 8 characters long.";
  }

  if (!/[A-Z]/.test(password)) {
    return "Password must include at least one uppercase letter.";
  }

  if (!/[a-z]/.test(password)) {
    return "Password must include at least one lowercase letter.";
  }

  if (!/\d/.test(password)) {
    return "Password must include at least one number.";
  }

  return "";
}

async function postAuthRequest(path: string, payload: Record<string, string>) {
  const response = await fetch(path, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });
  const data = (await response.json().catch(() => ({
    message: "A network error occurred. Please try again.",
  }))) as Partial<AuthApiResponse>;

  return {
    ok: response.ok && data.ok !== false,
    message: data.message || "Something went wrong. Please try again.",
    user: data.user,
    resendAvailableAt: data.resendAvailableAt,
  };
}

function getInitials(name: string) {
  return name
    .split(" ")
    .map((part) => part[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
}

function titleCase(value: string) {
  return value
    .replace(/[-_]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function normalizeExtractedText(value: string) {
  return value
    .replace(/[^\x09\x0A\x0D\x20-\x7E]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function findField(text: string, patterns: RegExp[]) {
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match?.[1]) {
      return titleCase(match[1].slice(0, 80));
    }
  }

  return "";
}

function detectDocumentType(source: string) {
  const lowerSource = source.toLowerCase();
  if (/\b(pay\s?slip|salary\s?slip|salary statement|payroll)\b/.test(lowerSource)) {
    return "Salary Slip";
  }
  if (/\bexperience\b/.test(lowerSource)) {
    return "Experience Letter";
  }
  if (/\brelieving\b/.test(lowerSource)) {
    return "Relieving Letter";
  }
  if (/\b(appraisal)\b/.test(lowerSource)) {
    return "Appraisal Letter";
  }
  if (/\b(promotion)\b/.test(lowerSource)) {
    return "Promotion Letter";
  }
  if (/\b(contract|agreement)\b/.test(lowerSource)) {
    return "Employment Contract";
  }
  if (/\b(offer|appointment)\b/.test(lowerSource)) {
    return "Offer Letter";
  }

  const detectedType = documentTypes.find((type) =>
    lowerSource.includes(type.toLowerCase().split(" ")[0]),
  );

  return detectedType ?? "Offer Letter";
}

function detectSalaryMonth(text: string) {
  const monthMatch = text.match(
    /\b(?:salary|payroll|payslip|pay slip)(?:\s+for|\s+month)?\s*[:\-]?\s*((?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\.?\s+\d{4})/i,
  );

  return monthMatch?.[1] ? titleCase(monthMatch[1]) : undefined;
}

function toIsoDate(value?: string) {
  if (!value) {
    return undefined;
  }

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return undefined;
  }

  return parsed.toISOString().slice(0, 10);
}

function extractMetadataFromText(file: File, rawText: string): ParsedDocumentMetadata {
  const fileStem = file.name.replace(/\.[^/.]+$/, "");
  const cleanedText = normalizeExtractedText(rawText);
  const searchableText = `${cleanedText} ${titleCase(fileStem)}`;
  const documentType = detectDocumentType(searchableText);
  const companyFromFile = titleCase(fileStem.split(/offer|experience|salary|relieving|letter|contract|agreement|slip/i)[0]);
  const companyName =
    findField(searchableText, [
      /company\s*(?:name)?\s*[:\-]\s*([A-Za-z0-9&., ]+)/i,
      /(?:at|from)\s+([A-Z][A-Za-z0-9&., ]+(?:Technologies|Labs|Systems|Solutions|Pvt|Ltd|Inc|LLC))/,
    ]) ||
    companyFromFile ||
    "CareerVault Upload";
  const designation =
    findField(searchableText, [
      /designation\s*[:\-]\s*([A-Za-z0-9&., /-]+)/i,
      /position\s*[:\-]\s*([A-Za-z0-9&., /-]+)/i,
      /role\s*[:\-]\s*([A-Za-z0-9&., /-]+)/i,
      /as\s+(?:a|an)\s+([A-Za-z0-9&., /-]+?)(?:\s+at|\s+with|\.|,)/i,
    ]) || "Professional Record";
  const dateMatches = searchableText.match(
    /\b(?:\d{1,2}[/-]\d{1,2}[/-]\d{2,4}|\d{4}-\d{2}-\d{2}|(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\.?\s+\d{1,2},?\s+\d{4})\b/gi,
  );
  const joiningDate = toIsoDate(dateMatches?.[0]) ?? new Date().toISOString().slice(0, 10);
  const relievingDate = toIsoDate(dateMatches?.[1]);
  const employmentPeriod = `${formatDate(joiningDate)} - ${formatDate(relievingDate)}`;
  const salaryMonth =
    documentType === "Salary Slip" ? detectSalaryMonth(searchableText) : undefined;
  const extractedText =
    cleanedText ||
    [
      `File Name: ${file.name}`,
      `Company Name: ${companyName}`,
      `Designation: ${designation}`,
      `Employment Period: ${employmentPeriod}`,
      `Document Type: ${documentType}`,
      salaryMonth ? `Salary Month: ${salaryMonth}` : "",
    ].join("\n");

  return {
    companyName,
    designation,
    employmentPeriod,
    joiningDate,
    relievingDate,
    documentType,
    salaryMonth,
    extractedText,
  };
}

async function parseUploadedFile(file: File) {
  try {
    const buffer = await file.arrayBuffer();
    const decoder = new TextDecoder("utf-8", { fatal: false });
    return extractMetadataFromText(file, decoder.decode(buffer));
  } catch {
    return extractMetadataFromText(file, "");
  }
}

function toManagedDocument(document: VaultDocument): ManagedDocument {
  const extension = document.fileName.split(".").pop()?.toUpperCase() ?? "PDF";

  return {
    ...document,
    description: `${document.documentType} for ${document.designation} at ${document.companyName}.`,
    fileType: extension === "JPEG" ? "JPG" : (extension as ManagedDocument["fileType"]),
    lastViewed: document.id === "doc-001" ? "2026-06-24" : undefined,
    extractedText: [
      `Company Name: ${document.companyName}`,
      `Designation: ${document.designation}`,
      `Employment Period: ${formatDate(document.joiningDate)} - ${formatDate(document.relievingDate)}`,
      `Document Type: ${document.documentType}`,
    ].join("\n"),
    extractedAt: document.uploadedAt,
    employmentPeriod: `${formatDate(document.joiningDate)} - ${formatDate(document.relievingDate)}`,
  };
}

type ParsedDocumentMetadata = {
  companyName: string;
  designation: string;
  employmentPeriod: string;
  joiningDate: string;
  relievingDate?: string;
  documentType: VaultDocument["documentType"];
  salaryMonth?: string;
  extractedText: string;
};

export function CareerVaultPlatform() {
  const [currentUser, setCurrentUser] = useState<UserProfile>(defaultUser);
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [authMode, setAuthMode] = useState<AuthMode>("login");
  const [authMessage, setAuthMessage] = useState("");
  const [authLoading, setAuthLoading] = useState(false);
  const [resetEmail, setResetEmail] = useState("");
  const [resendAvailableAt, setResendAvailableAt] = useState(0);
  const [resendSeconds, setResendSeconds] = useState(0);
  const [screen, setScreen] = useState<Screen>("dashboard");
  const [documents, setDocuments] = useState<ManagedDocument[]>(
    initialDocuments.map(toManagedDocument),
  );
  const [selectedDocumentId, setSelectedDocumentId] = useState<string | null>(null);
  const [documentToDelete, setDocumentToDelete] = useState<ManagedDocument | null>(null);
  const [documentToEdit, setDocumentToEdit] = useState<ManagedDocument | null>(null);
  const [toast, setToast] = useState("");
  const [query, setQuery] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("All");
  const [sortMode, setSortMode] = useState<SortMode>("Newest");
  const [zoom, setZoom] = useState(100);
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [uploadForm, setUploadForm] = useState({
    name: "",
    category: "Offer Letter",
    description: "",
    companyName: "",
    designation: "",
    employmentPeriod: "",
    salaryMonth: "",
  });
  const [parsedUpload, setParsedUpload] = useState<ParsedDocumentMetadata | null>(null);
  const [isParsingUpload, setIsParsingUpload] = useState(false);

  const selectedDocument = documents.find((document) => document.id === selectedDocumentId);

  const filteredDocuments = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    const matchingDocuments = documents.filter((document) => {
      const matchesSearch =
        !normalizedQuery ||
        document.fileName.toLowerCase().includes(normalizedQuery) ||
        document.companyName.toLowerCase().includes(normalizedQuery) ||
        document.designation.toLowerCase().includes(normalizedQuery) ||
        document.employmentPeriod?.toLowerCase().includes(normalizedQuery) ||
        document.documentType.toLowerCase().includes(normalizedQuery);
      const matchesCategory =
        categoryFilter === "All" || document.documentType === categoryFilter;

      return matchesSearch && matchesCategory;
    });

    return [...matchingDocuments].sort((first, second) => {
      if (sortMode === "Name") {
        return first.fileName.localeCompare(second.fileName);
      }

      if (sortMode === "Category") {
        return first.documentType.localeCompare(second.documentType);
      }

      return (
        new Date(second.uploadedAt).getTime() - new Date(first.uploadedAt).getTime()
      );
    });
  }, [categoryFilter, documents, query, sortMode]);

  const recentlyUploaded = documents;

  useEffect(() => {
    if (!toast) {
      return;
    }

    const timeoutId = window.setTimeout(() => {
      setToast("");
    }, 4000);

    return () => window.clearTimeout(timeoutId);
  }, [toast]);

  useEffect(() => {
    if (!resendAvailableAt) {
      return;
    }

    const updateCountdown = () => {
      setResendSeconds(Math.max(0, Math.ceil((resendAvailableAt - Date.now()) / 1000)));
    };

    updateCountdown();
    const intervalId = window.setInterval(updateCountdown, 1000);

    return () => window.clearInterval(intervalId);
  }, [resendAvailableAt]);

  async function handleResendCode() {
    if (!resetEmail || authLoading || resendSeconds > 0) {
      return;
    }

    setAuthLoading(true);
    setAuthMessage("");
    const result = await postAuthRequest("/api/auth/resend-code", { email: resetEmail });
    setAuthLoading(false);

    if (result.resendAvailableAt) {
      setResendAvailableAt(result.resendAvailableAt);
    } else if (result.ok) {
      setResendAvailableAt(Date.now() + resendCooldownMs);
    }

    setAuthMessage(result.message);
  }

  async function handleAuthSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (authLoading) {
      return;
    }

    const formData = new FormData(event.currentTarget);
    const name = String(formData.get("name") || "").trim();
    const email = String(formData.get("email") || "").trim();
    const password = String(formData.get("password") || "").trim();
    const code = String(formData.get("code") || "").trim();
    const confirmPassword = String(formData.get("confirmPassword") || "").trim();

    if (authMode === "signup") {
      const passwordMessage = getPasswordPolicyMessage(password);
      if (passwordMessage) {
        setAuthMessage(passwordMessage);
        return;
      }

      setAuthLoading(true);
      setAuthMessage("");
      const result = await postAuthRequest("/api/auth/signup", { name, email, password });
      setAuthLoading(false);
      setAuthMessage(result.message);

      if (result.ok) {
        setAuthMode("login");
      }

      return;
    }

    if (authMode === "forgot") {
      setAuthLoading(true);
      setAuthMessage("");
      const result = await postAuthRequest("/api/auth/forgot-password", { email });
      setAuthLoading(false);

      if (result.ok) {
        setResetEmail(email);
        setResendAvailableAt(result.resendAvailableAt || Date.now() + resendCooldownMs);
        setAuthMode("verify");
      }

      setAuthMessage(result.message);
      return;
    }

    if (authMode === "verify") {
      if (!resetEmail) {
        setAuthMode("forgot");
        setAuthMessage("Please request a new verification code.");
        return;
      }

      setAuthLoading(true);
      setAuthMessage("");
      const result = await postAuthRequest("/api/auth/verify-code", {
        email: resetEmail,
        code,
      });
      setAuthLoading(false);

      if (result.ok) {
        setAuthMode("reset");
      }

      setAuthMessage(result.message);
      return;
    }

    if (authMode === "reset") {
      if (!resetEmail) {
        setAuthMode("forgot");
        setAuthMessage("Please verify your email before resetting your password.");
        return;
      }

      if (password !== confirmPassword) {
        setAuthMessage("Passwords do not match. Please confirm your new password.");
        return;
      }

      const passwordMessage = getPasswordPolicyMessage(password);
      if (passwordMessage) {
        setAuthMessage(passwordMessage);
        return;
      }

      setAuthLoading(true);
      setAuthMessage("");
      const result = await postAuthRequest("/api/auth/reset-password", {
        email: resetEmail,
        password,
      });
      setAuthLoading(false);

      if (result.ok) {
        setResetEmail("");
        setResendAvailableAt(0);
        setResendSeconds(0);
        setAuthMode("login");
      }

      setAuthMessage(result.message);
      return;
    }

    setAuthLoading(true);
    setAuthMessage("");
    const result = await postAuthRequest("/api/auth/login", { email, password });
    setAuthLoading(false);

    if (!result.ok || !result.user) {
      setAuthMessage(result.message);
      return;
    }

    setCurrentUser(result.user);
    setIsAuthenticated(true);
    setAuthMessage("");
    setToast(`Welcome back, ${result.user.name}.`);
  }

  function signOut() {
    setIsAuthenticated(false);
    setScreen("dashboard");
    setSelectedDocumentId(null);
    setDocumentToEdit(null);
    setDocumentToDelete(null);
    setUploadFile(null);
    setParsedUpload(null);
    setAuthMode("login");
    setAuthMessage("");
    setAuthLoading(false);
    setResetEmail("");
    setResendAvailableAt(0);
    setResendSeconds(0);
    setToast("Signed out securely.");
  }

  function goToDocuments() {
    setScreen("documents");
    setSelectedDocumentId(null);
  }

  function openDocument(document: ManagedDocument) {
    setDocuments((current) =>
      current.map((item) =>
        item.id === document.id
          ? { ...item, lastViewed: new Date().toISOString().slice(0, 10) }
          : item,
      ),
    );
    setSelectedDocumentId(document.id);
    setZoom(100);
    if (document.fileUrl) {
      window.open(document.fileUrl, "_blank", "noopener,noreferrer");
      setToast(`Opened ${document.originalFileName ?? document.fileName} in a new tab.`);
      return;
    }

    setScreen("viewer");
  }

  function downloadDocument(document: ManagedDocument) {
    if (document.fileUrl) {
      const link = window.document.createElement("a");
      link.href = document.fileUrl;
      link.download = document.originalFileName ?? document.fileName;
      link.click();
      setToast(`Download started for ${document.originalFileName ?? document.fileName}.`);
      return;
    }

    const file = new Blob(
      [
        [
          "CareerVault document export",
          "",
          `Name: ${document.fileName}`,
          `Category: ${document.documentType}`,
          `Company: ${document.companyName}`,
          `Designation: ${document.designation}`,
          `Employment Period: ${document.employmentPeriod ?? `${formatDate(document.joiningDate)} - ${formatDate(document.relievingDate)}`}`,
          `Uploaded: ${document.uploadedAt}`,
          "",
          "Extracted content",
          document.extractedText ?? "No extracted text available.",
        ].join("\n"),
      ],
      { type: "text/plain" },
    );
    const url = URL.createObjectURL(file);
    const link = window.document.createElement("a");
    link.href = url;
    link.download = document.fileName;
    link.click();
    URL.revokeObjectURL(url);
    setToast(`Download started for ${document.fileName}.`);
  }

  function confirmDelete() {
    if (!documentToDelete) {
      return;
    }

    setDocuments((current) =>
      current.filter((document) => document.id !== documentToDelete.id),
    );
    setToast(`${documentToDelete.fileName} deleted successfully.`);
    if (selectedDocumentId === documentToDelete.id) {
      setSelectedDocumentId(null);
      setScreen("documents");
    }
    setDocumentToDelete(null);
    setDocumentToEdit(null);
  }

  function saveEditedDocument(updatedDocument: ManagedDocument) {
    setDocuments((current) =>
      current.map((document) =>
        document.id === updatedDocument.id ? updatedDocument : document,
      ),
    );
    setDocumentToEdit(null);
    setToast(`${updatedDocument.fileName} updated successfully.`);
  }

  async function handleFileChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) {
      return;
    }

    const extension = file.name.split(".").pop()?.toLowerCase() ?? "";
    if (!allowedExtensions.includes(extension)) {
      setToast("Unsupported file type. Upload PDF, DOC, DOCX, JPG, or PNG.");
      return;
    }

    if (file.size > 10 * 1024 * 1024) {
      setToast("File exceeds the 10 MB limit.");
      return;
    }

    setUploadFile(file);
    setIsParsingUpload(true);
    setToast("Parsing document metadata...");
    const parsedDocument = await parseUploadedFile(file);
    setParsedUpload(parsedDocument);
    setUploadForm((current) => ({
      ...current,
      name:
        current.name ||
        `${parsedDocument.companyName} ${parsedDocument.documentType}`,
      category: parsedDocument.documentType,
      companyName: parsedDocument.companyName,
      designation: parsedDocument.designation,
      employmentPeriod: parsedDocument.employmentPeriod,
      salaryMonth: parsedDocument.salaryMonth ?? "",
      description:
        current.description ||
        `${parsedDocument.documentType} for ${parsedDocument.designation} at ${parsedDocument.companyName}.`,
    }));
    setIsParsingUpload(false);
    setToast("Document metadata extracted successfully.");
  }

  function handleUpload(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!uploadFile) {
      setToast("Please select a document before uploading.");
      return;
    }

    const extension = uploadFile.name.split(".").pop()?.toUpperCase() ?? "PDF";
    const parsedDocument = parsedUpload ?? extractMetadataFromText(uploadFile, "");
    const originalFileUrl = URL.createObjectURL(uploadFile);
    const reviewedCompany = uploadForm.companyName || parsedDocument.companyName;
    const reviewedDesignation = uploadForm.designation || parsedDocument.designation;
    const reviewedPeriod = uploadForm.employmentPeriod || parsedDocument.employmentPeriod;
    const newDocument: ManagedDocument = {
      id: `doc-${Date.now()}`,
      companyName: reviewedCompany,
      employeeName: currentUser.name,
      designation: reviewedDesignation,
      joiningDate: parsedDocument.joiningDate,
      relievingDate: parsedDocument.relievingDate,
      documentType: uploadForm.category as ManagedDocument["documentType"],
      fileName: uploadForm.name || `${reviewedCompany} ${uploadForm.category}`,
      fileSize: `${Math.max(uploadFile.size / 1024 / 1024, 0.1).toFixed(1)} MB`,
      uploadedAt: new Date().toISOString().slice(0, 10),
      status: "Verified",
      description:
        uploadForm.description ||
        `${uploadForm.category} for ${reviewedDesignation} at ${reviewedCompany}.`,
      fileType: extension === "JPEG" ? "JPG" : (extension as ManagedDocument["fileType"]),
      extractedText: parsedDocument.extractedText,
      extractedAt: new Date().toISOString().slice(0, 10),
      employmentPeriod: reviewedPeriod,
      salaryMonth: uploadForm.salaryMonth || parsedDocument.salaryMonth,
      originalFileName: uploadFile.name,
      fileUrl: originalFileUrl,
    };

    setDocuments((current) => [newDocument, ...current]);
    setUploadFile(null);
    setParsedUpload(null);
    setUploadForm({
      name: "",
      category: "Offer Letter",
      description: "",
      companyName: "",
      designation: "",
      employmentPeriod: "",
      salaryMonth: "",
    });
    setToast("Upload successful. Document added to your vault.");
    setScreen("documents");
  }

  if (!isAuthenticated) {
    return (
      <>
        <AuthScreen
          authMode={authMode}
          isLoading={authLoading}
          message={authMessage}
          onAuthModeChange={(mode) => {
            setAuthMode(mode);
            setAuthMessage("");
            setAuthLoading(false);
            if (mode === "login" || mode === "signup" || mode === "forgot") {
              setResetEmail("");
              setResendAvailableAt(0);
              setResendSeconds(0);
            }
          }}
          onResendCode={handleResendCode}
          onSubmit={handleAuthSubmit}
          resendSeconds={resendSeconds}
        />
        <Toast message={toast} />
      </>
    );
  }

  return (
    <main className="min-h-screen bg-[#f6f8fb] text-slate-950">
      <TopNav
        onSignOut={signOut}
        query={query}
        setQuery={setQuery}
        user={currentUser}
      />
      <MobileNav activeScreen={screen} setScreen={setScreen} />

      <div className="mx-auto flex max-w-[1440px]">
        <Sidebar activeScreen={screen} setScreen={setScreen} user={currentUser} />

        <section className="min-w-0 flex-1 px-4 py-5 sm:px-6 lg:ml-64 lg:px-8">
          {screen === "dashboard" && (
            <DashboardScreen
              documents={documents}
              onDownload={downloadDocument}
              onEdit={setDocumentToEdit}
              onOpen={openDocument}
              recentlyUploaded={recentlyUploaded}
              setScreen={setScreen}
              user={currentUser}
            />
          )}

          {screen === "documents" && (
            <DocumentsScreen
              categoryFilter={categoryFilter}
              documents={filteredDocuments}
              onDelete={setDocumentToDelete}
              onDownload={downloadDocument}
              onEdit={setDocumentToEdit}
              onOpen={openDocument}
              query={query}
              setCategoryFilter={setCategoryFilter}
              setQuery={setQuery}
              setSortMode={setSortMode}
              sortMode={sortMode}
            />
          )}

          {screen === "upload" && (
            <UploadScreen
              form={uploadForm}
              isParsingUpload={isParsingUpload}
              onFileChange={handleFileChange}
              onSubmit={handleUpload}
              setForm={setUploadForm}
              uploadFile={uploadFile}
            />
          )}

          {screen === "viewer" && selectedDocument && (
            <DocumentViewerScreen
              document={selectedDocument}
              onBack={goToDocuments}
              onDelete={setDocumentToDelete}
              onDownload={downloadDocument}
              onEdit={setDocumentToEdit}
              setZoom={setZoom}
              zoom={zoom}
            />
          )}
        </section>
      </div>

      <Toast message={toast} />

      <DeleteDialog
        document={documentToDelete}
        onCancel={() => setDocumentToDelete(null)}
        onConfirm={confirmDelete}
      />

      <EditDocumentDialog
        document={documentToEdit}
        onCancel={() => setDocumentToEdit(null)}
        onDelete={(document) => {
          setDocumentToEdit(null);
          setDocumentToDelete(document);
        }}
        onSave={saveEditedDocument}
      />
    </main>
  );
}

function AuthScreen({
  authMode,
  isLoading,
  message,
  onAuthModeChange,
  onResendCode,
  onSubmit,
  resendSeconds,
}: {
  authMode: AuthMode;
  isLoading: boolean;
  message: string;
  onAuthModeChange: (mode: AuthMode) => void;
  onResendCode: () => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  resendSeconds: number;
}) {
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const isSignup = authMode === "signup";
  const isLogin = authMode === "login";
  const isForgot = authMode === "forgot";
  const isVerify = authMode === "verify";
  const isReset = authMode === "reset";
  const title = isSignup
    ? "Create account"
    : isForgot
      ? "Forgot password"
      : isVerify
        ? "Verify code"
        : isReset
          ? "Reset password"
          : "Welcome back";
  const subtitle = isForgot
    ? "Enter your registered email address to receive a verification code."
    : isVerify
      ? "Enter the 6-digit code sent to your registered email."
      : isReset
        ? "Create a new password that meets the security requirements."
        : "Sign in to access your protected vault.";
  const submitLabel = isSignup
    ? "Create account"
    : isForgot
      ? "Send verification code"
      : isVerify
        ? "Verify code"
        : isReset
          ? "Reset password"
          : "Sign in";
  const isErrorMessage =
    message.startsWith("No account") ||
    message.startsWith("Password") ||
    message.startsWith("Passwords") ||
    message.startsWith("The verification") ||
    message.startsWith("This verification") ||
    message.startsWith("Please");

  return (
    <main className="flex min-h-screen items-center justify-center bg-[#0d172b] px-4 py-8 text-white">
      <section className="grid w-full max-w-5xl overflow-hidden rounded-[20px] border border-white/10 bg-white/5 shadow-2xl shadow-black/30 backdrop-blur lg:grid-cols-[1fr_420px]">
        <div className="bg-[radial-gradient(circle_at_20%_20%,rgba(59,130,246,0.45),transparent_32%),linear-gradient(135deg,#0d172b,#0f2f83)] p-8 sm:p-10">
          <div className="flex items-center gap-4">
            <div className="flex h-14 w-14 items-center justify-center rounded-[20px] bg-blue-500 text-xl font-bold">
              CV
            </div>
            <div>
              <h1 className="text-2xl font-bold">CareerVault</h1>
              <p className="text-blue-100">Secure Document Hub</p>
            </div>
          </div>
          <h2 className="mt-16 max-w-xl text-4xl font-bold tracking-tight sm:text-5xl">
            Your career documents, organized and ready.
          </h2>
          <p className="mt-4 max-w-xl leading-7 text-blue-100">
            Store, search, preview, and manage employment records with a polished
            document workflow.
          </p>
        </div>

        <form className="bg-white p-6 text-slate-950 sm:p-8" onSubmit={onSubmit}>
          <h2 className="text-2xl font-bold">{title}</h2>
          {!isSignup && <p className="mt-2 text-sm text-slate-500">{subtitle}</p>}
          {message && (
            <p
              className={`mt-4 rounded-[20px] border px-4 py-3 text-sm font-semibold ${
                isErrorMessage
                  ? "border-red-100 bg-red-50 text-red-700"
                  : "border-blue-100 bg-blue-50 text-blue-800"
              }`}
            >
              {message}
            </p>
          )}

          <div className="mt-6 space-y-4">
            {isSignup && (
              <label className="block">
                <span className="text-sm font-semibold text-slate-700">Full name</span>
                <input
                  className="mt-2 h-11 w-full rounded-[20px] border border-slate-200 px-3 text-sm outline-none focus:border-blue-400"
                  name="name"
                  placeholder="Enter your full name"
                  required
                />
              </label>
            )}

            {(isSignup || isLogin || isForgot) && (
              <label className="block">
                <span className="text-sm font-semibold text-slate-700">Email</span>
                <input
                  className="mt-2 h-11 w-full rounded-[20px] border border-slate-200 px-3 text-sm outline-none focus:border-blue-400"
                  name="email"
                  placeholder="Enter your email"
                  required
                  type="email"
                />
              </label>
            )}

            {(isSignup || isLogin || isReset) && (
              <label className="block">
                <span className="text-sm font-semibold text-slate-700">
                  {isReset ? "New password" : "Password"}
                </span>
                <div className="mt-2 flex h-11 items-center rounded-[20px] border border-slate-200 px-3 focus-within:border-blue-400">
                  <input
                    className="h-full min-w-0 flex-1 bg-transparent text-sm outline-none"
                    minLength={8}
                    name="password"
                    placeholder={isReset ? "Enter your new password" : "Enter your password"}
                    required
                    type={showPassword ? "text" : "password"}
                  />
                  <button
                    aria-label={showPassword ? "Hide password" : "Show password"}
                    className="ml-2 text-slate-400 transition hover:text-blue-700"
                    onClick={() => setShowPassword((current) => !current)}
                    type="button"
                  >
                    {showPassword ? (
                      <EyeOff className="h-4 w-4" />
                    ) : (
                      <Eye className="h-4 w-4" />
                    )}
                  </button>
                </div>
                {isLogin && (
                  <span className="mt-2 flex justify-end">
                    <button
                      className="text-sm font-semibold text-blue-700 transition hover:text-blue-800 focus:outline-none focus:ring-2 focus:ring-blue-200"
                      onClick={() => onAuthModeChange("forgot")}
                      type="button"
                    >
                      Forgot Password?
                    </button>
                  </span>
                )}
              </label>
            )}

            {isVerify && (
              <label className="block">
                <span className="text-sm font-semibold text-slate-700">Verification code</span>
                <input
                  className="mt-2 h-11 w-full rounded-[20px] border border-slate-200 px-3 text-center text-lg font-bold tracking-[0.35em] outline-none focus:border-blue-400"
                  inputMode="numeric"
                  maxLength={6}
                  minLength={6}
                  name="code"
                  placeholder="000000"
                  required
                />
              </label>
            )}

            {isReset && (
              <>
                <label className="block">
                  <span className="text-sm font-semibold text-slate-700">
                    Confirm new password
                  </span>
                  <div className="mt-2 flex h-11 items-center rounded-[20px] border border-slate-200 px-3 focus-within:border-blue-400">
                    <input
                      className="h-full min-w-0 flex-1 bg-transparent text-sm outline-none"
                      minLength={8}
                      name="confirmPassword"
                      placeholder="Confirm your new password"
                      required
                      type={showConfirmPassword ? "text" : "password"}
                    />
                    <button
                      aria-label={showConfirmPassword ? "Hide password" : "Show password"}
                      className="ml-2 text-slate-400 transition hover:text-blue-700"
                      onClick={() => setShowConfirmPassword((current) => !current)}
                      type="button"
                    >
                      {showConfirmPassword ? (
                        <EyeOff className="h-4 w-4" />
                      ) : (
                        <Eye className="h-4 w-4" />
                      )}
                    </button>
                  </div>
                </label>
                <p className="rounded-[20px] bg-slate-50 px-4 py-3 text-xs leading-5 text-slate-500">
                  Use at least 8 characters with uppercase, lowercase, and a number.
                </p>
              </>
            )}
          </div>

          <button
            className="mt-6 h-11 w-full rounded-[20px] bg-blue-600 text-sm font-bold text-white shadow-lg shadow-blue-600/20 transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-blue-300"
            disabled={isLoading}
          >
            {isLoading ? "Please wait..." : submitLabel}
          </button>

          {isVerify && (
            <button
              className="mt-4 w-full text-sm font-semibold text-blue-700 disabled:cursor-not-allowed disabled:text-slate-400"
              disabled={isLoading || resendSeconds > 0}
              onClick={onResendCode}
              type="button"
            >
              {resendSeconds > 0 ? `Resend Code in ${resendSeconds}s` : "Resend Code"}
            </button>
          )}

          <button
            className="mt-4 w-full text-sm font-semibold text-blue-700"
            onClick={() => onAuthModeChange(isSignup ? "login" : "signup")}
            type="button"
          >
            {isSignup ? "Already have an account? Sign in" : "I don't have an account"}
          </button>

          {(isForgot || isVerify || isReset) && (
            <button
              className="mt-3 w-full text-sm font-semibold text-slate-500 transition hover:text-slate-800"
              onClick={() => onAuthModeChange("login")}
              type="button"
            >
              Back to Login
            </button>
          )}
        </form>
      </section>
    </main>
  );
}

function TopNav({
  onSignOut,
  query,
  setQuery,
  user,
}: {
  onSignOut: () => void;
  query: string;
  setQuery: (value: string) => void;
  user: UserProfile;
}) {
  const initials = getInitials(user.name);
  return (
    <header className="sticky top-0 z-40 border-b border-slate-200 bg-white/90 backdrop-blur-xl lg:pl-64">
      <div className="mx-auto flex h-16 max-w-[1180px] items-center gap-4 px-4 sm:px-6 lg:px-8">
        <div className="flex min-w-[220px] items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-[20px] bg-blue-600 text-sm font-bold text-white shadow-md shadow-blue-600/20">
            CV
          </div>
          <div>
            <p className="text-sm font-bold leading-4">CareerVault</p>
            <p className="text-xs text-slate-500">Secure document hub</p>
          </div>
        </div>

        <label className="mx-auto hidden h-10 w-full max-w-xl items-center gap-2 rounded-[20px] border border-slate-200 bg-slate-50 px-3 text-slate-500 transition focus-within:border-blue-300 focus-within:bg-white focus-within:ring-4 focus-within:ring-blue-100 md:flex">
          <Search className="h-4 w-4" />
          <input
            className="h-full min-w-0 flex-1 bg-transparent text-sm text-slate-900 outline-none placeholder:text-slate-400"
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search documents..."
            value={query}
          />
        </label>

        <div className="ml-auto flex items-center gap-3">
          <button
            aria-label="Notifications"
            className="flex h-10 w-10 items-center justify-center rounded-[20px] border border-slate-200 bg-white text-slate-600 transition hover:border-blue-200 hover:bg-blue-50 hover:text-blue-700"
          >
            <Bell className="h-4 w-4" />
          </button>

          <DropdownMenu.Root>
            <DropdownMenu.Trigger asChild>
              <button className="flex items-center gap-2 rounded-[20px] border border-transparent px-2 py-1.5 transition hover:border-slate-200 hover:bg-slate-50">
                <span className="flex h-8 w-8 items-center justify-center rounded-full bg-linear-to-br from-blue-600 to-violet-600 text-xs font-semibold text-white">
                  {initials}
                </span>
                <span className="hidden text-sm font-medium text-slate-800 sm:inline">
                  {user.name}
                </span>
                <ChevronDown className="h-4 w-4 text-slate-500" />
              </button>
            </DropdownMenu.Trigger>

            <DropdownMenu.Portal>
              <DropdownMenu.Content
                align="end"
                className="z-50 mt-2 w-56 origin-top-right rounded-[20px] border border-slate-200 bg-white p-2 shadow-xl shadow-slate-200/70 data-[state=open]:animate-in data-[state=open]:fade-in data-[state=open]:zoom-in-95"
              >
                <div className="mb-2 rounded-[20px] bg-slate-50 px-3 py-2">
                  <p className="text-sm font-bold text-slate-900">{user.name}</p>
                  <p className="text-xs text-slate-500">Secure Document Hub</p>
                </div>
                <DropdownItem icon={<User className="h-4 w-4" />} label="My Profile" />
                <DropdownItem
                  icon={<Settings className="h-4 w-4" />}
                  label="Account Settings"
                />
                <DropdownItem
                  icon={<HelpCircle className="h-4 w-4" />}
                  label="Help & Support"
                />
                <DropdownMenu.Separator className="my-2 h-px bg-slate-100" />
                <DropdownItem
                  danger
                  icon={<X className="h-4 w-4" />}
                  label="Sign Out"
                  onSelect={onSignOut}
                />
              </DropdownMenu.Content>
            </DropdownMenu.Portal>
          </DropdownMenu.Root>
        </div>
      </div>
    </header>
  );
}

function DropdownItem({
  danger,
  icon,
  label,
  onSelect,
}: {
  danger?: boolean;
  icon: React.ReactNode;
  label: string;
  onSelect?: () => void;
}) {
  return (
    <DropdownMenu.Item
      className={`flex cursor-pointer items-center gap-3 rounded-[20px] px-3 py-2 text-sm outline-none transition ${
        danger
          ? "text-red-600 hover:bg-red-50 focus:bg-red-50"
          : "text-slate-700 hover:bg-slate-50 focus:bg-slate-50"
      }`}
      onSelect={onSelect}
    >
      {icon}
      {label}
    </DropdownMenu.Item>
  );
}

function Sidebar({
  activeScreen,
  setScreen,
  user,
}: {
  activeScreen: Screen;
  setScreen: (screen: Screen) => void;
  user: UserProfile;
}) {
  const initials = getInitials(user.name);
  return (
    <aside className="fixed bottom-0 left-0 top-0 z-50 hidden w-64 bg-[#0d172b] p-6 text-white shadow-2xl lg:flex lg:flex-col">
      <div className="flex items-center gap-4">
        <div className="flex h-14 w-14 items-center justify-center rounded-[20px] bg-blue-500 text-xl font-bold shadow-lg shadow-blue-500/30">
          CV
        </div>
        <div>
          <p className="text-lg font-bold leading-5">CareerVault</p>
          <p className="mt-1 text-sm text-slate-400">Secure Document Hub</p>
        </div>
      </div>

      <nav className="mt-10 space-y-3">
        <SidebarItem
          active={activeScreen === "dashboard"}
          icon={<LayoutDashboard className="h-4 w-4" />}
          label="Dashboard"
          onClick={() => setScreen("dashboard")}
        />
        <SidebarItem
          active={activeScreen === "documents" || activeScreen === "viewer"}
          icon={<FileText className="h-4 w-4" />}
          label="Documents"
          onClick={() => setScreen("documents")}
        />
        <SidebarItem
          active={activeScreen === "upload"}
          icon={<UploadCloud className="h-4 w-4" />}
          label="Upload"
          onClick={() => setScreen("upload")}
        />
      </nav>

      <div className="mt-auto">
        <div className="rounded-[20px] bg-white/5 p-4 shadow-xl shadow-black/10">
          <div className="flex items-center gap-3">
            <span className="flex h-12 w-12 items-center justify-center rounded-full bg-blue-500 text-base font-bold text-white">
              {initials}
            </span>
            <div className="min-w-0">
              <p className="truncate text-base font-bold text-white">{user.name}</p>
            </div>
          </div>
        </div>
      </div>
    </aside>
  );
}

function MobileNav({
  activeScreen,
  setScreen,
}: {
  activeScreen: Screen;
  setScreen: (screen: Screen) => void;
}) {
  return (
    <nav className="sticky top-16 z-30 flex gap-2 overflow-x-auto border-b border-slate-200 bg-white px-4 py-3 lg:hidden">
      <MobileNavItem
        active={activeScreen === "dashboard"}
        label="Dashboard"
        onClick={() => setScreen("dashboard")}
      />
      <MobileNavItem
        active={activeScreen === "documents" || activeScreen === "viewer"}
        label="Documents"
        onClick={() => setScreen("documents")}
      />
      <MobileNavItem
        active={activeScreen === "upload"}
        label="Upload"
        onClick={() => setScreen("upload")}
      />
    </nav>
  );
}

function MobileNavItem({
  active,
  label,
  onClick,
}: {
  active: boolean;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      className={`shrink-0 rounded-[20px] px-3 py-2 text-sm font-medium transition ${
        active
          ? "bg-blue-50 text-blue-700"
          : "text-slate-600 hover:bg-slate-50 hover:text-slate-950"
      }`}
      onClick={onClick}
    >
      {label}
    </button>
  );
}

function SidebarItem({
  active,
  icon,
  label,
  onClick,
}: {
  active: boolean;
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      className={`flex w-full items-center gap-4 rounded-[20px] px-5 py-4 text-base font-semibold transition ${
        active
          ? "bg-blue-600 text-white shadow-lg shadow-blue-600/30"
          : "text-slate-400 hover:bg-white/6 hover:text-white"
      }`}
      onClick={onClick}
    >
      {icon}
      {label}
    </button>
  );
}

function DashboardScreen({
  documents,
  onDownload,
  onEdit,
  onOpen,
  recentlyUploaded,
  setScreen,
  user,
}: {
  documents: ManagedDocument[];
  onDownload: (document: ManagedDocument) => void;
  onEdit: (document: ManagedDocument) => void;
  onOpen: (document: ManagedDocument) => void;
  recentlyUploaded: ManagedDocument[];
  setScreen: (screen: Screen) => void;
  user: UserProfile;
}) {
  const companies = Array.from(
    new Map(documents.map((document) => [document.companyName, document])).values(),
  );
  const verifiedRecords = documents.filter((document) => document.status === "Verified").length;

  return (
    <div className="space-y-6">
      <DashboardHero onUpload={() => setScreen("upload")} user={user} />

      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        <StatCard
          icon={<FileText className="h-4 w-4" />}
          label="Total documents"
          value={documents.length.toString()}
        />
        <StatCard
          icon={<ShieldCheck className="h-4 w-4" />}
          label="Verified records"
          value={verifiedRecords.toString()}
        />
        <StatCard
          icon={<BriefcaseBusiness className="h-4 w-4" />}
          label="Companies"
          value={companies.length.toString()}
        />
      </section>

      <section className="grid gap-5 xl:grid-cols-[1.35fr_0.95fr]">
        <RecentUploadsCard
          documents={recentlyUploaded}
          onDownload={onDownload}
          onEdit={onEdit}
          onOpen={onOpen}
          onViewAll={() => setScreen("documents")}
        />
        <EmploymentTimeline documents={companies} />
      </section>
    </div>
  );
}

function DashboardHero({ onUpload, user }: { onUpload: () => void; user: UserProfile }) {
  return (
    <section className="relative overflow-hidden rounded-[20px] bg-[radial-gradient(circle_at_18%_10%,rgba(96,165,250,0.4),transparent_28%),linear-gradient(135deg,#101a3a_0%,#123fba_48%,#2f9ef5_100%)] p-7 text-white shadow-2xl shadow-blue-900/15 sm:p-8">
      <div className="absolute -right-16 -top-20 h-56 w-56 rounded-full bg-white/10 blur-2xl" />
      <div className="absolute bottom-0 right-24 h-28 w-28 rounded-full bg-cyan-300/20 blur-xl" />
      <div className="relative z-10 flex flex-col gap-6 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <h1 className="max-w-3xl text-3xl font-bold tracking-tight sm:text-4xl lg:text-5xl">
            Good afternoon, {user.name.split(" ")[0]}!
          </h1>
          <p className="mt-3 max-w-2xl text-sm leading-6 text-blue-50 sm:text-base">
            Here&apos;s your overview, your employment history organized and ready to
            share anytime.
          </p>
        </div>

        <button
          className="inline-flex h-12 items-center justify-center gap-2 rounded-[20px] bg-white px-5 text-sm font-bold text-blue-700 shadow-xl shadow-blue-950/20 transition duration-200 hover:scale-[1.02] hover:bg-blue-50 hover:shadow-2xl"
          onClick={onUpload}
        >
          <CloudUpload className="h-4 w-4" />
          Upload document
        </button>
      </div>
    </section>
  );
}

function RecentUploadsCard({
  documents,
  onDownload,
  onEdit,
  onOpen,
  onViewAll,
}: {
  documents: ManagedDocument[];
  onDownload: (document: ManagedDocument) => void;
  onEdit: (document: ManagedDocument) => void;
  onOpen: (document: ManagedDocument) => void;
  onViewAll: () => void;
}) {
  return (
    <section className="rounded-[20px] border border-slate-200/80 bg-white p-6 shadow-xl shadow-slate-200/60">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold tracking-tight text-slate-950">
            Recent uploads
          </h2>
          <p className="mt-1 text-sm text-slate-500">
            Fast access for onboarding & HR checks.
          </p>
        </div>
        <button
          className="rounded-[20px] px-3 py-2 text-sm font-semibold text-blue-700 transition hover:bg-blue-50"
          onClick={onViewAll}
        >
          View all
        </button>
      </div>

      <div className="mt-6 max-h-[388px] space-y-3 overflow-y-auto pr-1">
        {documents.map((document) => (
          <article
            className="group relative grid gap-4 rounded-[20px] border border-slate-200 bg-slate-50/70 p-4 pr-32 transition hover:border-blue-200 hover:bg-white hover:shadow-lg hover:shadow-slate-200/70 sm:grid-cols-[auto_1fr]"
            key={document.id}
          >
            <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-[20px] bg-blue-50 text-blue-700">
              <FileText className="h-6 w-6" />
            </div>

            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <h3 className="truncate font-bold text-slate-950">{document.companyName}</h3>
                {document.status === "Verified" && (
                  <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-bold text-emerald-600">
                    <ShieldCheck className="h-3 w-3" />
                    Verified
                  </span>
                )}
              </div>
              <p className="mt-1 text-sm text-slate-500">{document.designation}</p>
              <p className="mt-1 truncate text-xs text-slate-500">
                {document.fileName} · {document.fileSize} · {formatDate(document.uploadedAt)}
              </p>
            </div>

            <span className="absolute right-4 top-4 rounded-[20px] bg-blue-50 px-3 py-1.5 text-xs font-semibold text-blue-700">
              {document.documentType}
            </span>

            <div className="absolute bottom-4 right-4 flex items-center gap-2">
              <button
                aria-label={`View ${document.fileName}`}
                className="flex h-9 w-9 items-center justify-center rounded-[20px] bg-white text-slate-500 shadow-sm ring-1 ring-slate-200 transition hover:text-blue-700"
                onClick={() => onOpen(document)}
              >
                <Eye className="h-4 w-4" />
              </button>
              <button
                aria-label={`Edit ${document.fileName}`}
                className="flex h-9 w-9 items-center justify-center rounded-[20px] bg-white text-slate-500 shadow-sm ring-1 ring-slate-200 transition hover:text-blue-700"
                onClick={() => onEdit(document)}
              >
                <Pencil className="h-4 w-4" />
              </button>
              <button
                aria-label={`Download ${document.fileName}`}
                className="flex h-9 w-9 items-center justify-center rounded-[20px] bg-white text-slate-500 shadow-sm ring-1 ring-slate-200 transition hover:text-blue-700"
                onClick={() => onDownload(document)}
              >
                <Download className="h-4 w-4" />
              </button>
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}

function EmploymentTimeline({ documents }: { documents: ManagedDocument[] }) {
  return (
    <section className="rounded-[20px] border border-slate-200/80 bg-white p-6 shadow-xl shadow-slate-200/60">
      <h2 className="text-xl font-bold tracking-tight text-slate-950">
        Employment timeline
      </h2>
      <p className="mt-1 text-sm text-slate-500">Your career, in order.</p>

      <div className="mt-6 max-h-[388px] space-y-7 overflow-y-auto pr-1">
        {documents.map((document, index) => (
          <div className="relative flex gap-4" key={document.companyName}>
            {index !== documents.length - 1 && (
              <span className="absolute left-[7px] top-5 h-[calc(100%+1rem)] w-px bg-slate-200" />
            )}
            <span className="relative mt-1 h-4 w-4 shrink-0 rounded-full bg-blue-500 shadow-md shadow-blue-500/30 ring-4 ring-blue-50" />
            <div>
              <h3 className="font-bold text-slate-950">{document.companyName}</h3>
              <p className="mt-1 text-sm text-slate-500">{document.designation}</p>
              <p className="mt-1 text-sm text-slate-500">
                {formatDate(document.joiningDate)} - {formatDate(document.relievingDate)}
              </p>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

function DocumentsScreen({
  categoryFilter,
  documents,
  onDelete,
  onDownload,
  onEdit,
  onOpen,
  query,
  setCategoryFilter,
  setQuery,
  setSortMode,
  sortMode,
}: {
  categoryFilter: string;
  documents: ManagedDocument[];
  onDelete: (document: ManagedDocument) => void;
  onDownload: (document: ManagedDocument) => void;
  onEdit: (document: ManagedDocument) => void;
  onOpen: (document: ManagedDocument) => void;
  query: string;
  setCategoryFilter: (category: string) => void;
  setQuery: (query: string) => void;
  setSortMode: (mode: SortMode) => void;
  sortMode: SortMode;
}) {
  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow="Documents"
        title="My Documents"
        subtitle="Manage and access all your career documents securely."
      />

      <section className="rounded-[20px] border border-slate-200 bg-white p-4 shadow-sm">
        <div className="grid gap-3 lg:grid-cols-[1fr_220px_180px_180px]">
          <label className="flex h-11 items-center gap-2 rounded-[20px] border border-slate-200 bg-slate-50 px-3 text-slate-500 focus-within:border-blue-300 focus-within:bg-white">
            <Search className="h-4 w-4" />
            <input
              className="h-full min-w-0 flex-1 bg-transparent text-sm text-slate-900 outline-none"
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search Documents"
              value={query}
            />
          </label>
          <select
            className="h-11 rounded-[20px] border border-slate-200 bg-white px-3 text-sm outline-none focus:border-blue-300"
            onChange={(event) => setCategoryFilter(event.target.value)}
            value={categoryFilter}
          >
            <option>All</option>
            {documentTypes.map((type) => (
              <option key={type}>{type}</option>
            ))}
          </select>
          <button
            className="h-11 rounded-[20px] border border-slate-200 bg-white px-3 text-sm font-medium text-slate-700 transition hover:bg-slate-50"
            onClick={() => setSortMode("Newest")}
          >
            Sort by Date
          </button>
          <button
            className={`h-11 rounded-[20px] border px-3 text-sm font-medium transition ${
              sortMode === "Name"
                ? "border-blue-200 bg-blue-50 text-blue-700"
                : "border-slate-200 bg-white text-slate-700 hover:bg-slate-50"
            }`}
            onClick={() => setSortMode("Name")}
          >
            Sort by Name
          </button>
        </div>
      </section>

      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {documents.map((document) => (
          <DocumentCard
            document={document}
            key={document.id}
            onDelete={onDelete}
            onDownload={onDownload}
            onEdit={onEdit}
            onOpen={onOpen}
          />
        ))}
      </section>
    </div>
  );
}

function UploadScreen({
  form,
  isParsingUpload,
  onFileChange,
  onSubmit,
  setForm,
  uploadFile,
}: {
  form: {
    name: string;
    category: string;
    description: string;
    companyName: string;
    designation: string;
    employmentPeriod: string;
    salaryMonth: string;
  };
  isParsingUpload: boolean;
  onFileChange: (event: ChangeEvent<HTMLInputElement>) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  setForm: (form: {
    name: string;
    category: string;
    description: string;
    companyName: string;
    designation: string;
    employmentPeriod: string;
    salaryMonth: string;
  }) => void;
  uploadFile: File | null;
}) {
  return (
    <form className="space-y-5" onSubmit={onSubmit}>
      <PageHeader
        eyebrow="Upload"
        title="Upload Documents"
        subtitle="Securely store your important career documents."
      />

      <section className="grid gap-5 xl:grid-cols-[1fr_420px]">
        <label className="flex min-h-[340px] cursor-pointer flex-col items-center justify-center rounded-[20px] border-2 border-dashed border-blue-200 bg-white p-6 text-center shadow-sm transition hover:border-blue-400 hover:bg-blue-50/40">
          <UploadCloud className="h-12 w-12 text-blue-600" />
          <p className="mt-4 text-lg font-semibold">Drag & Drop Files</p>
          <p className="mt-2 max-w-md text-sm text-slate-500">
            Browse files or drag documents here. Supported formats: PDF, DOC, DOCX,
            JPG, PNG.
          </p>
          <span className="mt-5 rounded-[20px] bg-blue-600 px-4 py-2 text-sm font-semibold text-white shadow-md shadow-blue-600/20">
            Browse Files
          </span>
          <input
            accept=".pdf,.doc,.docx,.jpg,.jpeg,.png"
            className="sr-only"
            onChange={onFileChange}
            type="file"
          />
          {uploadFile && (
            <p className="mt-4 rounded-[20px] bg-slate-100 px-3 py-2 text-sm text-slate-700">
              Selected: {uploadFile.name}
            </p>
          )}
        </label>

        <div className="rounded-[20px] border border-slate-200 bg-white p-4 shadow-sm">
          <h2 className="text-lg font-semibold">Document Details</h2>
          <div className="mt-4 space-y-4">
            {isParsingUpload && (
              <div className="rounded-[20px] bg-blue-50 px-4 py-3 text-sm font-medium text-blue-700">
                Extracting document information...
              </div>
            )}
            <FormField
              label="Document Name"
              onChange={(value) => setForm({ ...form, name: value })}
              placeholder="e.g. BluePeak Experience Letter"
              value={form.name}
            />
            <FormField
              label="Company Name"
              onChange={(value) => setForm({ ...form, companyName: value })}
              placeholder="Extracted company name"
              value={form.companyName}
            />
            <FormField
              label="Designation / Job Title"
              onChange={(value) => setForm({ ...form, designation: value })}
              placeholder="Extracted designation"
              value={form.designation}
            />
            <FormField
              label={
                form.category === "Salary Slip"
                  ? "Salary Month"
                  : "Employment Duration / Working Period"
              }
              onChange={(value) =>
                setForm(
                  form.category === "Salary Slip"
                    ? { ...form, salaryMonth: value }
                    : { ...form, employmentPeriod: value },
                )
              }
              placeholder={form.category === "Salary Slip" ? "January 2026" : "Jan 2024 - Present"}
              value={form.category === "Salary Slip" ? form.salaryMonth : form.employmentPeriod}
            />
            <label className="block">
              <span className="text-sm font-medium text-slate-700">Document Category</span>
              <select
                className="mt-2 h-11 w-full rounded-[20px] border border-slate-200 px-3 text-sm outline-none focus:border-blue-300"
                onChange={(event) => setForm({ ...form, category: event.target.value })}
                value={form.category}
              >
                {documentTypes.map((type) => (
                  <option key={type}>{type}</option>
                ))}
              </select>
            </label>
            <button className="h-11 w-full rounded-[20px] bg-blue-600 text-sm font-semibold text-white shadow-md shadow-blue-600/20 transition hover:bg-blue-700">
              Upload Document
            </button>
          </div>
        </div>
      </section>
    </form>
  );
}

function DocumentViewerScreen({
  document,
  onBack,
  onDelete,
  onDownload,
  onEdit,
  setZoom,
  zoom,
}: {
  document: ManagedDocument;
  onBack: () => void;
  onDelete: (document: ManagedDocument) => void;
  onDownload: (document: ManagedDocument) => void;
  onEdit: (document: ManagedDocument) => void;
  setZoom: (zoom: number) => void;
  zoom: number;
}) {
  return (
    <div className="space-y-5">
      <div className="flex flex-col justify-between gap-4 rounded-[20px] border border-slate-200 bg-white p-5 shadow-sm sm:flex-row sm:items-center">
        <div>
          <button className="text-sm font-semibold text-blue-700" onClick={onBack}>
            Back to Documents
          </button>
          <h1 className="mt-2 text-2xl font-bold tracking-tight">{document.fileName}</h1>
          <p className="mt-1 text-sm text-slate-500">
            {document.documentType} · {document.companyName} · {document.fileSize}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <ViewerButton icon={<ZoomOut className="h-4 w-4" />} onClick={() => setZoom(Math.max(50, zoom - 10))}>
            Zoom Out
          </ViewerButton>
          <ViewerButton icon={<ZoomIn className="h-4 w-4" />} onClick={() => setZoom(Math.min(160, zoom + 10))}>
            Zoom In
          </ViewerButton>
          <ViewerButton icon={<Download className="h-4 w-4" />} onClick={() => onDownload(document)}>
            Download
          </ViewerButton>
          <ViewerButton icon={<Pencil className="h-4 w-4" />} onClick={() => onEdit(document)}>
            Edit
          </ViewerButton>
          <ViewerButton danger icon={<Trash2 className="h-4 w-4" />} onClick={() => onDelete(document)}>
            Delete
          </ViewerButton>
        </div>
      </div>

      <section className="grid gap-5 xl:grid-cols-[1fr_360px]">
        <div className="rounded-[20px] border border-slate-200 bg-white p-5 shadow-sm">
          <div className="mb-4 flex items-center justify-between">
            <div>
              <h2 className="text-lg font-bold">Document Preview</h2>
              <p className="text-sm text-slate-500">Preview generated from uploaded content.</p>
            </div>
            <span className="rounded-[20px] bg-blue-50 px-3 py-1 text-xs font-bold text-blue-700">
              {zoom}%
            </span>
          </div>
          <div className="flex min-h-[560px] items-center justify-center overflow-hidden rounded-[20px] bg-slate-100 p-6">
            <div
              className="flex aspect-4/5 w-full max-w-md flex-col justify-between rounded-[20px] border border-slate-200 bg-white p-8 shadow-lg shadow-slate-200/70 transition-transform duration-200"
              style={{ transform: `scale(${zoom / 100})` }}
            >
              <div>
                <div className="flex h-14 w-14 items-center justify-center rounded-[20px] bg-blue-50 text-blue-700">
                  <FileText className="h-7 w-7" />
                </div>
                <h3 className="mt-5 text-xl font-bold text-slate-950">{document.fileName}</h3>
                <p className="mt-2 text-sm leading-6 text-slate-500">
                  {document.extractedText?.slice(0, 260) || "No readable text was detected in this file."}
                </p>
              </div>
              <div className="mt-6 border-t border-slate-100 pt-4 text-sm text-slate-500">
                {document.companyName} · {document.designation}
              </div>
            </div>
          </div>
        </div>

        <aside className="space-y-5">
          <div className="rounded-[20px] border border-slate-200 bg-white p-5 shadow-sm">
            <h2 className="text-lg font-bold">Document Details</h2>
            <dl className="mt-4 space-y-3">
              <ViewerMeta label="Company" value={document.companyName} />
              <ViewerMeta label="Designation" value={document.designation} />
              <ViewerMeta
                label="Employment Period"
                value={document.employmentPeriod ?? `${formatDate(document.joiningDate)} - ${formatDate(document.relievingDate)}`}
              />
              <ViewerMeta label="Category" value={document.documentType} />
              <ViewerMeta label="Uploaded" value={formatDate(document.uploadedAt)} />
              <ViewerMeta label="File Type" value={document.fileType} />
            </dl>
          </div>

          <div className="rounded-[20px] border border-slate-200 bg-white p-5 shadow-sm">
            <h2 className="text-lg font-bold">Extracted Content</h2>
            <p className="mt-3 max-h-72 overflow-auto whitespace-pre-wrap rounded-[20px] bg-slate-50 p-4 text-sm leading-6 text-slate-600">
              {document.extractedText || "No readable text was detected in this file."}
            </p>
          </div>
        </aside>
      </section>
    </div>
  );
}

function PageHeader({
  eyebrow,
  subtitle,
  title,
}: {
  eyebrow: string;
  subtitle: string;
  title: string;
}) {
  return (
    <section className="rounded-[20px] border border-slate-200 bg-white p-5 shadow-sm">
      <p className="text-xs font-semibold uppercase tracking-[0.18em] text-blue-600">
        {eyebrow}
      </p>
      <h1 className="mt-2 text-3xl font-semibold tracking-tight text-slate-950">{title}</h1>
      <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-500">{subtitle}</p>
    </section>
  );
}

function StatCard({
  icon,
  label,
  value,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
}) {
  return (
    <div className="rounded-[24px] border border-slate-200/80 bg-white p-5 shadow-xl shadow-slate-200/50">
      <div className="flex h-10 w-10 items-center justify-center rounded-[20px] bg-blue-50 text-blue-700">
        {icon}
      </div>
      <p className="mt-5 text-sm font-medium text-slate-500">{label}</p>
      <p className="mt-1 text-3xl font-bold tracking-tight text-slate-950">{value}</p>
    </div>
  );
}

function DocumentCard({
  document,
  onDelete,
  onDownload,
  onEdit,
  onOpen,
}: {
  document: ManagedDocument;
  onDelete: (document: ManagedDocument) => void;
  onDownload: (document: ManagedDocument) => void;
  onEdit: (document: ManagedDocument) => void;
  onOpen: (document: ManagedDocument) => void;
}) {
  return (
    <article className="rounded-[20px] border border-slate-200 bg-white p-4 shadow-sm transition hover:-translate-y-0.5 hover:shadow-md">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <p className="truncate font-semibold">{document.fileName}</p>
        </div>
        <span className="rounded-[20px] bg-blue-50 px-2 py-1 text-xs font-semibold text-blue-700">
          {document.fileType}
        </span>
      </div>

      <dl className="mt-4 grid grid-cols-2 gap-3 text-sm">
        <DocumentMeta label="Category" value={document.documentType} />
        <DocumentMeta label="Upload Date" value={formatDate(document.uploadedAt)} />
        <DocumentMeta label="File Size" value={document.fileSize} />
        <DocumentMeta label="Company" value={document.companyName} />
      </dl>

      <div className="mt-4 flex items-center gap-2">
        <ActionIcon label="View Document" onClick={() => onOpen(document)}>
          <Eye className="h-4 w-4" />
        </ActionIcon>
        <ActionIcon label="Download Document" onClick={() => onDownload(document)}>
          <Download className="h-4 w-4" />
        </ActionIcon>
        <ActionIcon label="Edit Document" onClick={() => onEdit(document)}>
          <Pencil className="h-4 w-4" />
        </ActionIcon>
        <ActionIcon danger label="Delete Document" onClick={() => onDelete(document)}>
          <Trash2 className="h-4 w-4" />
        </ActionIcon>
      </div>
    </article>
  );
}

function DocumentMeta({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs font-medium uppercase tracking-wide text-slate-400">{label}</dt>
      <dd className="mt-1 truncate text-slate-700">{value}</dd>
    </div>
  );
}

function ActionIcon({
  children,
  danger,
  label,
  onClick,
}: {
  children: React.ReactNode;
  danger?: boolean;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      aria-label={label}
      className={`flex h-9 w-9 items-center justify-center rounded-[20px] border transition ${
        danger
          ? "border-red-100 bg-red-50 text-red-600 hover:bg-red-100"
          : "border-slate-200 bg-white text-slate-600 hover:bg-blue-50 hover:text-blue-700"
      }`}
      onClick={onClick}
      type="button"
    >
      {children}
    </button>
  );
}

function FormField({
  label,
  onChange,
  placeholder,
  value,
}: {
  label: string;
  onChange: (value: string) => void;
  placeholder: string;
  value: string;
}) {
  return (
    <label className="block">
      <span className="text-sm font-medium text-slate-700">{label}</span>
      <input
        className="mt-2 h-11 w-full rounded-[20px] border border-slate-200 px-3 text-sm outline-none focus:border-blue-300"
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        value={value}
      />
    </label>
  );
}

function ViewerMeta({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-[20px] bg-slate-50 p-3">
      <dt className="text-xs font-semibold uppercase tracking-wide text-slate-400">
        {label}
      </dt>
      <dd className="mt-1 text-sm font-semibold text-slate-800">{value}</dd>
    </div>
  );
}

function ViewerButton({
  children,
  danger,
  icon,
  onClick,
}: {
  children: React.ReactNode;
  danger?: boolean;
  icon: React.ReactNode;
  onClick: () => void;
}) {
  return (
    <button
      className={`flex h-10 items-center gap-2 rounded-[20px] border px-3 text-sm font-medium transition ${
        danger
          ? "border-red-100 bg-red-50 text-red-600 hover:bg-red-100"
          : "border-slate-200 bg-white text-slate-700 hover:bg-slate-50"
      }`}
      onClick={onClick}
    >
      {icon}
      {children}
    </button>
  );
}

function EditDocumentDialog({
  document,
  onCancel,
  onDelete,
  onSave,
}: {
  document: ManagedDocument | null;
  onCancel: () => void;
  onDelete: (document: ManagedDocument) => void;
  onSave: (document: ManagedDocument) => void;
}) {
  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!document) {
      return;
    }

    const formData = new FormData(event.currentTarget);
    const companyName = String(formData.get("companyName") || document.companyName).trim();
    const designation = String(formData.get("designation") || document.designation).trim();
    const employmentPeriod = String(
      formData.get("employmentPeriod") || document.employmentPeriod || "",
    ).trim();
    const salaryMonth = String(formData.get("salaryMonth") || document.salaryMonth || "").trim();
    const documentType = String(formData.get("documentType") || document.documentType) as ManagedDocument["documentType"];
    const fileName = String(formData.get("fileName") || document.fileName).trim();

    onSave({
      ...document,
      companyName,
      designation,
      documentType,
      fileName,
      employmentPeriod:
        documentType === "Salary Slip"
          ? salaryMonth || employmentPeriod || document.employmentPeriod
          : employmentPeriod || document.employmentPeriod,
      salaryMonth: documentType === "Salary Slip" ? salaryMonth : document.salaryMonth,
      description: `${documentType} for ${designation} at ${companyName}.`,
      extractedText: [
        document.extractedText,
        "",
        "Reviewed metadata",
        `Company Name: ${companyName}`,
        `Designation: ${designation}`,
        `Employment Period: ${employmentPeriod || document.employmentPeriod || "Not specified"}`,
        documentType === "Salary Slip" && salaryMonth ? `Salary Month: ${salaryMonth}` : "",
      ]
        .filter(Boolean)
        .join("\n"),
    });
  }

  return (
    <Dialog.Root open={Boolean(document)} onOpenChange={(open) => !open && onCancel()}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-slate-950/40 backdrop-blur-sm" />
        <Dialog.Content className="fixed left-1/2 top-1/2 z-50 w-[calc(100%-2rem)] max-w-2xl -translate-x-1/2 -translate-y-1/2 rounded-[20px] border border-slate-200 bg-white p-5 shadow-2xl">
          <Dialog.Title className="text-xl font-bold">Edit Document</Dialog.Title>
          <Dialog.Description className="mt-2 text-sm text-slate-500">
            Update the extracted metadata used across dashboard, search, and document details.
          </Dialog.Description>

          {document && (
            <form className="mt-5 space-y-4" onSubmit={handleSubmit}>
              <div className="grid gap-4 sm:grid-cols-2">
                <label className="block sm:col-span-2">
                  <span className="text-sm font-semibold text-slate-700">Document Name</span>
                  <input
                    className="mt-2 h-11 w-full rounded-[20px] border border-slate-200 px-3 text-sm outline-none focus:border-blue-300"
                    defaultValue={document.fileName}
                    name="fileName"
                  />
                </label>
                <label className="block">
                  <span className="text-sm font-semibold text-slate-700">Company Name</span>
                  <input
                    className="mt-2 h-11 w-full rounded-[20px] border border-slate-200 px-3 text-sm outline-none focus:border-blue-300"
                    defaultValue={document.companyName}
                    name="companyName"
                  />
                </label>
                <label className="block">
                  <span className="text-sm font-semibold text-slate-700">Designation / Job Title</span>
                  <input
                    className="mt-2 h-11 w-full rounded-[20px] border border-slate-200 px-3 text-sm outline-none focus:border-blue-300"
                    defaultValue={document.designation}
                    name="designation"
                  />
                </label>
                <label className="block">
                  <span className="text-sm font-semibold text-slate-700">Document Type</span>
                  <select
                    className="mt-2 h-11 w-full rounded-[20px] border border-slate-200 px-3 text-sm outline-none focus:border-blue-300"
                    defaultValue={document.documentType}
                    name="documentType"
                  >
                    {documentTypes.map((type) => (
                      <option key={type}>{type}</option>
                    ))}
                  </select>
                </label>
                <label className="block">
                  <span className="text-sm font-semibold text-slate-700">Employment Period</span>
                  <input
                    className="mt-2 h-11 w-full rounded-[20px] border border-slate-200 px-3 text-sm outline-none focus:border-blue-300"
                    defaultValue={document.employmentPeriod}
                    name="employmentPeriod"
                    placeholder="Jan 2024 - Present"
                  />
                </label>
                <label className="block sm:col-span-2">
                  <span className="text-sm font-semibold text-slate-700">Salary Month</span>
                  <input
                    className="mt-2 h-11 w-full rounded-[20px] border border-slate-200 px-3 text-sm outline-none focus:border-blue-300"
                    defaultValue={document.salaryMonth}
                    name="salaryMonth"
                    placeholder="January 2026"
                  />
                </label>
              </div>

              <div className="flex flex-col-reverse gap-3 pt-2 sm:flex-row sm:justify-between">
                <button
                  className="h-10 rounded-[20px] bg-red-50 px-4 text-sm font-semibold text-red-600 hover:bg-red-100"
                  onClick={() => onDelete(document)}
                  type="button"
                >
                  Delete Document
                </button>
                <div className="flex gap-3">
                  <button
                    className="h-10 rounded-[20px] border border-slate-200 px-4 text-sm font-medium text-slate-700 hover:bg-slate-50"
                    onClick={onCancel}
                    type="button"
                  >
                    Cancel
                  </button>
                  <button className="h-10 rounded-[20px] bg-blue-600 px-4 text-sm font-semibold text-white hover:bg-blue-700">
                    Save Changes
                  </button>
                </div>
              </div>
            </form>
          )}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function DeleteDialog({
  document,
  onCancel,
  onConfirm,
}: {
  document: ManagedDocument | null;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <Dialog.Root open={Boolean(document)} onOpenChange={(open) => !open && onCancel()}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-slate-950/40 backdrop-blur-sm" />
        <Dialog.Content className="fixed left-1/2 top-1/2 z-50 w-[calc(100%-2rem)] max-w-md -translate-x-1/2 -translate-y-1/2 rounded-[20px] border border-slate-200 bg-white p-5 shadow-2xl">
          <Dialog.Title className="text-lg font-semibold">Delete document</Dialog.Title>
          <Dialog.Description className="mt-2 text-sm leading-6 text-slate-500">
            Are you sure you want to delete this document?
          </Dialog.Description>
          {document && (
            <p className="mt-4 rounded-[20px] bg-slate-50 px-3 py-2 text-sm font-medium text-slate-700">
              {document.fileName}
            </p>
          )}
          <div className="mt-5 flex justify-end gap-3">
            <button
              className="h-10 rounded-[20px] border border-slate-200 px-4 text-sm font-medium text-slate-700 hover:bg-slate-50"
              onClick={onCancel}
            >
              Cancel
            </button>
            <button
              className="h-10 rounded-[20px] bg-red-600 px-4 text-sm font-semibold text-white hover:bg-red-700"
              onClick={onConfirm}
            >
              Delete
            </button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function Toast({ message }: { message: string }) {
  if (!message) {
    return null;
  }

  return (
    <div className="fixed bottom-4 right-4 z-50 max-w-sm rounded-[20px] border border-slate-200 bg-white px-4 py-3 text-sm font-medium text-slate-700 shadow-xl shadow-slate-200/70">
      {message}
    </div>
  );
}
