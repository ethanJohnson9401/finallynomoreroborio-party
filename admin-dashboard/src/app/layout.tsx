
import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Trauma Center | roboRIO Incident Command",
  description: "Authorized roboRIO trauma investigation console.",
  robots: {
    index: false,
    follow: false,
  },
};

export default function RootLayout({
                                     children,
                                   }: Readonly<{
  children: React.ReactNode;
}>) {
  return (
      <html lang="en">
      <body>{children}</body>
      </html>
  );
}
