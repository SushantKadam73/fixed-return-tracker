import Link from "next/link";
import { ThemeToggle } from "./theme";

const NAV = [
  { href: "/deposits", label: "FD & RD" },
  { href: "/savings", label: "Savings" },
  { href: "/banks", label: "Banks" },
  { href: "/schemes", label: "Schemes" },
  { href: "/compare", label: "Compare" },
  { href: "/real-value", label: "Real value" },
  { href: "/history", label: "History" },
  { href: "/calculators", label: "Calculators" },
  { href: "/retirement", label: "Retirement" },
];

export function SiteHeader() {
  return (
    <header className="sticky top-0 z-30 border-b border-border bg-bg/90 backdrop-blur">
      <div className="mx-auto flex h-14 max-w-6xl items-center gap-4 px-4 sm:px-6">
        <Link href="/" className="flex items-center gap-2 font-semibold tracking-tight">
          <span className="inline-block h-5 w-5 rounded-sm bg-accent" aria-hidden />
          <span>Fixed Return Tracker</span>
        </Link>
        <nav className="scroll-x ml-2 hidden flex-1 items-center gap-1 text-sm md:flex" aria-label="Main">
          {NAV.map((n) => (
            <Link key={n.href} href={n.href} className="rounded-md px-2.5 py-1.5 text-muted hover:bg-surface hover:text-text">
              {n.label}
            </Link>
          ))}
        </nav>
        <div className="ml-auto flex items-center gap-2">
          <ThemeToggle />
        </div>
      </div>
      <nav className="scroll-x flex gap-1 border-t border-border px-3 py-1.5 text-sm md:hidden" aria-label="Main (mobile)">
        {NAV.map((n) => (
          <Link key={n.href} href={n.href} className="whitespace-nowrap rounded-md px-2.5 py-1 text-muted hover:bg-surface hover:text-text">
            {n.label}
          </Link>
        ))}
      </nav>
    </header>
  );
}

export function SiteFooter() {
  return (
    <footer className="mt-16 border-t border-border">
      <div className="mx-auto grid max-w-6xl gap-6 px-4 py-8 text-sm text-muted sm:grid-cols-3 sm:px-6">
        <div className="space-y-2">
          <p className="font-medium text-text">Fixed Return Tracker</p>
          <p>
            Interest rates as published by each bank and by the Government, with the date and a link to the source.
            Always confirm with the bank before you invest.
          </p>
        </div>
        <div className="space-y-2">
          <p className="font-medium text-text">Not investment advice</p>
          <p>
            This site describes published rates. It does not recommend any bank or product and is not registered with SEBI
            or RBI. Deposits above the DICGC insurance limit carry the issuing bank&apos;s risk.
          </p>
        </div>
        <div className="space-y-2">
          <p className="font-medium text-text">Data</p>
          <ul className="space-y-1">
            <li>
              <Link className="hover:text-text" href="/methodology">
                Methodology &amp; sources
              </Link>
            </li>
            <li>
              <Link className="hover:text-text" href="/status">
                Data status
              </Link>
            </li>
            <li>
              <a className="hover:text-text" href="https://github.com/SushantKadam73/fixed-return-tracker" target="_blank" rel="noopener noreferrer">
                Source code on GitHub
              </a>
            </li>
          </ul>
        </div>
      </div>
    </footer>
  );
}
