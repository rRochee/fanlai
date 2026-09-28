import type { Metadata } from "next"
import "./globals.css"
import { ThemeProvider } from "next-themes"
import { Toaster } from "@/components/ui/sonner"

export const metadata: Metadata = {
  title: "饭来 · 每日一份当季求职名录",
  description:
    "饭来——每日送达的当季求职名录与投递记录，先看企业，再挑岗位。别的产品给你一片信息的海，饭来每天只递一份准时开饭的名录：覆盖科技零售、智能制造、消费电子、智能硬件、供应链、医疗健康等 18 个行业。",
  keywords: ["秋招", "校招", "企业名录", "投递记录", "饭来"],
  icons: {
    icon: "/logo.svg",
  },
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html lang="zh-CN" suppressHydrationWarning>
      <body className="antialiased bg-background text-foreground font-sans">
        <ThemeProvider attribute="class" defaultTheme="system" enableSystem disableTransitionOnChange>
          {children}
          {/* 提示改到屏幕底部中央（Task 26-i）：不再盖住顶部目录栏；
              底部抬升避开移动端 Tabbar；默认 2.6s 自消 + 可手动关闭 */}
          <Toaster
            position="bottom-center"
            offset="calc(66px + env(safe-area-inset-bottom))"
            closeButton
            toastOptions={{ duration: 2600 }}
          />
        </ThemeProvider>
      </body>
    </html>
  )
}
