import type { Metadata } from "next";
import { Sora } from "next/font/google";
import { ClerkProvider } from "@clerk/nextjs";
import "./globals.css";

const sora = Sora({ subsets: ["latin"] });

export const metadata: Metadata = {
  title: "DevCollab",
  description: "Real-time collaborative code editor",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <ClerkProvider
      appearance={{
        variables: {
          colorPrimary: "#a855f7",
          colorBackground: "#120d2b",
          colorForeground: "#f5f3ff",
          colorMutedForeground: "#b7aedd",
          colorInput: "#1b1440",
          colorInputForeground: "#f5f3ff",
          colorNeutral: "#ffffff",
          borderRadius: "0.9rem",
        },
      }}
    >
      <html lang="en">
        <body className={sora.className}>{children}</body>
      </html>
    </ClerkProvider>
  );
}