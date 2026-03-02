import type { Metadata } from "next";
import { Geist_Mono, Inter } from "next/font/google";
import "./globals.css";
import { Providers } from "./components/providers";

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
  display: "swap",
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Solana Voting dApp",
  description: "Create polls, add candidates, and vote on-chain on Solana",
  icons: {
    icon: "/icon.svg",
    shortcut: "/icon.svg",
    apple: "/icon.svg",
  },
  // OpenGraph metadata — controls how the link looks when shared on LinkedIn,
  // Twitter/X, Discord, etc.  Update the URL once you deploy to production.
  openGraph: {
    title: "Solana Voting dApp",
    description:
      "A full-stack Solana dApp with an Anchor smart contract, Next.js frontend, " +
      "and Solana Actions / Blinks support — built end-to-end on devnet.",
    url: "https://voting-dapp-sol.vercel.app",
    siteName: "Solana Voting dApp",
    images: [
      {
        url: "https://img.freepik.com/free-vector/male-female-user-circles-flat-set_78370-4713.jpg",
        width: 740,
        alt: "Solana Voting dApp",
      },
    ],
    locale: "en_US",
    type: "website",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <Providers>
        <body
          suppressHydrationWarning
          className={`${inter.variable} ${geistMono.variable} antialiased flex min-h-[80vh] flex-col`}
        >
          <main className="flex-1">{children}</main>
          <footer className="w-full border-t border-border-low bg-card/50 px-6 py-3 text-center text-sm text-muted">
            Built by <a href="https://projo.dev/" target="_blank" rel="noopener noreferrer" className="underline hover:text-foreground">Prajyot Tayde</a>
          </footer>
        </body>
      </Providers>
    </html>
  );
}
