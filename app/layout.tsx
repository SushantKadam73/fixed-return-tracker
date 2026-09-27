import type { Metadata } from "next";
import { GeistSans } from "geist/font/sans";
import { GeistMono } from "geist/font/mono";
import { ThemeProvider } from "@/components/theme";
import { SiteFooter, SiteHeader } from "@/components/site-chrome";
import "./globals.css";

export const metadata: Metadata = {
  title: {
    default: "Fixed Return Tracker — FD, RD, savings and small-savings rates in India",
    template: "%s · Fixed Return Tracker",
  },
  description:
    "Compare fixed deposit, recurring deposit and savings account interest rates across Indian banks, with full rate history, small-savings schemes, EPF/PPF/NPS, inflation and the real value of money.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en-IN" className={`${GeistSans.variable} ${GeistMono.variable} h-full antialiased`} suppressHydrationWarning>
      <body className="flex min-h-full flex-col">
        <ThemeProvider>
          <SiteHeader />
          <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-8 sm:px-6">{children}</main>
          <SiteFooter />
        </ThemeProvider>
      </body>
    </html>
  );
}
