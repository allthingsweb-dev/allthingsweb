import type { Metadata } from "next";
import { StackProvider, StackTheme } from "@stackframe/stack";
import { stackServerApp } from "../lib/stack";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { ThemeProvider } from "@/components/theme-provider";
import { Toaster } from "@/components/ui/sonner";
import { mainConfig } from "@/lib/config";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

const title = "All Things Web";
const description =
  "Discover exciting web development events in the Bay Area and San Francisco.";
const url = mainConfig.instance.origin;
const imageUrl = `${mainConfig.instance.origin}/api/v1/preview.png`;

export const metadata: Metadata = {
  title: {
    default: title,
    template: "%s | All Things Web",
  },
  description,
  openGraph: {
    title,
    description,
    url,
    images: [
      {
        url: imageUrl,
        width: 1200,
        height: 630,
        alt: title,
      },
    ],
    type: "website",
    siteName: "All Things Web",
    locale: "en_US",
  },
  twitter: {
    card: "summary_large_image",
    title,
    description,
    images: [imageUrl],
    site: "@allthingswebdev",
    creator: "@allthingswebdev",
  },
  alternates: {
    types: {
      "application/rss+xml": [
        {
          url: `${mainConfig.instance.origin}/rss`,
          title: "All Things Web RSS Feed",
        },
      ],
    },
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased`}
      >
        <StackProvider app={stackServerApp}>
          <StackTheme>
            <ThemeProvider
              attribute="class"
              defaultTheme="system"
              enableSystem
              disableTransitionOnChange
            >
              {children}
              <Toaster />
            </ThemeProvider>
          </StackTheme>
        </StackProvider>
      </body>
    </html>
  );
}
