import type { Metadata } from "next";
import { Roboto_Slab } from "next/font/google";
import { Navbar } from "@/components/Navbar";
import { Footer } from "@/components/Footer";
import { VisitorTracker } from "@/components/VisitorTracker";
import "./globals.css";

const robotoSlab = Roboto_Slab({
  subsets: ["latin"],
  weight: ["400", "600", "700"],
  variable: "--font-roboto-slab",
  display: "swap",
});

export const metadata: Metadata = {
  title: "The Metascience Observatory Explorer",
  description: "Explore academic journals with publication and citation metrics",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={robotoSlab.variable}>
      <body className="font-sans antialiased min-h-screen bg-white">
        <Navbar />
        <main>{children}</main>
        <Footer />
        <VisitorTracker />
      </body>
    </html>
  );
}
