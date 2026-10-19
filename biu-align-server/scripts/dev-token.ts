// 本地开发用：用 .env 里的 JWT_SECRET 签一个测试 token，免去为了拿 token 再起一套 biu-sync-server、扫码登录 B 站。
// 用法：pnpm token <mid> [有效小时数，默认 12]；想测审核员界面，就把这个 mid 也写进 .env 的 ADMIN_MIDS。
// 生产机上拒绝运行：那里的 JWT_SECRET 和同步服务共用，签出来的就是能冒充任意用户的真凭证。
import jwt from "jsonwebtoken";

import "dotenv/config";

const [mid, hoursArg] = process.argv.slice(2);
if (process.env.NODE_ENV === "production") {
  console.error("NODE_ENV=production 下不签测试 token");
  process.exit(1);
}
if (!mid || !/^\d+$/.test(mid)) {
  console.error("用法：pnpm token <mid> [有效小时数]，mid 是 B 站 UID（纯数字）");
  process.exit(1);
}
const secret = process.env.JWT_SECRET;
if (!secret) {
  console.error("缺少 JWT_SECRET：先 cp .env.example .env 并填一个随机字符串");
  process.exit(1);
}
const hours = Number(hoursArg ?? 12);
const admins = (process.env.ADMIN_MIDS ?? "").split(",").map(s => s.trim());
console.log(jwt.sign({ mid }, secret, { expiresIn: Math.round(hours * 3600) }));
console.error(
  `mid=${mid}，${hours} 小时有效${admins.includes(mid) ? "，审核员" : ""}。用法：-H "Authorization: Bearer <上面这串>"`,
);
