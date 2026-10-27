"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  useEffect,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import {
  IconChevronLeft,
  IconChevronsRight,
  IconClose,
  IconMenu,
  IconSearch,
  LogoMark,
} from "@/components/ui/icons";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { NAV_ITEMS, type NavItem } from "@/components/shell/nav-items";
import { ProfileMenu } from "@/components/shell/profile-menu";
import { SearchDialog } from "@/components/shell/search-dialog";

const STORAGE_KEY = "trustcart.sidebar.collapsed";
const SIDEBAR_EVENT = "trustcart:sidebar-collapsed";

/** localStorage is the external store; same-tab updates dispatch a custom
 * event because the `storage` event only fires for cross-tab changes. */
function subscribe(callback: () => void) {
  window.addEventListener("storage", callback);
  window.addEventListener(SIDEBAR_EVENT, callback);
  return () => {
    window.removeEventListener("storage", callback);
    window.removeEventListener(SIDEBAR_EVENT, callback);
  };
}
function getSnapshot(): boolean {
  return window.localStorage.getItem(STORAGE_KEY) === "1";
}
function getServerSnapshot(): boolean {
  return false;
}
function writeCollapsed(next: boolean) {
  window.localStorage.setItem(STORAGE_KEY, next ? "1" : "0");
  window.dispatchEvent(new Event(SIDEBAR_EVENT));
}

/**
 * Dashboard shell: collapsible desktop sidebar (240px ⇄ 72px) and a
 * slide-over drawer on mobile. The main column is flex-1 min-w-0, so
 * sidebar changes only shrink the reserved gutter — content reflows and
 * never distorts. Tables scroll horizontally inside their own wrapper.
 */
export function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const collapsed = useSyncExternalStore(
    subscribe,
    getSnapshot,
    getServerSnapshot,
  );
  const [mobileOpen, setMobileOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);

  // Scroll lock + Escape while the mobile drawer is open.
  useEffect(() => {
    if (!mobileOpen) return;
    document.body.style.overflow = "hidden";
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setMobileOpen(false);
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = "";
      document.removeEventListener("keydown", onKey);
    };
  }, [mobileOpen]);

  const isHome = pathname === "/";
  const current: NavItem | undefined = NAV_ITEMS.find((item) =>
    item.href === "/" ? isHome : pathname.startsWith(item.href),
  );

  const navLists = (onNavigate?: () => void) => (
    <nav aria-label="Primary">
      <ul role="list" className="flex flex-col gap-1 p-3">
        {NAV_ITEMS.map((item) => {
          const active =
            item.href === "/" ? isHome : pathname.startsWith(item.href);
          return (
            <li key={item.href}>
              <Link
                href={item.href}
                onClick={onNavigate}
                aria-current={active ? "page" : undefined}
                title={collapsed ? item.label : undefined}
                className={`flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors ${
                  active
                    ? "bg-primary-soft text-primary"
                    : "text-muted hover:bg-background hover:text-foreground"
                } ${collapsed ? "justify-center" : ""}`}
              >
                <item.Icon className="h-5 w-5 shrink-0" aria-hidden="true" />
                <span className={collapsed ? "sr-only" : "truncate"}>
                  {item.label}
                </span>
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );

  return (
    <div className="flex min-h-dvh">
      {/* Desktop sidebar: fixed-width column; main uses flex-1 min-w-0. */}
      <aside
        aria-label="Primary navigation"
        className={`sticky top-0 hidden h-dvh shrink-0 flex-col border-r border-line bg-surface transition-[width] duration-200 lg:flex ${
          collapsed ? "w-[72px]" : "w-[240px]"
        }`}
      >
        <div
          className={`flex items-center gap-2.5 border-b border-line px-4 py-4 ${
            collapsed ? "justify-center px-2" : ""
          }`}
        >
          <LogoMark className="h-8 w-8 shrink-0" />
          {collapsed ? <span className="sr-only">TrustCart AI</span> : (
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold tracking-tight">
                TrustCart AI
              </p>
              <p className="text-[11px] text-muted">Merchant risk intelligence</p>
            </div>
          )}
        </div>
        {navLists()}
        <div className="mt-auto border-t border-line p-3">
          {!collapsed ? (
            <p className="mb-2 px-3 text-[11px] leading-4 text-muted">
              All phases shipped — deterministic risk engine, AI copilot, and
              server-verified PayPal Sandbox checkout.
            </p>
          ) : null}
          <Button
            variant="ghost"
            size="sm"
            onClick={() => writeCollapsed(!collapsed)}
            aria-expanded={!collapsed}
            aria-label={collapsed ? "Expand navigation" : "Collapse navigation"}
            className={`w-full ${collapsed ? "justify-center" : "justify-start"}`}
          >
            {collapsed ? (
              <IconChevronsRight className="h-4 w-4" />
            ) : (
              <>
                <IconChevronLeft className="h-4 w-4" />
                Collapse
              </>
            )}
          </Button>
        </div>
      </aside>

      {/* Mobile drawer */}
      {mobileOpen ? (
        <div className="fixed inset-0 z-40 lg:hidden">
          <button
            type="button"
            aria-label="Close navigation"
            onClick={() => setMobileOpen(false)}
            className="absolute inset-0 h-full w-full bg-foreground/40"
            tabIndex={-1}
          />
          <aside
            role="dialog"
            aria-modal="true"
            aria-label="Primary navigation"
            className="absolute inset-y-0 left-0 flex w-72 flex-col border-r border-line bg-surface shadow-xl"
          >
            <div className="flex items-center justify-between border-b border-line px-4 py-4">
              <div className="flex items-center gap-2.5">
                <LogoMark className="h-8 w-8" />
                <p className="text-sm font-semibold">TrustCart AI</p>
              </div>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setMobileOpen(false)}
                aria-label="Close navigation"
              >
                <IconClose className="h-4 w-4" />
              </Button>
            </div>
            {navLists(() => setMobileOpen(false))}
          </aside>
        </div>
      ) : null}

      {/* Main column: min-w-0 keeps tables/flex children from overflowing. */}
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-30 border-b border-line bg-surface/85 backdrop-blur">
          <div className="flex h-14 items-center gap-3 px-4 md:px-6 lg:px-8">
            <Button
              variant="ghost"
              size="sm"
              className="lg:hidden"
              onClick={() => setMobileOpen(true)}
              aria-expanded={mobileOpen}
              aria-label="Open navigation"
            >
              <IconMenu className="h-5 w-5" />
            </Button>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-semibold">
                {current?.label ?? "TrustCart AI"}
              </p>
            </div>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => setSearchOpen(true)}
              aria-haspopup="dialog"
              // Tailwind v4: `hidden sm:inline-flex` loses the display cascade
              // against the Button's base `inline-flex` (base .inline-flex is
              // emitted AFTER base .hidden) — max-sm:hidden is variant-scoped
              // and reliably wins below the sm breakpoint.
              className="max-sm:hidden"
            >
              <IconSearch className="h-4 w-4" />
              Search orders
              <span
                aria-hidden="true"
                className="ml-1 rounded border border-line bg-background px-1 text-[10px] text-muted"
              >
                Esc to close
              </span>
            </Button>
            <Button
              variant="secondary"
              size="sm"
              className="sm:hidden"
              onClick={() => setSearchOpen(true)}
              aria-haspopup="dialog"
              aria-label="Search orders"
            >
              <IconSearch className="h-4 w-4" />
            </Button>
            {/* Same cascade note as the search button above. */}
            <Badge tone="warning" className="max-md:hidden">
              Demo data
            </Badge>
            <ProfileMenu />
          </div>
        </header>

        <main
          id="main-content"
          className="mx-auto w-full max-w-[1440px] flex-1 px-4 py-6 md:px-6 lg:px-8"
        >
          {children}
        </main>

        <footer className="border-t border-line px-4 py-4 text-xs text-muted md:px-6 lg:px-8">
          TrustCart AI · Synthetic demo data only — deterministic risk engine,
          AI copilot, and server-verified PayPal Sandbox checkout.
        </footer>
      </div>

      <SearchDialog open={searchOpen} onClose={() => setSearchOpen(false)} />
    </div>
  );
}
