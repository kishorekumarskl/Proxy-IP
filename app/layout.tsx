import type { Metadata } from "next";
import "@/app/globals.css";

export const metadata: Metadata = {
  title: "Private Proxy & Network Manager",
  description: "Manage authorized private proxy and exit-node health checks."
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
