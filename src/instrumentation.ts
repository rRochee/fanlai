// Next.js 服务端初始化钩子：注册每日情报调度器
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { startScheduler } = await import("./lib/scheduler")
    startScheduler()
  }
}
