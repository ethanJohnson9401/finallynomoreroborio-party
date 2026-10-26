import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Finally No More roboRIO | The Retirement Party",
  description:
      "The ridiculously overproduced retirement party for the roboRIO. Counting down to the 2027 FRC kickoff and welcoming Systemcore.",
  applicationName: "finallynomoreroborio.party",
  openGraph: {
    title: "THE ROBORIO IS GETTING THE BOOT.",
    description:
        "An independent FRC parody celebrating the roboRIO's retirement and Systemcore's arrival.",
    siteName: "finallynomoreroborio.party",
    type: "website",
  },
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
