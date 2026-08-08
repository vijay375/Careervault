"use client";

import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import {
  Bell,
  ChevronDown,
  ClipboardList,
  HelpCircle,
  LayoutDashboard,
  Search,
  Send,
  Settings,
  User,
  Users,
  X,
} from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  createContext,
  FormEvent,
  KeyboardEvent,
  useContext,
  useEffect,
  useState,
} from "react";
import { clearCachedData } from "@/lib/client-cache";
import { withBasePath } from "@/lib/base-path";
import { DashboardScreenSkeleton } from "@/components/skeletons";

export type HrUser = {
  id: string;
  name: string;
  email: string;
  firstName?: string;
  lastName?: string;
};

type HrNotification = {
  id: string;
  requestId?: string;
  title: string;
  message: string;
  readAt?: string;
  createdAt: string;
};

const HrUserContext = createContext<HrUser | null>(null);
type HeaderSearchMode = "global" | "requests";
type HeaderSearchContextValue = {
  internalQuery: string;
  mode: HeaderSearchMode;
  setInternalQuery: (query: string) => void;
  setMode: (mode: HeaderSearchMode) => void;
};
const HeaderSearchContext = createContext<HeaderSearchContextValue | null>(null);

export function useHrUser() {
  const user = useContext(HrUserContext);

  if (!user) {
    throw new Error("useHrUser must be used within HrShell.");
  }

  return user;
}

export function useHeaderSearch() {
  const context = useContext(HeaderSearchContext);
  if (!context) {
    throw new Error("useHeaderSearch must be used within HrShell.");
  }
  return context;
}

const navItems = [
  { href: "/", label: "Dashboard", icon: LayoutDashboard },
  { href: "/candidates", label: "Candidates", icon: Users },
  { href: "/requests", label: "Requests", icon: ClipboardList },
];
const userPortalUrl = (
  process.env.NEXT_PUBLIC_USER_PORTAL_URL ||
  process.env.NEXT_PUBLIC_APP_URL ||
  "http://localhost:3000"
).replace(/\/$/, "");
/** Single public auth entry — never use a separate HR login URL. */
const authEntryUrl = `${userPortalUrl}/`;

export function HrShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const [user, setUser] = useState<HrUser | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [notifications, setNotifications] = useState<HrNotification[]>([]);
  const [headerSearchMode, setHeaderSearchMode] = useState<HeaderSearchMode>("global");
  const [internalSearchQuery, setInternalSearchQuery] = useState("");

  useEffect(() => {
    void (async () => {
      try {
        const response = await fetch(withBasePath("/api/auth/session"), {
          credentials: "include",
        });
        if (!response.ok) {
          window.location.replace(authEntryUrl);
          return;
        }

        const data = (await response.json()) as { ok: boolean; user?: HrUser };
        if (!data.user) {
          window.location.replace(authEntryUrl);
          return;
        }

        setUser(data.user);
      } catch {
        window.location.replace(authEntryUrl);
        return;
      } finally {
        setIsLoading(false);
      }
    })();
  }, [router]);

  useEffect(() => {
    router.prefetch("/");
    router.prefetch("/candidates");
    router.prefetch("/requests");
  }, [router]);

  useEffect(() => {
    if (!user) {
      return;
    }

    async function loadNotifications() {
      const response = await fetch(withBasePath("/api/notifications"), {
        credentials: "include",
      });
      if (response.ok) {
        const data = (await response.json()) as { notifications?: HrNotification[] };
        setNotifications(data.notifications || []);
      }
    }

    void loadNotifications();
    const intervalId = window.setInterval(() => void loadNotifications(), 30_000);
    return () => window.clearInterval(intervalId);
  }, [user]);

  async function handleSignOut() {
    clearCachedData("");
    await fetch(withBasePath("/api/auth/logout"), {
      method: "POST",
      credentials: "include",
    });
    window.location.replace(authEntryUrl);
  }

  async function markNotificationsRead() {
    if (!notifications.some((notification) => !notification.readAt)) {
      return;
    }

    await fetch(withBasePath("/api/notifications"), {
      method: "PATCH",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: "{}",
    });
    const readAt = new Date().toISOString();
    setNotifications((current) =>
      current.map((notification) => ({ ...notification, readAt: notification.readAt || readAt })),
    );
  }

  if (isLoading) {
    return (
      <div className="min-h-screen bg-[#f6f8fb]">
        <div className="mx-auto max-w-[1180px] px-4 py-6 sm:px-6 lg:px-8 lg:pl-72">
          <DashboardScreenSkeleton />
        </div>
      </div>
    );
  }

  if (!user) {
    return null;
  }

  const profileName = String(user.firstName || user.name || "").trim();
  const initials = [profileName, user.lastName]
    .filter(Boolean)
    .join(" ")
    .split(/\s+/)
    .filter(Boolean)
    .map((part) => part[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();

  function isActive(href: string) {
    return href === "/" ? pathname === "/" : pathname === href || pathname.startsWith(`${href}/`);
  }

  return (
    <HrUserContext.Provider value={user}>
      <HeaderSearchContext.Provider
        value={{
          internalQuery: internalSearchQuery,
          mode: headerSearchMode,
          setInternalQuery: setInternalSearchQuery,
          setMode: setHeaderSearchMode,
        }}
      >
      <main className="min-h-screen bg-[#f6f8fb]">
      <header className="sticky top-0 z-40 border-b border-slate-200 bg-white/90 backdrop-blur-xl lg:pl-64">
        <div className="mx-auto hidden h-16 max-w-[1180px] items-center gap-4 px-4 sm:px-6 lg:flex lg:px-8">
          <Link className="flex min-w-[220px] items-center gap-3 text-left" href="/">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[20px] bg-blue-600 text-sm font-bold text-white shadow-md shadow-blue-600/20">
              CV
            </span>
            <span className="text-sm font-bold leading-none text-slate-950">CareerVault</span>
          </Link>

          <GlobalSearch />

          <div className="ml-auto flex items-center gap-3">
            <NotificationMenu
              notifications={notifications}
              onOpen={() => void markNotificationsRead()}
              onViewRequest={() => router.push("/candidates")}
            />
            <ProfileMenu
              initials={initials}
              name={profileName}
              onSignOut={() => void handleSignOut()}
              showName
            />
          </div>
        </div>

        <div className="mx-auto flex h-14 items-center gap-2 px-3 sm:gap-2.5 sm:px-4 lg:hidden">
          <Link
            aria-label="Go to dashboard"
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-blue-600 text-xs font-bold text-white shadow-md shadow-blue-600/20"
            href="/"
          >
            CV
          </Link>
          <GlobalSearch mobile />
          <NotificationMenu
            mobile
            notifications={notifications}
            onOpen={() => void markNotificationsRead()}
            onViewRequest={() => router.push("/candidates")}
          />
          <ProfileMenu
            initials={initials}
            name={profileName}
            onSignOut={() => void handleSignOut()}
          />
        </div>
      </header>

      <aside className="fixed bottom-0 left-0 top-0 z-50 hidden w-64 flex-col bg-[#0d172b] p-6 text-white shadow-2xl lg:flex">
        <div className="flex items-center gap-4">
          <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full bg-blue-500 text-xl font-bold shadow-lg shadow-blue-500/30">
            CV
          </div>
          <p className="flex h-14 items-center text-lg font-bold leading-none">CareerVault</p>
        </div>

        <nav className="mt-10 space-y-3">
          {navItems.map((item) => {
            const active = isActive(item.href);
            const Icon = item.icon;

            return (
              <Link
                key={item.href}
                className={`flex w-full items-center gap-4 rounded-[10px] px-5 py-4 text-base font-semibold transition ${
                  active
                    ? "bg-blue-600 text-white shadow-lg shadow-blue-600/30"
                    : "text-slate-400 hover:bg-white/6 hover:text-white"
                }`}
                href={item.href}
              >
                <Icon className="h-4 w-4" />
                {item.label}
              </Link>
            );
          })}
        </nav>

        <div className="mt-auto">
          <div className="rounded-[20px] bg-white/5 p-4 shadow-xl shadow-black/10">
            <div className="flex items-center gap-3">
              <span className="flex h-12 w-12 items-center justify-center rounded-full bg-blue-500 text-base font-bold text-white">
                {initials}
              </span>
              <div className="min-w-0">
                <p className="truncate text-base font-bold text-white">{profileName}</p>
              </div>
            </div>
          </div>
        </div>
      </aside>

      <div className="mx-auto max-w-[1440px] px-4 pb-28 pt-6 sm:px-6 lg:px-8 lg:pb-8">
        <section className="lg:ml-64">
          <div className="careervault-fade-in">{children}</div>
        </section>
      </div>

      <nav
        aria-label="Main navigation"
        className="fixed bottom-0 left-0 right-0 z-50 border-t border-slate-200 bg-white pb-[env(safe-area-inset-bottom,0px)] shadow-[0_-4px_24px_rgba(15,23,42,0.06)] lg:hidden"
      >
        <div className="mx-auto flex max-w-lg items-stretch justify-around px-2">
          {navItems.map((item) => {
            const active = isActive(item.href);
            const Icon = item.icon;

            return (
              <Link
                key={item.href}
                className={`flex min-w-20 flex-1 flex-col items-center justify-center gap-1 py-2.5 text-[11px] font-semibold transition ${
                  active ? "text-blue-700" : "text-slate-500"
                }`}
                href={item.href}
              >
                <span
                  className={`flex h-8 w-12 items-center justify-center rounded-full ${
                    active ? "bg-blue-50" : ""
                  }`}
                >
                  <Icon className="h-5 w-5" />
                </span>
                {item.label}
              </Link>
            );
          })}
        </div>
      </nav>
      </main>
      </HeaderSearchContext.Provider>
    </HrUserContext.Provider>
  );
}

type GlobalSearchResult = {
  id: string;
  type: "module" | "request";
  title: string;
  subtitle: string;
  href: string;
  status?: string;
};

function GlobalSearch({ mobile = false }: { mobile?: boolean }) {
  const router = useRouter();
  const headerSearch = useHeaderSearch();
  const resultsId = mobile ? "global-search-results-mobile" : "global-search-results-desktop";
  const [globalQuery, setGlobalQuery] = useState("");
  const [results, setResults] = useState<GlobalSearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const query = headerSearch.mode === "requests" ? headerSearch.internalQuery : globalQuery;

  useEffect(() => {
    const normalizedQuery = query.trim();
    if (headerSearch.mode === "requests" || normalizedQuery.length < 2) {
      const resetId = window.setTimeout(() => {
        setResults([]);
        setLoading(false);
        setOpen(false);
      }, 0);
      return () => window.clearTimeout(resetId);
    }

    const controller = new AbortController();
    const timeoutId = window.setTimeout(async () => {
      setLoading(true);
      try {
        const response = await fetch(
          withBasePath(`/api/search?q=${encodeURIComponent(normalizedQuery)}`),
          {
            credentials: "include",
            signal: controller.signal,
          },
        );
        const data = (await response.json()) as {
          ok: boolean;
          results?: GlobalSearchResult[];
        };
        if (response.ok) {
          setResults(data.results || []);
          setOpen(true);
        }
      } catch (error) {
        if (!(error instanceof DOMException && error.name === "AbortError")) {
          setResults([]);
        }
      } finally {
        if (!controller.signal.aborted) {
          setLoading(false);
        }
      }
    }, 250);

    return () => {
      window.clearTimeout(timeoutId);
      controller.abort();
    };
  }, [headerSearch.mode, query]);

  function navigateTo(result: GlobalSearchResult) {
    setOpen(false);
    setGlobalQuery("");
    router.push(result.href);
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (headerSearch.mode === "requests") {
      return;
    }
    if (results[0]) {
      navigateTo(results[0]);
    }
  }

  return (
    <form
      className={mobile ? "relative min-w-0 flex-1" : "relative mx-auto w-full max-w-xl"}
      onSubmit={handleSubmit}
    >
      <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
      <input
        aria-label="Search across CareerVault"
        aria-controls={resultsId}
        aria-expanded={open}
        aria-haspopup="listbox"
        className={`h-10 w-full border border-slate-200 pl-10 pr-9 text-sm text-slate-900 outline-none placeholder:text-slate-400 focus:border-blue-300 focus:ring-blue-100 ${
          mobile
            ? "rounded-full bg-white shadow-sm focus:ring-2"
            : "rounded-[20px] bg-slate-50 focus:bg-white focus:ring-4"
        }`}
        onBlur={() => window.setTimeout(() => setOpen(false), 120)}
        onChange={(event) => {
          if (headerSearch.mode === "requests") {
            headerSearch.setInternalQuery(event.target.value);
          } else {
            setGlobalQuery(event.target.value);
            setOpen(true);
          }
        }}
        onFocus={() =>
          headerSearch.mode === "global" && query.trim().length >= 2 && setOpen(true)
        }
        placeholder={
          headerSearch.mode === "requests"
            ? "Search current requests"
            : mobile
              ? "Search all"
              : "Search candidates, requests, IDs, emails..."
        }
        role="combobox"
        type="search"
        value={query}
      />
      {loading ? (
        <span className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 animate-spin rounded-full border-2 border-slate-200 border-t-blue-600" />
      ) : null}

      {headerSearch.mode === "global" && open && query.trim().length >= 2 ? (
        <div
          className="absolute left-0 right-0 top-12 z-50 max-h-80 overflow-y-auto rounded-[20px] border border-slate-200 bg-white p-2 shadow-2xl shadow-slate-300/60"
          id={resultsId}
          role="listbox"
        >
          {results.length ? (
            results.map((result) => (
              <button
                className="flex w-full items-start gap-3 rounded-[16px] px-3 py-3 text-left transition hover:bg-slate-50 focus:bg-slate-50 focus:outline-none"
                key={`${result.type}-${result.id}`}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => navigateTo(result)}
                aria-selected="false"
                role="option"
                type="button"
              >
                <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-[16px] bg-blue-50 text-blue-700">
                  {result.type === "module" ? (
                    <LayoutDashboard className="h-4 w-4" />
                  ) : (
                    <Users className="h-4 w-4" />
                  )}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-semibold text-slate-900">
                    {result.title}
                  </span>
                  <span className="mt-0.5 block truncate text-xs text-slate-500">
                    {result.subtitle}
                  </span>
                </span>
                {result.status ? (
                  <span className="mt-1 rounded-full bg-slate-100 px-2 py-1 text-[10px] font-semibold capitalize text-slate-600">
                    {result.status.replaceAll("_", " ")}
                  </span>
                ) : null}
              </button>
            ))
          ) : loading ? (
            <GlobalSearchSkeleton />
          ) : (
            <p className="px-3 py-6 text-center text-sm text-slate-500">No results found.</p>
          )}
        </div>
      ) : null}
    </form>
  );
}

function GlobalSearchSkeleton() {
  return (
    <div className="space-y-2 p-1">
      {[0, 1, 2].map((item) => (
        <div className="flex animate-pulse items-center gap-3 rounded-[16px] px-2 py-2" key={item}>
          <div className="h-9 w-9 rounded-[16px] bg-slate-100" />
          <div className="flex-1">
            <div className="h-3 w-32 rounded bg-slate-100" />
            <div className="mt-2 h-3 w-48 rounded bg-slate-100" />
          </div>
        </div>
      ))}
    </div>
  );
}

function NotificationMenu({
  mobile = false,
  notifications,
  onOpen,
  onViewRequest,
}: {
  mobile?: boolean;
  notifications: HrNotification[];
  onOpen: () => void;
  onViewRequest: (requestId?: string) => void;
}) {
  const unreadCount = notifications.filter((notification) => !notification.readAt).length;

  return (
    <DropdownMenu.Root onOpenChange={(open) => open && onOpen()}>
      <DropdownMenu.Trigger asChild>
        <button
          aria-label={`Notifications${unreadCount ? `, ${unreadCount} unread` : ""}`}
          className={`relative flex h-10 w-10 shrink-0 items-center justify-center border border-slate-200 bg-white text-slate-600 transition hover:border-blue-200 hover:bg-blue-50 hover:text-blue-700 ${
            mobile ? "rounded-full shadow-sm" : "rounded-[20px]"
          }`}
          type="button"
        >
          <Bell className="h-4 w-4" />
          {unreadCount ? (
            <span className="absolute -right-1 -top-1 flex h-5 min-w-5 items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-bold text-white">
              {Math.min(unreadCount, 9)}
              {unreadCount > 9 ? "+" : ""}
            </span>
          ) : null}
        </button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          align="end"
          className="z-50 mt-2 w-[min(22rem,calc(100vw-2rem))] overflow-hidden rounded-[20px] border border-slate-200 bg-white shadow-xl shadow-slate-200/70"
        >
          <div className="border-b border-slate-100 px-4 py-3">
            <p className="font-bold text-slate-950">Notifications</p>
            <p className="mt-0.5 text-xs text-slate-500">Candidate request activity</p>
          </div>
          <div className="max-h-80 overflow-y-auto p-2">
            {notifications.length ? (
              notifications.map((notification) => (
                <DropdownMenu.Item
                  key={notification.id}
                  className="cursor-pointer rounded-[16px] px-3 py-3 outline-none transition hover:bg-slate-50 focus:bg-slate-50"
                  onSelect={() => onViewRequest(notification.requestId)}
                >
                  <div className="flex items-start gap-3">
                    <span
                      className={`mt-1 h-2 w-2 shrink-0 rounded-full ${
                        notification.readAt ? "bg-slate-300" : "bg-blue-600"
                      }`}
                    />
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-slate-900">{notification.title}</p>
                      <p className="mt-1 text-xs leading-5 text-slate-500">{notification.message}</p>
                      <p className="mt-1 text-[11px] text-slate-400">
                        {new Intl.DateTimeFormat("en", {
                          month: "short",
                          day: "numeric",
                          hour: "numeric",
                          minute: "2-digit",
                        }).format(new Date(notification.createdAt))}
                      </p>
                    </div>
                  </div>
                </DropdownMenu.Item>
              ))
            ) : (
              <p className="px-3 py-6 text-center text-sm text-slate-500">
                No notifications yet.
              </p>
            )}
          </div>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}

function ProfileMenu({
  initials,
  name,
  onSignOut,
  showName = false,
}: {
  initials: string;
  name: string;
  onSignOut: () => void;
  showName?: boolean;
}) {
  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger asChild>
        <button
          aria-label="Open profile menu"
          className={`flex items-center rounded-[20px] border border-transparent transition hover:border-slate-200 hover:bg-slate-50 ${
            showName ? "gap-2 px-2 py-1.5" : "h-10 w-10 justify-center border-slate-200 bg-white shadow-sm"
          }`}
          type="button"
        >
          {showName ? (
            <span className="flex h-8 w-8 items-center justify-center rounded-full bg-linear-to-br from-blue-600 to-violet-600 text-xs font-semibold text-white">
              {initials}
            </span>
          ) : (
            <User className="h-4 w-4 text-slate-600" />
          )}
          {showName ? <span className="text-sm font-medium text-slate-800">{name}</span> : null}
          {showName ? <ChevronDown className="h-4 w-4 text-slate-500" /> : null}
        </button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          align="end"
          className="z-50 mt-2 w-56 origin-top-right rounded-[20px] border border-slate-200 bg-white p-2 shadow-xl shadow-slate-200/70 data-[state=open]:animate-in data-[state=open]:fade-in data-[state=open]:zoom-in-95"
        >
          <div className="mb-2 rounded-[20px] bg-slate-50 px-3 py-2">
            <p className="truncate text-sm font-bold text-slate-900">{name}</p>
          </div>
          <ProfileMenuItem icon={<User className="h-4 w-4" />} label="My Profile" />
          <ProfileMenuItem icon={<Settings className="h-4 w-4" />} label="Account Settings" />
          <ProfileMenuItem icon={<HelpCircle className="h-4 w-4" />} label="Help & Support" />
          <DropdownMenu.Separator className="my-2 h-px bg-slate-100" />
          <ProfileMenuItem
            danger
            icon={<X className="h-4 w-4" />}
            label="Sign Out"
            onSelect={onSignOut}
          />
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}

function ProfileMenuItem({
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

export function PageHeader({
  action,
  eyebrow,
  subtitle,
  title,
}: {
  action?: React.ReactNode;
  eyebrow: string;
  subtitle: string;
  title: string;
}) {
  return (
    <section className="rounded-[20px] border border-slate-200 bg-white p-5 shadow-sm">
      <div className="flex flex-col gap-5 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-blue-600">{eyebrow}</p>
          <h1 className="mt-2 text-3xl font-semibold tracking-tight text-slate-950">{title}</h1>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-500">{subtitle}</p>
        </div>
        {action ? <div className="shrink-0">{action}</div> : null}
      </div>
    </section>
  );
}

export function StatCard({
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

export function Panel({
  action,
  children,
  title,
  subtitle,
}: {
  action?: React.ReactNode;
  children: React.ReactNode;
  title: string;
  subtitle?: string;
}) {
  return (
    <section className="rounded-[20px] border border-slate-200/80 bg-white p-6 shadow-xl shadow-slate-200/60">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold tracking-tight text-slate-950">{title}</h2>
          {subtitle ? <p className="mt-2 text-sm text-slate-500">{subtitle}</p> : null}
        </div>
        {action ? <div className="shrink-0">{action}</div> : null}
      </div>
      <div className="mt-6">{children}</div>
    </section>
  );
}

export function CreateRequestCta({
  className = "",
  variant = "primary",
}: {
  className?: string;
  variant?: "primary" | "inverse";
}) {
  return (
    <Link
      className={`inline-flex h-12 w-full shrink-0 items-center justify-center gap-2 rounded-[20px] px-5 text-sm font-bold shadow-xl transition duration-200 hover:scale-[1.02] hover:shadow-2xl sm:w-auto ${
        variant === "inverse"
          ? "bg-white text-blue-700 shadow-blue-950/20 hover:bg-blue-50"
          : "bg-blue-600 text-white shadow-blue-600/20 hover:bg-blue-700"
      } ${className}`}
      href="/requests"
    >
      <Send className="h-4 w-4" />
      Create request
    </Link>
  );
}

export function PrimaryButton({
  children,
  className = "",
  disabled,
  onClick,
  type = "button",
}: {
  children: React.ReactNode;
  className?: string;
  disabled?: boolean;
  onClick?: () => void;
  type?: "button" | "submit";
}) {
  return (
    <button
      className={`h-11 rounded-[20px] bg-blue-600 px-5 text-sm font-bold text-white shadow-lg shadow-blue-600/20 hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-60 ${className}`}
      disabled={disabled}
      onClick={onClick}
      type={type}
    >
      {children}
    </button>
  );
}

export function SecondaryButton({
  children,
  className = "",
  disabled,
  onClick,
  type = "button",
}: {
  children: React.ReactNode;
  className?: string;
  disabled?: boolean;
  onClick?: () => void;
  type?: "button" | "submit";
}) {
  return (
    <button
      className={`h-11 rounded-[20px] border border-slate-200 bg-white px-5 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60 ${className}`}
      disabled={disabled}
      onClick={onClick}
      type={type}
    >
      {children}
    </button>
  );
}

export function FormField({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="text-sm font-semibold text-slate-700">{label}</span>
      <div className="mt-2">{children}</div>
    </label>
  );
}

export function TextInput({
  autoComplete,
  onBlur,
  onChange,
  onKeyDown,
  placeholder,
  required,
  type = "text",
  value,
}: {
  autoComplete?: string;
  onBlur?: () => void;
  onChange: (value: string) => void;
  onKeyDown?: (event: KeyboardEvent<HTMLInputElement>) => void;
  placeholder?: string;
  required?: boolean;
  type?: string;
  value: string;
}) {
  return (
    <input
      autoComplete={autoComplete}
      className="h-11 w-full rounded-[20px] border border-slate-200 px-4 text-sm text-slate-700 outline-none focus:border-blue-300"
      onBlur={onBlur}
      onChange={(event) => onChange(event.target.value)}
      onKeyDown={onKeyDown}
      placeholder={placeholder}
      required={required}
      type={type}
      value={value}
    />
  );
}

export function DropdownSelect({
  icon,
  onChange,
  options,
  value,
}: {
  icon?: React.ReactNode;
  onChange: (value: string) => void;
  options: Array<{ label: string; value: string }>;
  value: string;
}) {
  return (
    <div className="relative">
      <select
        className={`h-11 w-full appearance-none rounded-[20px] border border-slate-200 bg-white pr-10 text-sm text-slate-700 outline-none focus:border-blue-300 ${
          icon ? "pl-10" : "pl-4"
        }`}
        onChange={(event) => onChange(event.target.value)}
        value={value}
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
      {icon ? (
        <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-500">
          {icon}
        </span>
      ) : null}
      <ChevronDown className="pointer-events-none absolute right-4 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
    </div>
  );
}

export function StatusBadge({ status }: { status: string }) {
  const normalized = status.toLowerCase();
  const className =
    normalized === "pending"
      ? "bg-amber-50 text-amber-700"
      : normalized === "submitted"
        ? "bg-emerald-50 text-emerald-700"
        : normalized === "expired"
          ? "bg-slate-100 text-slate-600"
          : "bg-slate-100 text-slate-600";

  return (
    <span className={`inline-flex rounded-full px-3 py-1 text-xs font-semibold ${className}`}>
      {status}
    </span>
  );
}
