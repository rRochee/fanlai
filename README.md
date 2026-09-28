<div align="center">

# 饭来 FanLai

**找工作就是找一碗饭。**

![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)&nbsp; ![Next.js 16](https://img.shields.io/badge/Next.js-16-black)&nbsp; ![React 19](https://img.shields.io/badge/React-19-61dafb)&nbsp; ![TypeScript 5](https://img.shields.io/badge/TypeScript-5-3178c6)&nbsp; ![Tailwind v4](https://img.shields.io/badge/Tailwind-v4-38bdf8)

![饭来 FanLai 首页](docs/screenshots/01-cover.png)

*每天一份准时开饭的秋招名录 —— 先看企业，再挑岗位，投递有迹，截止不慌。*

[快速开始](#快速开始)&nbsp;·&nbsp;[功能总览](#它能帮你做什么)&nbsp;·&nbsp;[几个诚实的原则](#几个诚实的原则)&nbsp;·&nbsp;[License](#license)

</div>

---

## 为什么是饭来

秋招和春招，大概是学生时代最漫长的一场考试。

就业的大环境并不友好，它推着每一个人不得不主动出击、去打破信息壁垒；而「人人都在冲刺」的氛围，又反过来加剧了焦虑和内卷。信息不是太少，而是太碎、太吵——你刷得到无数篇经验帖，却很难看到一份干净、诚实、按日排好的企业名录。

饭来就是在这样的心情里做出来的小产品：把信息老老实实罗列出来，先看企业、再挑岗位，记下每一次投递、盯住每一个截止日。它尤其想帮到那些**职业规划还没有完全定型、愿意多尝试不同渠道、想多了解不同行业和企业**的人——不必一次就想清楚一辈子，先把今天的三家投了再说。

> 找工作就是找一碗饭。主动出击的人，值得准时开饭。

---

## 它能帮你做什么

### 🗂 企业名录 · 先看清楚，再交简历

<div align="center">
<img src="docs/screenshots/02-directory.png" width="82%" alt="企业名录"/>
</div>

> 357 家企业、18 个行业，行业筛选 + 关键词搜索。每条情报都标注来源与「待核 / 已核」状态，先把公司是谁、做什么、稳不稳看清，再决定把简历交给谁。

### 📋 投递看板 · 拖一张卡，就是一次流转

<div align="center">
<img src="docs/screenshots/03-tracker.png" width="82%" alt="投递看板"/>
</div>

> 意向 → 投递 → 笔试 → 面试 → Offer，拖拽即流转，历史轨迹自动留痕，支持一键导出 CSV。全季网申截止在旁边按日排布，先截止的先办。

### 📅 投递日历 · 机器核查，人工打卡

<div align="center">
<img src="docs/screenshots/04-deadlines.png" width="82%" alt="投递日历"/>
</div>

> 机器自动探测招聘官网可达性，但明确告诉你它只能确认「官网活着」；每天给出三家最该亲核的企业，点开官网看一眼、回来打个卡——打卡过的情报，才是你自己的情报。

### 📊 求职洞察 · 节奏也是竞争力

<div align="center">
<img src="docs/screenshots/05-insights.png" width="82%" alt="求职洞察"/>
</div>

> 投递漏斗、节奏复盘，还有古籍与心声墙——找工作是一场持久战，心态也要有地方安放。

### 📱 移动端 · 深色模式

<div align="center">
<table><tr>
<td><img src="docs/screenshots/06-mobile-today.png" width="300" alt="移动端"/></td>
<td><img src="docs/screenshots/07-dark-cover.png" width="300" alt="暗色模式"/></td>
</tr></table>
</div>

> 左：手机上的今日饭来；右：深夜刷名录不刺眼的暗色模式。跟随系统主题自动切换。

---

## 快速开始

要求 Node.js 20+。

```bash
npm install
cp .env.example .env   # Windows: copy .env.example .env
npm run dev
```

打开 <http://localhost:3000>。数据库零配置（SQLite，仓库自带演示数据，开箱即用）。

Windows 也可以直接双击 `启动饭来.bat`。

---

## 几个诚实的原则

- **机器只做机器能保证的事。** 官网可达性自动探测可以告诉你「这个域名活着」，但没有任何渠道能保证「截止日期准确」。所以每天只给你三家最该亲核的，点开官网看一眼、回来打个卡——打卡过的情报，才是你自己的情报。
- **每条情报都有出处。** 来源分层标注（官网来源 > 平台转载 > 转发渠道 > 已亲核），缺的如实写「暂缺」，不装准确。
- **数据留在你自己手里。** 本地 SQLite，无账号、无上传，求职轨迹属于你自己。

---

## 技术栈

<div align="center">

![Next.js](https://img.shields.io/badge/Next.js-16-black)&nbsp; ![React](https://img.shields.io/badge/React-19-61dafb)&nbsp; ![TypeScript](https://img.shields.io/badge/TypeScript-5-3178c6)&nbsp; ![Tailwind CSS](https://img.shields.io/badge/Tailwind_CSS-v4-38bdf8)&nbsp; ![shadcn/ui](https://img.shields.io/badge/shadcn%2Fui-latest-black)&nbsp; ![Prisma](https://img.shields.io/badge/Prisma-6-2D3748)&nbsp; ![SQLite](https://img.shields.io/badge/SQLite-003B57?logo=sqlite&logoColor=white)

Next.js 16（App Router / Turbopack）· React 19 · TypeScript · Tailwind CSS v4 · shadcn/ui · Prisma + SQLite

</div>

## 项目结构

```
FanLai/
├── src/app/            # App Router 路由（页面 + 20 个 API 端点）
├── src/components/     # UI 组件（fanlai 业务组件 + shadcn/ui）
├── src/lib/            # 数据库、调度器、官网探测、日期计算等核心逻辑
├── prisma/             # 数据库 schema
├── db/                 # SQLite 数据文件（内置演示数据）
├── public/             # 企业 logo、海浪背景视频等静态资源
├── docs/screenshots/   # 产品截图
└── scripts/            # 数据整理与运维脚本
```

## 说明

- `db/custom.db` 内置真实整理的演示数据（企业情报、官网探测结果、示例投递记录）
- 每日名录的自动联网同步需要特定 SDK 环境，默认关闭；记录、核对、看板、日历等核心功能不受影响

---

<div align="center">

*饭来 · 秋招志 —— 今天也要好好吃饭，好好上岸。*

[MIT License](LICENSE) © 2026 rRochee

</div>
