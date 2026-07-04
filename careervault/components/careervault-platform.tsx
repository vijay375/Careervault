"use client";

import * as Dialog from "@radix-ui/react-dialog";
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import {
  ArrowLeft,
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
  Folder,
} from "lucide-react";
import { ChangeEvent, FormEvent, useEffect, useMemo, useRef, useState } from "react";
import {
  documentTypes,
  formatDate,
  VaultDocument,
} from "@/lib/careervault-data";

type Screen = "dashboard" | "documents" | "upload" | "viewer" | "profile";
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
  id: string;
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
  id: "",
  name: "",
  email: "",
};

const allowedExtensions = ["pdf", "doc", "docx", "jpg", "jpeg", "png"];
const resendCooldownMs = 60 * 1000;
const globalSearchResultLimit = 8;
const loadingRevealDelayMs = 200;

function useDelayedLoading(isLoading: boolean) {
  const [showLoading, setShowLoading] = useState(false);

  useEffect(() => {
    if (!isLoading) {
      setShowLoading(false);
      return;
    }

    const timeoutId = window.setTimeout(() => {
      setShowLoading(true);
    }, loadingRevealDelayMs);

    return () => window.clearTimeout(timeoutId);
  }, [isLoading]);

  return isLoading && showLoading;
}

function documentMatchesSearch(document: ManagedDocument, normalizedQuery: string) {
  if (!normalizedQuery) {
    return true;
  }

  return (
    document.fileName.toLowerCase().includes(normalizedQuery) ||
    document.companyName.toLowerCase().includes(normalizedQuery) ||
    document.designation.toLowerCase().includes(normalizedQuery) ||
    document.employmentPeriod?.toLowerCase().includes(normalizedQuery) ||
    document.documentType.toLowerCase().includes(normalizedQuery)
  );
}

function getDocumentLocation(document: ManagedDocument, recentDocumentIds: Set<string>) {
  if (recentDocumentIds.has(document.id)) {
    return "Dashboard · Recent Uploads";
  }

  return "Documents Page";
}

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
    credentials: "include",
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

async function parseApiResponse<T>(response: Response) {
  const data = (await response.json().catch(() => ({
    ok: false,
    message: "A network error occurred. Please try again.",
  }))) as T & { ok?: boolean; message?: string };

  if (!response.ok || data.ok === false) {
    throw new Error(data.message || "Something went wrong. Please try again.");
  }

  return data;
}

function getInitials(name: string) {
  return name
    .split(" ")
    .map((part) => part[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
}

function getFirstName(name: string) {
  return name.trim().split(/\s+/)[0] || "";
}

function getWelcomeGreeting(name: string) {
  const firstName = getFirstName(name);
  return firstName ? `Welcome Back, ${firstName}!` : "Welcome Back!";
}

function parseEmploymentDate(value?: string) {
  if (!value?.trim()) {
    return null;
  }

  const normalized = value.trim();
  const dayMonthYear = normalized.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (dayMonthYear) {
    return new Date(
      Number(dayMonthYear[3]),
      Number(dayMonthYear[2]) - 1,
      Number(dayMonthYear[1]),
    ).getTime();
  }

  const isoMatch = normalized.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (isoMatch) {
    return new Date(`${isoMatch[1]}-${isoMatch[2]}-${isoMatch[3]}`).getTime();
  }

  const parsed = Date.parse(normalized);
  return Number.isNaN(parsed) ? null : parsed;
}

function formatEmploymentPeriodDate(value?: string) {
  const timestamp = parseEmploymentDate(value);
  if (timestamp === null) {
    return null;
  }

  return new Intl.DateTimeFormat("en", {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(new Date(timestamp));
}

function formatEmploymentPeriodText(period: string) {
  const parts = period.split(/\s[-–]\s/);
  if (parts.length !== 2) {
    return period.trim();
  }

  const start = formatEmploymentPeriodDate(parts[0]) ?? parts[0].trim();
  const endPart = parts[1].trim();

  if (/present/i.test(endPart)) {
    return start;
  }

  const end = formatEmploymentPeriodDate(endPart) ?? endPart;
  return `${start} - ${end}`;
}

function getEmploymentPeriodDisplay(document: ManagedDocument) {
  if (document.employmentPeriod?.trim()) {
    return formatEmploymentPeriodText(document.employmentPeriod);
  }

  const start = formatEmploymentPeriodDate(document.joiningDate) ?? "—";
  const end = document.relievingDate
    ? formatEmploymentPeriodDate(document.relievingDate)
    : null;

  if (!end) {
    return start;
  }

  return `${start} - ${end}`;
}

function isPresentEmployment(document: ManagedDocument) {
  if (document.relievingDate?.trim()) {
    return false;
  }

  const period = document.employmentPeriod?.trim() ?? "";
  if (!period) {
    return true;
  }

  const endPart = period.split(/\s[-–]\s/)[1]?.trim() ?? "";
  return !endPart || /present/i.test(endPart);
}

function getEmploymentEndSortValue(document: ManagedDocument) {
  const relievingTimestamp = parseEmploymentDate(document.relievingDate);
  if (relievingTimestamp !== null) {
    return relievingTimestamp;
  }

  const periodEnd = document.employmentPeriod?.split(/\s[-–]\s/)[1]?.trim();
  if (periodEnd && !/present/i.test(periodEnd)) {
    return parseEmploymentDate(periodEnd) ?? 0;
  }

  return parseEmploymentDate(document.joiningDate) ?? 0;
}

function sortEmploymentRecords(documents: ManagedDocument[]) {
  return [...documents].sort((first, second) => {
    const endDifference = getEmploymentEndSortValue(second) - getEmploymentEndSortValue(first);
    if (endDifference !== 0) {
      return endDifference;
    }

    return (
      (parseEmploymentDate(second.joiningDate) ?? 0) -
      (parseEmploymentDate(first.joiningDate) ?? 0)
    );
  });
}

const employmentTimelineDocumentTypes = new Set(["Experience Letter", "Relieving Letter"]);

function buildEmploymentTimelineRecords(documents: ManagedDocument[]) {
  const eligibleDocuments = documents.filter(
    (document) =>
      employmentTimelineDocumentTypes.has(document.documentType) &&
      !isPresentEmployment(document),
  );

  const recordsByCompany = new Map<string, ManagedDocument>();

  for (const document of eligibleDocuments) {
    const companyKey = document.companyName.trim().toLowerCase();
    const existing = recordsByCompany.get(companyKey);

    if (!existing) {
      recordsByCompany.set(companyKey, document);
      continue;
    }

    if (
      document.documentType === "Relieving Letter" &&
      existing.documentType !== "Relieving Letter"
    ) {
      recordsByCompany.set(companyKey, document);
      continue;
    }

    if (
      existing.documentType === "Relieving Letter" &&
      document.documentType !== "Relieving Letter"
    ) {
      continue;
    }

    if (getEmploymentEndSortValue(document) > getEmploymentEndSortValue(existing)) {
      recordsByCompany.set(companyKey, document);
    }
  }

  return sortEmploymentRecords(Array.from(recordsByCompany.values()));
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
  const [isSessionLoading, setIsSessionLoading] = useState(true);
  const [sessionLoadProgress, setSessionLoadProgress] = useState(0);
  const [authMode, setAuthMode] = useState<AuthMode>("login");
  const [authMessage, setAuthMessage] = useState("");
  const [authLoading, setAuthLoading] = useState(false);
  const [authFormKey, setAuthFormKey] = useState(0);
  const [loginPrefillEmail, setLoginPrefillEmail] = useState("");
  const [resetEmail, setResetEmail] = useState("");
  const [resendAvailableAt, setResendAvailableAt] = useState(0);
  const [resendSeconds, setResendSeconds] = useState(0);
  const [screen, setScreen] = useState<Screen>(() => {
    if (typeof window === "undefined") {
      return "dashboard";
    }

    const savedScreen = window.localStorage.getItem("careervault-screen");
    return savedScreen && ["dashboard", "documents", "upload"].includes(savedScreen)
      ? (savedScreen as Screen)
      : "dashboard";
  });
  const [documents, setDocuments] = useState<ManagedDocument[]>([]);
  const [isDocumentsLoading, setIsDocumentsLoading] = useState(false);
  const [selectedDocumentId, setSelectedDocumentId] = useState<string | null>(null);
  const [documentToDelete, setDocumentToDelete] = useState<ManagedDocument | null>(null);
  const [documentToEdit, setDocumentToEdit] = useState<ManagedDocument | null>(null);
  const [toast, setToast] = useState("");
  const [globalQuery, setGlobalQuery] = useState("");
  const [documentQuery, setDocumentQuery] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("All");
  const [sortMode, setSortMode] = useState<SortMode>("Newest");
  const [profileReturnScreen, setProfileReturnScreen] = useState<
    "dashboard" | "documents" | "upload"
  >("dashboard");
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
  const [isSavingUpload, setIsSavingUpload] = useState(false);

  const selectedDocument = documents.find((document) => document.id === selectedDocumentId);
  const isInitialContentLoading = isDocumentsLoading && documents.length === 0;

  const filteredDocuments = useMemo(() => {
    const normalizedQuery = documentQuery.trim().toLowerCase();
    const matchingDocuments = documents.filter((document) => {
      const matchesSearch = documentMatchesSearch(document, normalizedQuery);
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
  }, [categoryFilter, documentQuery, documents, sortMode]);

  const recentlyUploaded = documents;

  const recentDocumentIds = useMemo(
    () =>
      new Set(
        [...documents]
          .sort(
            (first, second) =>
              new Date(second.uploadedAt).getTime() - new Date(first.uploadedAt).getTime(),
          )
          .slice(0, 4)
          .map((document) => document.id),
      ),
    [documents],
  );

  const globalSearchResults = useMemo(() => {
    const normalizedQuery = globalQuery.trim().toLowerCase();
    if (!normalizedQuery) {
      return [];
    }

    return documents
      .filter((document) => documentMatchesSearch(document, normalizedQuery))
      .slice(0, globalSearchResultLimit);
  }, [documents, globalQuery]);

  function handleGlobalSearchSelect(document: ManagedDocument) {
    setGlobalQuery("");
    setDocumentQuery(document.fileName);
    setScreen("documents");
  }

  function openProfile() {
    if (screen !== "profile" && screen !== "viewer") {
      setProfileReturnScreen(
        screen === "documents" || screen === "upload" ? screen : "dashboard",
      );
    }

    setScreen("profile");
  }

  function closeProfile() {
    setScreen(profileReturnScreen);
  }

  async function loadDocuments() {
    setIsDocumentsLoading(true);

    try {
      const response = await fetch("/api/documents", {
        credentials: "include",
      });
      const data = await parseApiResponse<{
        documents: ManagedDocument[];
      }>(response);
      setDocuments(data.documents);
    } finally {
      setIsDocumentsLoading(false);
    }
  }

  useEffect(() => {
    async function restoreSession() {
      setSessionLoadProgress(12);

      try {
        setSessionLoadProgress(28);
        const response = await fetch("/api/auth/session", {
          credentials: "include",
        });
        setSessionLoadProgress(52);
        const data = await parseApiResponse<{
          user: UserProfile;
        }>(response);
        setCurrentUser(data.user);
        setIsAuthenticated(true);
        setSessionLoadProgress(72);
        await loadDocuments();
        setSessionLoadProgress(94);
      } catch {
        setCurrentUser(defaultUser);
        setIsAuthenticated(false);
        setDocuments([]);
        setSessionLoadProgress(88);
      } finally {
        setSessionLoadProgress(100);
        window.setTimeout(() => {
          setIsSessionLoading(false);
        }, 180);
      }
    }

    restoreSession();
  }, []);

  useEffect(() => {
    if (isAuthenticated && screen !== "viewer" && screen !== "profile") {
      window.localStorage.setItem("careervault-screen", screen);
    }
  }, [isAuthenticated, screen]);

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
        setLoginPrefillEmail(email);
        setAuthFormKey((key) => key + 1);
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
        setLoginPrefillEmail("");
        setAuthFormKey((key) => key + 1);
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
    await loadDocuments();
    setAuthMessage("");
    setToast(`Welcome back, ${result.user.name}.`);
  }

  async function signOut() {
    await fetch("/api/auth/logout", {
      method: "POST",
      credentials: "include",
    }).catch(() => null);
    setIsAuthenticated(false);
    setCurrentUser(defaultUser);
    setDocuments([]);
    setIsDocumentsLoading(false);
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

  async function openDocument(document: ManagedDocument) {
    fetch(`/api/documents/${document.id}`, {
      method: "PATCH",
      credentials: "include",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ action: "viewed" }),
    })
      .then((response) =>
        parseApiResponse<{
          document: ManagedDocument;
        }>(response),
      )
      .then((data) => {
        setDocuments((current) =>
          current.map((item) => (item.id === data.document.id ? data.document : item)),
        );
      })
      .catch(() => null);
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

  async function confirmDelete() {
    if (!documentToDelete) {
      return;
    }

    try {
      await parseApiResponse(
        await fetch(`/api/documents/${documentToDelete.id}`, {
          method: "DELETE",
          credentials: "include",
        }),
      );
    } catch (error) {
      setToast(error instanceof Error ? error.message : "Unable to delete document.");
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

  async function saveEditedDocument(updatedDocument: ManagedDocument) {
    try {
      const data = await parseApiResponse<{
        document: ManagedDocument;
      }>(
        await fetch(`/api/documents/${updatedDocument.id}`, {
          method: "PATCH",
          credentials: "include",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify(updatedDocument),
        }),
      );
      setDocuments((current) =>
        current.map((document) =>
          document.id === data.document.id ? data.document : document,
        ),
      );
      setDocumentToEdit(null);
      setToast(`${data.document.fileName} updated successfully.`);
    } catch (error) {
      setToast(error instanceof Error ? error.message : "Unable to update document.");
    }
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

  async function handleUpload(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!uploadFile) {
      setToast("Please select a document before uploading.");
      return;
    }

    const extension = uploadFile.name.split(".").pop()?.toUpperCase() ?? "PDF";
    const parsedDocument = parsedUpload ?? extractMetadataFromText(uploadFile, "");
    const reviewedCompany = uploadForm.companyName || parsedDocument.companyName;
    const reviewedDesignation = uploadForm.designation || parsedDocument.designation;
    const reviewedPeriod = uploadForm.employmentPeriod || parsedDocument.employmentPeriod;
    const newDocument: Omit<ManagedDocument, "id" | "uploadedAt" | "fileUrl"> = {
      companyName: reviewedCompany,
      employeeName: currentUser.name,
      designation: reviewedDesignation,
      joiningDate: parsedDocument.joiningDate,
      relievingDate: parsedDocument.relievingDate,
      documentType: uploadForm.category as ManagedDocument["documentType"],
      fileName: uploadForm.name || `${reviewedCompany} ${uploadForm.category}`,
      fileSize: `${Math.max(uploadFile.size / 1024 / 1024, 0.1).toFixed(1)} MB`,
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
    };

    setIsSavingUpload(true);
    try {
      const formData = new FormData();
      formData.append("file", uploadFile);
      formData.append("metadata", JSON.stringify(newDocument));
      const data = await parseApiResponse<{
        document: ManagedDocument;
      }>(
        await fetch("/api/documents", {
          method: "POST",
          credentials: "include",
          body: formData,
        }),
      );
      setDocuments((current) => [data.document, ...current]);
      setToast("Upload successful. Document added to your vault.");
      setScreen("documents");
    } catch (error) {
      setToast(error instanceof Error ? error.message : "Upload failed. Please try again.");
      return;
    } finally {
      setIsSavingUpload(false);
    }

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
  }

  if (isSessionLoading) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-[#0d172b] px-4 text-white">
        <SessionLoader progress={sessionLoadProgress} />
      </main>
    );
  }

  if (!isAuthenticated) {
    return (
      <>
        <AuthScreen
          authFormKey={authFormKey}
          authMode={authMode}
          isLoading={authLoading}
          loginPrefillEmail={loginPrefillEmail}
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
            if (mode === "login" || mode === "signup") {
              setLoginPrefillEmail("");
              setAuthFormKey((key) => key + 1);
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
        globalSearchResults={globalSearchResults}
        hideMobileBar={screen === "profile"}
        onGlobalSearchSelect={handleGlobalSearchSelect}
        onNavigateDashboard={() => setScreen("dashboard")}
        onOpenProfile={openProfile}
        onSignOut={signOut}
        query={globalQuery}
        recentDocumentIds={recentDocumentIds}
        setQuery={setGlobalQuery}
        user={currentUser}
      />
      <MobileNav activeScreen={screen} setScreen={setScreen} />

      <div className="mx-auto flex max-w-[1440px]">
        <Sidebar activeScreen={screen} setScreen={setScreen} user={currentUser} />

        <section
          className={`min-w-0 flex-1 px-4 pb-24 sm:px-6 lg:ml-64 lg:px-8 lg:pb-5 ${
            screen === "profile" ? "pt-0 lg:py-5" : "py-5"
          }`}
        >
          {screen === "dashboard" && (
            <ScreenTransition screenKey="dashboard">
              <DashboardScreen
                documents={documents}
                isLoading={isInitialContentLoading}
                onDownload={downloadDocument}
                onEdit={setDocumentToEdit}
                onOpen={openDocument}
                recentlyUploaded={recentlyUploaded}
                setScreen={setScreen}
                user={currentUser}
              />
            </ScreenTransition>
          )}

          {screen === "documents" && (
            <ScreenTransition screenKey="documents">
              <DocumentsScreen
                categoryFilter={categoryFilter}
                documents={filteredDocuments}
                isLoading={isInitialContentLoading}
                onDelete={setDocumentToDelete}
                onDownload={downloadDocument}
                onEdit={setDocumentToEdit}
                onOpen={openDocument}
                query={documentQuery}
                setCategoryFilter={setCategoryFilter}
                setQuery={setDocumentQuery}
                setSortMode={setSortMode}
                sortMode={sortMode}
              />
            </ScreenTransition>
          )}

          {screen === "upload" && (
            <ScreenTransition screenKey="upload">
              <UploadScreen
                form={uploadForm}
                isParsingUpload={isParsingUpload}
                isSavingUpload={isSavingUpload}
                onFileChange={handleFileChange}
                onSubmit={handleUpload}
                setForm={setUploadForm}
                uploadFile={uploadFile}
              />
            </ScreenTransition>
          )}

          {screen === "viewer" && selectedDocument && (
            <ScreenTransition screenKey={`viewer-${selectedDocument.id}`}>
              <DocumentViewerScreen
                document={selectedDocument}
                onBack={goToDocuments}
                onDelete={setDocumentToDelete}
                onDownload={downloadDocument}
                onEdit={setDocumentToEdit}
                setZoom={setZoom}
                zoom={zoom}
              />
            </ScreenTransition>
          )}

          {screen === "profile" && (
            <ScreenTransition screenKey="profile">
              <ProfileScreen
                isLoading={isInitialContentLoading}
                onBack={closeProfile}
                onSignOut={signOut}
                user={currentUser}
              />
            </ScreenTransition>
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

function SessionLoader({ progress }: { progress: number }) {
  const [displayProgress, setDisplayProgress] = useState(0);
  const displayProgressRef = useRef(0);

  useEffect(() => {
    displayProgressRef.current = displayProgress;
  }, [displayProgress]);

  useEffect(() => {
    const target = Math.max(0, Math.min(100, progress));
    let frame = 0;
    const from = displayProgressRef.current;
    const startTime = performance.now();
    const duration = 320;

    function tick(now: number) {
      const elapsed = now - startTime;
      const t = Math.min(elapsed / duration, 1);
      const eased = 1 - Math.pow(1 - t, 3);
      const nextValue = Math.round(from + (target - from) * eased);
      displayProgressRef.current = nextValue;
      setDisplayProgress(nextValue);

      if (t < 1) {
        frame = requestAnimationFrame(tick);
      }
    }

    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [progress]);

  return (
    <div
      aria-label={`Loading ${displayProgress} percent`}
      aria-live="polite"
      className="relative flex items-center justify-center"
      role="status"
    >
      <span className="sr-only">Loading {displayProgress}%</span>
      <div aria-hidden="true" className="absolute h-16 w-16 rounded-full bg-blue-500/20 blur-2xl sm:h-20 sm:w-20" />
      <div className="relative h-12 w-12 sm:h-14 sm:w-14">
        <div
          aria-hidden="true"
          className="absolute inset-0 animate-spin rounded-full border-[3px] border-white/10 border-t-blue-400 border-r-blue-500 shadow-[0_0_28px_rgba(59,130,246,0.22)] sm:border-4"
        />
        <div className="absolute inset-[5px] flex items-center justify-center rounded-full bg-[#0d172b] sm:inset-[6px]">
          <span className="text-[9px] font-bold tabular-nums tracking-tight text-blue-100 sm:text-[10px]">
            {displayProgress}%
          </span>
        </div>
      </div>
    </div>
  );
}

function AuthScreen({
  authFormKey,
  authMode,
  isLoading,
  loginPrefillEmail,
  message,
  onAuthModeChange,
  onResendCode,
  onSubmit,
  resendSeconds,
}: {
  authFormKey: number;
  authMode: AuthMode;
  isLoading: boolean;
  loginPrefillEmail: string;
  message: string;
  onAuthModeChange: (mode: AuthMode) => void;
  onResendCode: () => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  resendSeconds: number;
}) {
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);

  useEffect(() => {
    setShowPassword(false);
    setShowConfirmPassword(false);
  }, [authMode, authFormKey]);
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

          <div className="mt-6 space-y-4" key={`${authMode}-${authFormKey}`}>
            {isSignup && (
              <label className="block">
                <span className="text-sm font-semibold text-slate-700">Full name</span>
                <input
                  autoComplete="name"
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
                  autoComplete="email"
                  className="mt-2 h-11 w-full rounded-[20px] border border-slate-200 px-3 text-sm outline-none focus:border-blue-400"
                  defaultValue={isLogin ? loginPrefillEmail : undefined}
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
                    autoComplete={isSignup ? "new-password" : isReset ? "new-password" : "current-password"}
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
                      autoComplete="new-password"
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
  globalSearchResults,
  hideMobileBar,
  onGlobalSearchSelect,
  onNavigateDashboard,
  onOpenProfile,
  onSignOut,
  query,
  recentDocumentIds,
  setQuery,
  user,
}: {
  globalSearchResults: ManagedDocument[];
  hideMobileBar?: boolean;
  onGlobalSearchSelect: (document: ManagedDocument) => void;
  onNavigateDashboard: () => void;
  onOpenProfile: () => void;
  onSignOut: () => void;
  query: string;
  recentDocumentIds: Set<string>;
  setQuery: (value: string) => void;
  user: UserProfile;
}) {
  const initials = getInitials(user.name);
  const desktopSearchRef = useRef<HTMLDivElement>(null);
  const mobileSearchRef = useRef<HTMLDivElement>(null);
  const [isSearchOpen, setIsSearchOpen] = useState(false);
  const normalizedQuery = query.trim();
  const showSearchResults = isSearchOpen && normalizedQuery.length > 0;

  useEffect(() => {
    function handlePointerDown(event: MouseEvent) {
      const target = event.target as Node;
      const insideDesktopSearch = desktopSearchRef.current?.contains(target);
      const insideMobileSearch = mobileSearchRef.current?.contains(target);

      if (!insideDesktopSearch && !insideMobileSearch) {
        setIsSearchOpen(false);
      }
    }

    document.addEventListener("mousedown", handlePointerDown);
    return () => document.removeEventListener("mousedown", handlePointerDown);
  }, []);

  function renderSearchResults(listboxId: string) {
    if (!showSearchResults) {
      return null;
    }

    return (
      <div
        className="absolute left-0 right-0 top-[calc(100%+0.5rem)] z-50 overflow-hidden rounded-[20px] border border-slate-200 bg-white shadow-xl shadow-slate-200/70"
        id={listboxId}
        role="listbox"
      >
        {globalSearchResults.length === 0 ? (
          <p className="px-4 py-3 text-sm text-slate-500">
            No documents found in your repository.
          </p>
        ) : (
          <ul className="max-h-80 overflow-y-auto py-2">
            {globalSearchResults.map((document) => (
              <li key={document.id}>
                <button
                  className="flex w-full items-start gap-3 px-4 py-3 text-left transition hover:bg-slate-50"
                  onClick={() => {
                    onGlobalSearchSelect(document);
                    setIsSearchOpen(false);
                  }}
                  role="option"
                  type="button"
                >
                  <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-[20px] bg-blue-50 text-blue-700">
                    <FileText className="h-4 w-4" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-semibold text-slate-900">
                      {document.fileName}
                    </span>
                    <span className="mt-0.5 block truncate text-xs text-slate-500">
                      {document.companyName} · {document.documentType}
                    </span>
                    <span className="mt-1 inline-flex rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-slate-600">
                      {getDocumentLocation(document, recentDocumentIds)}
                    </span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    );
  }

  return (
    <header
      className={`sticky top-0 z-40 bg-white/90 backdrop-blur-xl lg:border-b lg:pl-64 ${
        hideMobileBar
          ? "hidden border-b-0 lg:block lg:border-b"
          : "border-b border-slate-200"
      }`}
    >
      <div className="mx-auto hidden h-16 max-w-[1180px] items-center gap-4 px-4 sm:px-6 lg:flex lg:px-8">
        <button
          aria-label="Go to dashboard"
          className="flex min-w-[220px] items-center gap-3 text-left"
          onClick={onNavigateDashboard}
          type="button"
        >
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[20px] bg-blue-600 text-sm font-bold text-white shadow-md shadow-blue-600/20">
            CV
          </div>
          <p className="text-sm font-bold leading-none text-slate-950">CareerVault</p>
        </button>

        <div className="relative mx-auto w-full max-w-xl" ref={desktopSearchRef}>
          <label className="flex h-10 w-full items-center gap-2 rounded-[20px] border border-slate-200 bg-slate-50 px-3 text-slate-500 transition focus-within:border-blue-300 focus-within:bg-white focus-within:ring-4 focus-within:ring-blue-100">
            <Search className="h-4 w-4 shrink-0" />
            <input
              aria-autocomplete="list"
              aria-controls="global-search-results"
              aria-expanded={showSearchResults}
              className="h-full min-w-0 flex-1 bg-transparent text-sm text-slate-900 outline-none placeholder:text-slate-400"
              onChange={(event) => {
                setQuery(event.target.value);
                setIsSearchOpen(true);
              }}
              onFocus={() => setIsSearchOpen(true)}
              placeholder="Search documents..."
              role="combobox"
              type="search"
              value={query}
            />
          </label>
          {renderSearchResults("global-search-results")}
        </div>

        <div className="ml-auto flex items-center gap-3">
          <button
            aria-label="Notifications"
            className="flex h-10 w-10 items-center justify-center rounded-[20px] border border-slate-200 bg-white text-slate-600 transition hover:border-blue-200 hover:bg-blue-50 hover:text-blue-700"
            type="button"
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

      {!hideMobileBar && (
        <div className="mx-auto flex h-14 items-center gap-2 px-3 sm:gap-2.5 sm:px-4 lg:hidden">
          <button
            aria-label="Go to dashboard"
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-blue-600 text-xs font-bold text-white shadow-md shadow-blue-600/20 transition active:scale-[0.98]"
            onClick={onNavigateDashboard}
            type="button"
          >
            CV
          </button>

          <div className="relative min-w-0 flex-1" ref={mobileSearchRef}>
            <label className="flex h-10 w-full items-center gap-2 rounded-full border border-slate-200 bg-white px-3 text-slate-500 shadow-sm transition focus-within:border-blue-300 focus-within:ring-2 focus-within:ring-blue-100">
              <Search className="h-4 w-4 shrink-0" />
              <input
                aria-autocomplete="list"
                aria-controls="mobile-global-search-results"
                aria-expanded={showSearchResults}
                className="h-full min-w-0 flex-1 bg-transparent text-sm text-slate-900 outline-none placeholder:text-slate-400"
                onChange={(event) => {
                  setQuery(event.target.value);
                  setIsSearchOpen(true);
                }}
                onFocus={() => setIsSearchOpen(true)}
                placeholder="Search"
                role="combobox"
                type="search"
                value={query}
              />
            </label>
            {renderSearchResults("mobile-global-search-results")}
          </div>

          <button
            aria-label="Notifications"
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-slate-200 bg-white text-slate-600 shadow-sm transition active:bg-slate-50"
            type="button"
          >
            <Bell className="h-4 w-4" />
          </button>

          <button
            aria-label="Open profile"
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-slate-200 bg-white text-slate-600 shadow-sm transition active:bg-slate-50"
            onClick={onOpenProfile}
            type="button"
          >
            <User className="h-4 w-4" />
          </button>
        </div>
      )}
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
        <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full bg-blue-500 text-xl font-bold shadow-lg shadow-blue-500/30">
          CV
        </div>
        <p className="text-lg font-bold leading-none">CareerVault</p>
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
    <nav
      aria-label="Main navigation"
      className="fixed bottom-0 left-0 right-0 z-50 border-t border-slate-200 bg-white pb-[env(safe-area-inset-bottom,0px)] shadow-[0_-4px_24px_rgba(15,23,42,0.06)] lg:hidden"
    >
      <div className="mx-auto flex max-w-lg items-stretch justify-around px-2">
        <MobileNavItem
          active={activeScreen === "dashboard"}
          icon={<LayoutDashboard className="h-5 w-5" />}
          label="Dashboard"
          onClick={() => setScreen("dashboard")}
        />
        <MobileNavItem
          active={activeScreen === "documents" || activeScreen === "viewer"}
          icon={<Folder className="h-5 w-5" />}
          label="Documents"
          onClick={() => setScreen("documents")}
        />
        <MobileNavItem
          active={activeScreen === "upload"}
          icon={<UploadCloud className="h-5 w-5" />}
          label="Upload"
          onClick={() => setScreen("upload")}
        />
      </div>
    </nav>
  );
}

function MobileNavItem({
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
      aria-current={active ? "page" : undefined}
      className={`flex min-h-[64px] min-w-[88px] flex-1 flex-col items-center justify-center gap-1 px-2 py-2 transition ${
        active ? "text-blue-600" : "text-slate-500 active:text-slate-700"
      }`}
      onClick={onClick}
      type="button"
    >
      {icon}
      <span className="text-xs font-medium">{label}</span>
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
      className={`flex w-full items-center gap-4 rounded-[10px] px-5 py-4 text-base font-semibold transition ${
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

function ProfileScreen({
  isLoading,
  onBack,
  onSignOut,
  user,
}: {
  isLoading: boolean;
  onBack: () => void;
  onSignOut: () => void;
  user: UserProfile;
}) {
  const initials = getInitials(user.name);
  const showSkeleton = useDelayedLoading(isLoading);

  return (
    <>
      <header className="sticky top-0 z-40 -mx-4 mb-4 flex h-14 items-center border-b border-slate-200 bg-white/90 px-3 backdrop-blur-xl sm:-mx-6 sm:px-4 lg:hidden">
        <button
          className="flex h-10 items-center gap-2 rounded-[20px] px-1 text-sm font-semibold text-slate-700 transition active:bg-slate-50"
          onClick={onBack}
          type="button"
        >
          <ArrowLeft className="h-4 w-4" />
          Back
        </button>
      </header>

      {isLoading && !showSkeleton ? (
        <div aria-hidden="true" className="min-h-[420px]" />
      ) : showSkeleton ? (
        <ProfileScreenSkeleton />
      ) : (
        <div className="careervault-fade-in space-y-8 pb-4">
        <section className="rounded-[20px] border border-slate-200 bg-white p-5 shadow-sm">
        <div className="flex items-center gap-4">
          <span className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full bg-linear-to-br from-blue-600 to-violet-600 text-lg font-semibold text-white">
            {initials}
          </span>
          <div className="min-w-0">
            <h1 className="truncate text-xl font-bold text-slate-950">{user.name}</h1>
            <p className="mt-1 truncate text-sm text-slate-500">{user.email}</p>
          </div>
        </div>
      </section>

      <section>
        <p className="px-1 text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">
          Account
        </p>
        <div className="mt-3 overflow-hidden rounded-[20px] border border-slate-200 bg-white shadow-sm">
          <ProfileMenuItem icon={<User className="h-4 w-4" />} label="My Profile" />
          <ProfileMenuItem
            icon={<Settings className="h-4 w-4" />}
            label="Account Settings"
          />
          <ProfileMenuItem
            icon={<HelpCircle className="h-4 w-4" />}
            label="Help & Support"
          />
        </div>
      </section>

      <section className="pt-2">
        <button
          className="flex w-full items-center gap-3 rounded-[20px] border border-red-100 bg-white px-4 py-4 text-left text-sm font-semibold text-red-600 shadow-sm transition active:bg-red-50"
          onClick={onSignOut}
          type="button"
        >
          <X className="h-4 w-4" />
          Sign Out
        </button>
      </section>
        </div>
      )}
    </>
  );
}

function ProfileMenuItem({
  icon,
  label,
}: {
  icon: React.ReactNode;
  label: string;
}) {
  return (
    <button
      className="flex w-full items-center gap-3 border-b border-slate-100 px-4 py-4 text-left text-sm font-medium text-slate-700 transition last:border-b-0 active:bg-slate-50"
      type="button"
    >
      <span className="text-slate-500">{icon}</span>
      {label}
    </button>
  );
}

function DashboardScreen({
  documents,
  isLoading,
  onDownload,
  onEdit,
  onOpen,
  recentlyUploaded,
  setScreen,
  user,
}: {
  documents: ManagedDocument[];
  isLoading: boolean;
  onDownload: (document: ManagedDocument) => void;
  onEdit: (document: ManagedDocument) => void;
  onOpen: (document: ManagedDocument) => void;
  recentlyUploaded: ManagedDocument[];
  setScreen: (screen: Screen) => void;
  user: UserProfile;
}) {
  const showSkeleton = useDelayedLoading(isLoading);

  if (isLoading && !showSkeleton) {
    return <div aria-hidden="true" className="min-h-[720px]" />;
  }

  if (showSkeleton) {
    return <DashboardScreenSkeleton />;
  }

  const companies = Array.from(
    new Map(
      documents.map((document) => [
        document.companyName.trim().toLowerCase(),
        document,
      ]),
    ).values(),
  );
  const totalDocuments = documents.length;
  const totalCompanies = companies.length;
  const totalJobPositions = new Set(
    documents
      .map((document) => document.designation.trim().toLowerCase())
      .filter(Boolean),
  ).size;

  return (
    <div className="careervault-fade-in space-y-6">
      <DashboardHero onUpload={() => setScreen("upload")} user={user} />

      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        <StatCard
          icon={<FileText className="h-4 w-4" />}
          label="Total Documents"
          value={totalDocuments.toString()}
        />
        <StatCard
          icon={<BriefcaseBusiness className="h-4 w-4" />}
          label="Total Companies"
          value={totalCompanies.toString()}
        />
        <StatCard
          icon={<User className="h-4 w-4" />}
          label="Total Job Positions"
          value={totalJobPositions.toString()}
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
        <EmploymentTimeline documents={documents} />
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
            {getWelcomeGreeting(user.name)}
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
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-xl font-bold tracking-tight text-slate-950">
            Recent uploads
          </h2>
          <p className="mt-1 text-sm text-slate-500 lg:hidden">Fast Onboarding Access.</p>
          <p className="mt-1 hidden text-sm text-slate-500 lg:block">
            Fast access for onboarding & HR checks.
          </p>
        </div>
        <button
          className="shrink-0 whitespace-nowrap rounded-[20px] px-3 py-2 text-sm font-semibold text-blue-700 transition hover:bg-blue-50"
          onClick={onViewAll}
        >
          View all
        </button>
      </div>

      <div className="mt-6 max-h-[388px] space-y-3 overflow-y-auto pr-1">
        {documents.map((document) => (
          <article
            className="group relative flex flex-col items-start gap-3 rounded-[20px] border border-slate-200 bg-slate-50/70 p-4 transition hover:border-blue-200 hover:bg-white hover:shadow-lg hover:shadow-slate-200/70 lg:grid lg:grid-cols-[auto_1fr] lg:items-start lg:gap-4 lg:pr-32"
            key={document.id}
          >
            <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-[20px] bg-blue-50 text-blue-700">
              <FileText className="h-6 w-6" />
            </div>

            <div className="min-w-0 w-full pr-20 lg:flex-1 lg:pr-0">
              <div className="flex flex-wrap items-center gap-2 lg:pr-0">
                <h3 className="truncate font-bold text-slate-950">{document.companyName}</h3>
                {document.status === "Verified" && (
                  <span className="hidden items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-bold text-emerald-600 lg:inline-flex">
                    <ShieldCheck className="h-3 w-3" />
                    Verified
                  </span>
                )}
              </div>
              <p className="mt-1 text-sm text-slate-500">{document.designation}</p>
              <p className="mt-1 truncate text-xs text-slate-500 lg:hidden">{document.fileName}</p>
              <p className="mt-1 hidden truncate text-xs text-slate-500 lg:block">
                {document.fileName} · {document.fileSize}
              </p>

              <div className="mt-3 flex items-center gap-2 lg:absolute lg:bottom-4 lg:right-4 lg:mt-0">
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
            </div>

            <span className="absolute right-4 top-4 rounded-[20px] bg-blue-50 px-3 py-1.5 text-xs font-semibold text-blue-700">
              {document.documentType}
            </span>
          </article>
        ))}
      </div>
    </section>
  );
}

function EmploymentTimeline({ documents }: { documents: ManagedDocument[] }) {
  const timelineRecords = useMemo(
    () => buildEmploymentTimelineRecords(documents),
    [documents],
  );

  return (
    <section className="rounded-[20px] border border-slate-200/80 bg-white p-6 shadow-xl shadow-slate-200/60">
      <h2 className="text-xl font-bold tracking-tight text-slate-950">
        Employment timeline
      </h2>
      <p className="mt-1 text-sm text-slate-500">Your career, in order.</p>

      <div className="mt-6 max-h-[388px] space-y-7 overflow-y-auto pr-1">
        {timelineRecords.map((document, index) => (
          <div className="relative flex gap-4" key={document.id}>
            {index !== timelineRecords.length - 1 && (
              <span className="absolute left-[7px] top-5 h-[calc(100%+1rem)] w-px bg-slate-200" />
            )}
            <span className="relative mt-1 h-4 w-4 shrink-0 rounded-full bg-blue-500 shadow-md shadow-blue-500/30 ring-4 ring-blue-50" />
            <div>
              <h3 className="font-bold text-slate-950">{document.companyName}</h3>
              <p className="mt-1 text-sm text-slate-500">{document.designation}</p>
              <p className="mt-1 text-sm text-slate-500">
                {getEmploymentPeriodDisplay(document)}
              </p>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

function DropdownSelect({
  className = "",
  ...props
}: React.ComponentProps<"select">) {
  return (
    <div className="relative w-full min-w-0">
      <select {...props} className={`w-full appearance-none pl-3 pr-10 ${className}`} />
      <ChevronDown
        aria-hidden="true"
        className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500"
      />
    </div>
  );
}

function DocumentsScreen({
  categoryFilter,
  documents,
  isLoading,
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
  isLoading: boolean;
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
  const hasActiveFilters = query.trim().length > 0 || categoryFilter !== "All";
  const showSkeleton = useDelayedLoading(isLoading);

  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow="Documents"
        title="My Documents"
        subtitle="Manage and access all your career documents securely."
      />

      <section className="rounded-[20px] border border-slate-200 bg-white p-4 shadow-sm">
        <div className="grid gap-3 lg:grid-cols-[1fr_220px_180px_180px]">
          <SearchField
            className="h-11 rounded-[20px] border border-slate-200 bg-slate-50 px-3 text-slate-500 focus-within:border-blue-300 focus-within:bg-white"
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search Documents"
            value={query}
          />
          <DropdownSelect
            className="h-11 w-full rounded-[20px] border border-slate-200 bg-white text-sm outline-none focus:border-blue-300"
            onChange={(event) => setCategoryFilter(event.target.value)}
            value={categoryFilter}
          >
            <option>All</option>
            {documentTypes.map((type) => (
              <option key={type}>{type}</option>
            ))}
          </DropdownSelect>
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

      <section className="min-h-[320px]">
        {isLoading && !showSkeleton ? (
          <div aria-hidden="true" className="min-h-[320px]" />
        ) : showSkeleton ? (
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {Array.from({ length: 6 }).map((_, index) => (
              <DocumentCardSkeleton key={index} />
            ))}
          </div>
        ) : documents.length === 0 ? (
          <div className="careervault-fade-in flex min-h-[320px] items-center justify-center rounded-[20px] border border-dashed border-slate-200 bg-white px-6 py-12 text-center">
            <div>
              <p className="text-sm font-semibold text-slate-700">
                {hasActiveFilters ? "No documents match your search." : "No documents yet."}
              </p>
              <p className="mt-1 text-sm text-slate-500">
                {hasActiveFilters
                  ? "Try adjusting your search or filters."
                  : "Upload a document to get started."}
              </p>
            </div>
          </div>
        ) : (
          <div className="careervault-fade-in grid gap-4 md:grid-cols-2 xl:grid-cols-3">
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
          </div>
        )}
      </section>
    </div>
  );
}

function UploadScreen({
  form,
  isParsingUpload,
  isSavingUpload,
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
  isSavingUpload: boolean;
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
              placeholder="Enter document name"
              value={form.name}
            />
            <FormField
              label="Company Name"
              onChange={(value) => setForm({ ...form, companyName: value })}
              placeholder="Enter company name"
              value={form.companyName}
            />
            <FormField
              label="Designation"
              onChange={(value) => setForm({ ...form, designation: value })}
              placeholder="Enter job title"
              value={form.designation}
            />
            <FormField
              label={
                form.category === "Salary Slip"
                  ? "Salary Month"
                  : "Employment Period"
              }
              onChange={(value) =>
                setForm(
                  form.category === "Salary Slip"
                    ? { ...form, salaryMonth: value }
                    : { ...form, employmentPeriod: value },
                )
              }
              placeholder={form.category === "Salary Slip" ? "January 2026" : "e.g., Jan 2026 – Present"}
              value={form.category === "Salary Slip" ? form.salaryMonth : form.employmentPeriod}
            />
            <label className="block">
              <span className="text-sm font-medium text-slate-700">Document Category</span>
              <DropdownSelect
                className="mt-2 h-11 w-full rounded-[20px] border border-slate-200 text-sm outline-none focus:border-blue-300"
                onChange={(event) => setForm({ ...form, category: event.target.value })}
                value={form.category}
              >
                {documentTypes.map((type) => (
                  <option key={type}>{type}</option>
                ))}
              </DropdownSelect>
            </label>
            <button
              className="h-11 w-full rounded-[20px] bg-blue-600 text-sm font-semibold text-white shadow-md shadow-blue-600/20 transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-blue-300"
              disabled={isParsingUpload || isSavingUpload}
            >
              {isSavingUpload ? "Saving Document..." : "Upload Document"}
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

function StatCardSkeleton() {
  return (
    <div
      aria-hidden="true"
      className="rounded-[24px] border border-slate-200/80 bg-white p-5 shadow-xl shadow-slate-200/50"
    >
      <ShimmerBlock className="h-10 w-10 rounded-[20px]" />
      <ShimmerBlock className="mt-5 h-4 w-28" />
      <ShimmerBlock className="mt-2 h-8 w-14" />
    </div>
  );
}

function DashboardPanelSkeleton({ rows }: { rows: number }) {
  return (
    <section
      aria-hidden="true"
      className="rounded-[20px] border border-slate-200/80 bg-white p-6 shadow-xl shadow-slate-200/60"
    >
      <ShimmerBlock className="h-6 w-40" />
      <ShimmerBlock className="mt-2 h-4 w-56" />
      <div className="mt-6 space-y-3">
        {Array.from({ length: rows }).map((_, index) => (
          <RecentUploadItemSkeleton key={index} />
        ))}
      </div>
    </section>
  );
}

function DashboardHeroSkeleton() {
  return (
    <section
      aria-hidden="true"
      className="overflow-hidden rounded-[20px] border border-slate-200/80 bg-white p-7 shadow-xl shadow-slate-200/60 sm:p-8"
    >
      <ShimmerBlock className="h-10 w-3/4 max-w-md" />
      <ShimmerBlock className="mt-4 h-4 w-full max-w-xl" />
      <ShimmerBlock className="mt-2 h-4 w-2/3 max-w-lg" />
      <ShimmerBlock className="mt-6 h-12 w-44 rounded-[20px]" />
    </section>
  );
}

function DashboardScreenSkeleton() {
  return (
    <div aria-busy="true" aria-label="Loading dashboard" className="space-y-6" role="status">
      <span className="sr-only">Loading dashboard</span>
      <DashboardHeroSkeleton />
      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        <StatCardSkeleton />
        <StatCardSkeleton />
        <StatCardSkeleton />
      </section>
      <section className="grid gap-5 xl:grid-cols-[1.35fr_0.95fr]">
        <DashboardPanelSkeleton rows={3} />
        <DashboardPanelSkeleton rows={4} />
      </section>
    </div>
  );
}

function RecentUploadItemSkeleton() {
  return (
    <div className="flex flex-col gap-3 rounded-[20px] border border-slate-200 bg-slate-50/70 p-4 lg:grid lg:grid-cols-[auto_1fr] lg:gap-4">
      <ShimmerBlock className="h-14 w-14 shrink-0 rounded-[20px]" />
      <div className="min-w-0 flex-1 space-y-2">
        <ShimmerBlock className="h-4 w-32" />
        <ShimmerBlock className="h-3.5 w-24" />
        <ShimmerBlock className="h-3 w-40" />
        <div className="flex gap-2 pt-1">
          <ShimmerBlock className="h-9 w-9 rounded-[20px]" />
          <ShimmerBlock className="h-9 w-9 rounded-[20px]" />
          <ShimmerBlock className="h-9 w-9 rounded-[20px]" />
        </div>
      </div>
    </div>
  );
}

function DocumentCardSkeleton() {
  return (
    <article
      aria-hidden="true"
      className="rounded-[20px] border border-slate-200 bg-white p-4 shadow-sm"
    >
      <div className="flex items-start justify-between gap-4">
        <ShimmerBlock className="h-5 w-[58%] max-w-[180px]" />
        <ShimmerBlock className="h-6 w-12 rounded-full" />
      </div>
      <div className="mt-4 grid grid-cols-2 gap-3">
        {Array.from({ length: 4 }).map((_, index) => (
          <div key={index}>
            <ShimmerBlock className="h-3 w-16" />
            <ShimmerBlock className="mt-2 h-4 w-full" />
          </div>
        ))}
      </div>
      <div className="mt-4 flex items-center gap-2">
        {Array.from({ length: 4 }).map((_, index) => (
          <ShimmerBlock className="h-9 w-9 rounded-[20px]" key={index} />
        ))}
      </div>
    </article>
  );
}

function ProfileScreenSkeleton() {
  return (
    <div aria-busy="true" aria-label="Loading profile" className="space-y-8 pb-4" role="status">
      <span className="sr-only">Loading profile</span>
      <section className="rounded-[20px] border border-slate-200 bg-white p-5 shadow-sm">
        <div className="flex items-center gap-4">
          <ShimmerBlock className="h-14 w-14 shrink-0 rounded-full" />
          <div className="min-w-0 flex-1 space-y-2">
            <ShimmerBlock className="h-5 w-40" />
            <ShimmerBlock className="h-4 w-52" />
          </div>
        </div>
      </section>
      <section>
        <ShimmerBlock className="mx-1 h-3 w-16" />
        <div className="mt-3 overflow-hidden rounded-[20px] border border-slate-200 bg-white shadow-sm">
          {Array.from({ length: 3 }).map((_, index) => (
            <div
              className="flex items-center gap-3 border-b border-slate-100 px-4 py-4 last:border-b-0"
              key={index}
            >
              <ShimmerBlock className="h-4 w-4 rounded" />
              <ShimmerBlock className="h-4 w-32" />
            </div>
          ))}
        </div>
      </section>
      <ShimmerBlock className="h-[52px] w-full rounded-[20px]" />
    </div>
  );
}

function ShimmerBlock({ className = "" }: { className?: string }) {
  return <div className={`careervault-shimmer ${className}`.trim()} />;
}

function ScreenTransition({
  children,
  screenKey,
}: {
  children: React.ReactNode;
  screenKey: string;
}) {
  return (
    <div className="careervault-screen-enter" key={screenKey}>
      {children}
    </div>
  );
}

function SearchField({
  className = "",
  inputClassName = "",
  onChange,
  onFocus,
  placeholder,
  value,
}: {
  className?: string;
  inputClassName?: string;
  onChange: (event: ChangeEvent<HTMLInputElement>) => void;
  onFocus?: () => void;
  placeholder?: string;
  value: string;
}) {
  return (
    <label className={`flex items-center gap-2 ${className}`}>
      <Search className="h-4 w-4 shrink-0" />
      <input
        className={`h-full min-w-0 flex-1 bg-transparent text-sm text-slate-900 outline-none placeholder:text-slate-400 ${inputClassName}`}
        onChange={onChange}
        onFocus={onFocus}
        placeholder={placeholder}
        type="search"
        value={value}
      />
    </label>
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
    <article className="rounded-[20px] border border-slate-200 bg-white p-4 shadow-sm transition-[border-color,box-shadow] duration-200 hover:border-blue-200 hover:shadow-md">
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
                    placeholder="Enter document name"
                  />
                </label>
                <label className="block">
                  <span className="text-sm font-semibold text-slate-700">Company Name</span>
                  <input
                    className="mt-2 h-11 w-full rounded-[20px] border border-slate-200 px-3 text-sm outline-none focus:border-blue-300"
                    defaultValue={document.companyName}
                    name="companyName"
                    placeholder="Enter company name"
                  />
                </label>
                <label className="block">
                  <span className="text-sm font-semibold text-slate-700">Designation</span>
                  <input
                    className="mt-2 h-11 w-full rounded-[20px] border border-slate-200 px-3 text-sm outline-none focus:border-blue-300"
                    defaultValue={document.designation}
                    name="designation"
                    placeholder="Enter job title"
                  />
                </label>
                <label className="block">
                  <span className="text-sm font-semibold text-slate-700">Document Type</span>
                  <DropdownSelect
                    className="mt-2 h-11 w-full rounded-[20px] border border-slate-200 text-sm outline-none focus:border-blue-300"
                    defaultValue={document.documentType}
                    name="documentType"
                  >
                    {documentTypes.map((type) => (
                      <option key={type}>{type}</option>
                    ))}
                  </DropdownSelect>
                </label>
                <label className="block">
                  <span className="text-sm font-semibold text-slate-700">Employment Period</span>
                  <input
                    className="mt-2 h-11 w-full rounded-[20px] border border-slate-200 px-3 text-sm outline-none focus:border-blue-300"
                    defaultValue={document.employmentPeriod}
                    name="employmentPeriod"
                    placeholder="e.g., Jan 2026 – Present"
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
                  className="h-11 w-full rounded-[20px] bg-red-50 px-4 text-sm font-semibold text-red-600 hover:bg-red-100 sm:h-10 sm:w-auto"
                  onClick={() => onDelete(document)}
                  type="button"
                >
                  Delete Document
                </button>
                <div className="grid w-full grid-cols-2 gap-3 sm:flex sm:w-auto">
                  <button
                    className="h-11 w-full min-w-0 rounded-[20px] border border-slate-200 px-4 text-sm font-medium text-slate-700 hover:bg-slate-50 sm:h-10 sm:w-auto"
                    onClick={onCancel}
                    type="button"
                  >
                    Cancel
                  </button>
                  <button className="h-11 w-full min-w-0 rounded-[20px] bg-blue-600 px-4 text-sm font-semibold text-white hover:bg-blue-700 sm:h-10 sm:w-auto">
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
