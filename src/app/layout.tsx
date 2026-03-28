import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Aether Router",
  description: "AI Model Router - Access multiple AI providers through a single API",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className="dark">
      <body className="min-h-screen antialiased">{children}</body>
    </html>
  );
}
