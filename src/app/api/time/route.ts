/**
 * 服务器授时：给前端做「实时校准的北京时间」用。
 * 服务器时钟随宿主 NTP 校准，前端以此计算本机时钟偏移量，
 * 之后即使设备时钟不准也能呈现正确的北京时间。
 */
export const dynamic = "force-dynamic"

export function GET() {
  const now = Date.now()
  return new Response(JSON.stringify({ now, iso: new Date(now).toISOString() }), {
    headers: { "Cache-Control": "no-store", "Content-Type": "application/json" },
  })
}
