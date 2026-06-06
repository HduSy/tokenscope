# Tokenscope

[English](README.md) · **中文**

macOS 菜单栏工具，展示 Claude CLI 的 **每日 Token 用量、估算花费、按模型 / MCP / Skill 的调用统计**。

技术栈：**Tauri 2 + React + TypeScript**（前端）/ **Rust**（数据层）。

![Tokenscope 面板（深色 / 浅色）](docs/screenshot.png)

## 它做什么

- 菜单栏图标旁显示当日 Token 数（如 `⬡ 14.00M`）
- 点击打开面板：Day / Week / Month 切换
- 指标：总 Token（input/output）、估算花费、Requests / Sessions
- 三个切片：**按模型** / **按 MCP 调用** / **按 Skill 调用**
- 成本甜甜圈（hover 看单模型）、年度活跃热力图
- **只统计用户自己安装的 MCP / Skill**，过滤所有 Claude 内置工具与 Anthropic 自带 MCP

## 数据来源（零侵入，只读）

| 用途 | 路径 |
|------|------|
| 会话日志（Token / 模型 / 工具调用） | `~/.claude/projects/**/*.jsonl` |
| 用户 MCP 白名单 | `~/.claude.json` → `mcpServers` + `projects[*].mcpServers` |
| 用户 Skill 白名单 | `~/.claude/skills/` 目录 |
| 模型价格 | **主**：[models.dev](https://models.dev/api.json)（裸模型名，匹配 Claude CLI 日志）→ **兜底**：[LiteLLM](https://raw.githubusercontent.com/BerriAI/litellm/main/model_prices_and_context_window.json) → 内置快照。缓存于 `~/Library/Caches/tokenscope/`，24h 刷新，离线回退 |

### 关键处理
- 按 `message.id` 去重（流式/重试会重复 usage）；同一消息跨多行时合并其工具调用，token 只计一次
- token 拆分：`input`(未缓存) / `cache`(creation+read) / `output`；UI 默认把 cache 并入 In 显示，并单列「cached %」
- 价格匹配：精确名 → 归一化名（去厂商前缀 + `.`↔`p`，如 `glm-5.1`⇄`glm-5p1`）；models.dev 优先官方裸名价
- 成本按四类 token 分别计价；模型带 `priced` 标记，**两源都查不到的模型只计 Token、UI 标注「暂无定价」**
- 日志只有裸模型名、无厂商信息 → 第三方模型默认取官方厂商价（估算）
- 工具分类：`mcp__<server>__*` 且 server 在用户配置中 → MCP；Skill 调用（`Skill` 工具的 `input.skill`，或 `/skill` 斜杠命令）且在 skills 目录中 → Skill；其余忽略

> 花费为按公开价格的**估算**；订阅用户应理解为「等效消费价值」。

## 安装

### 方式一：Homebrew（推荐）

```bash
brew install --cask hdusy/tokenscope/tokenscope
```

安装后会自动清除隔离属性（cask 的 `postflight` 已内置 `xattr -cr`），**首次直接打开即可，不会弹「Apple 无法验证」**。

打开一次后即注册为登录项，之后**每次开机自动在菜单栏运行**。

升级：

```bash
brew upgrade --cask tokenscope
```

### 方式二：下载 .dmg

1. 从 [Releases](https://github.com/HduSy/tokenscope/releases) 下载最新的 `Tokenscope_*_universal.dmg`（同时支持 Apple Silicon 与 Intel）
2. 拖入「应用程序」
3. 因为是**未签名 / 未公证**构建，首次打开会被 Gatekeeper 拦截，二选一：
   - 右键 App →「打开」→ 再次确认「打开」，或
   - 终端执行一次：
     ```bash
     xattr -cr /Applications/Tokenscope.app && open /Applications/Tokenscope.app
     ```

> 未签名是当前的已知限制。要彻底「双击直开」需 Apple Developer ID 签名 + 公证，见 `PRD.md` §6.4。

### 首次启动后

- 菜单栏出现图标 + 当日 Token 数（如 `⬡ 12.40M`）
- 左键点击图标开/关面板，右键出菜单（Open / Refresh / Quit）
- 已自动设置**登录自启**，无需手动配置

## 开发

```bash
pnpm install
pnpm tauri dev         # 启动桌面 App（需要 Rust 工具链）
```

仅预览前端（用真实数据快照 `public/dev-dashboard.json`）：

```bash
pnpm dev               # http://localhost:1420
# 刷新快照：
cd src-tauri && cargo run --example dump > ../public/dev-dashboard.json
```

## 构建

```bash
pnpm tauri build       # 产出 .app / .dmg 到 src-tauri/target/release/bundle/
```

分发见 `PRD.md` §6.3（推荐 Homebrew Cask；`.dmg` 直接下载建议代码签名 + 公证）。

## 结构

```
src/                  React 前端
  data.ts             类型 + Tauri 桥 + 主题 + 格式化
  charts.tsx          图表原语（柱状/甜甜圈/sparkline/热力图/分段控件）
  App.tsx             主面板
src-tauri/src/
  store.rs            JSONL 增量摄取（按 message.id 去重 + 多行合并）
  parser.rs           聚合（Day/Week/Month + 热力图）
  pricing.rs          models.dev / LiteLLM 价格加载与计价
  config.rs           用户 MCP / Skill 白名单
  model.rs            返回给前端的数据结构
  lib.rs              Tauri 命令 + 菜单栏托盘
```

## Bug 记录

开发过程中遇到的典型 bug（现象、根因、解决办法）汇总在
[docs/BUGFIXES.md](docs/BUGFIXES.md)。
