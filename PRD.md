# TokenScope 产品需求文档（PRD）

## 1. 产品概述

### 1.1 产品名称
TokenScope —— macOS 菜单栏 Claude CLI 用量仪表盘

### 1.2 一句话定位
一个常驻 macOS 菜单栏的小工具，实时展示 Claude CLI 的 Token 用量、调用统计和使用花费，让用户对自己的 AI 编码消耗"心中有数"。

### 1.3 目标用户
- 频繁使用 Claude CLI / Claude Code 的开发者
- 关心 Token 消耗、订阅性价比、工具使用习惯的个人用户
- 希望了解自己 AI 工作流中哪些 MCP / Skill 真正在被使用的人

### 1.4 解决的问题
- Claude CLI 自带的 `/cost` 只能看当前会话，无法纵向看每日/每周/每月趋势
- 不知道自己装的 MCP、Skill 哪些在用、哪些是"装了不用"占 context
- 没有按项目、按模型维度的消耗洞察
- 缺少常驻、随时可见的用量提醒入口

---

## 2. 核心功能

### 2.1 菜单栏常驻入口
- macOS 菜单栏右上角图标 + 当日 Token 消耗数（如「今日 1.2M tokens」，自动按 K / M 缩写）
- 仅展示 Token 数，不在菜单栏直接显示花费金额
- 点击展开浮窗 / 打开详细仪表盘
- 后台轮询日志，准实时更新

### 2.2 用量仪表盘（核心）

#### 时间维度
- 今日 / 本周 / 本月
- 时段趋势图（按小时 / 按天）

#### 核心指标
| 指标 | 说明 |
|------|------|
| 会话数 | 按 sessionId 去重计数 |
| 消息数 | assistant message 数（按 message.id 去重） |
| Token 用量 | input / output 总量 |
| 估算花费 | 基于 LiteLLM 公开价格表估算（USD，UI 始终带「est.」标识），订阅用户应理解为「等效消费价值」而非真实账单；未在价格表内的模型仅显示 Token 数，不计入花费 |

#### 多维度切片
仪表盘核心三个切片维度：

- **按模型** 分布（Opus / Sonnet / Haiku，以及第三方模型如 GLM、DeepSeek）—— 看 token & 花费在不同模型上的分布
- **按 MCP 调用** 分布 —— 用户安装的 MCP 各自被调用了多少次
- **按 Skill 调用** 分布 —— 用户安装的 Skill 各自被调用了多少次

### 2.3 工具调用统计（**只展示用户自定义安装的**）

> **明确策略：仅展示用户自己安装的 MCP 和 Skill，Claude 内置工具（Bash/Read/Edit 等）和 Anthropic 自带 MCP（Claude_Preview 等）一律过滤。**

#### 用户 MCP 调用
- 数据源：`~/.claude.json` 的 `mcpServers`（含 user 级和 project 级）
- 展示：按 server 聚合调用次数排行（不下钻到具体工具）
- 价值：发现高频 MCP、识别"装了没用"的 MCP

#### 用户 Skill 调用
- 数据源：`~/.claude/skills/` 目录
- 展示：按 skill 名称排行
- 提取方式：`tool_use.name == "Skill"` 时读 `input.skill` 字段

---

## 3. 数据来源与采集

### 3.1 主数据源
**Claude CLI 会话日志**

- **路径**：`~/.claude/projects/<encoded-cwd>/<sessionId>.jsonl`
- **格式**：JSONL，每行一个事件
- **关键事件类型**：
  - `user` —— 用户消息（含 timestamp / cwd / gitBranch / version）
  - `assistant` —— 模型响应（含 model / usage / content）
  - `attachment` —— 附加内容（如 skill_listing）

### 3.2 Assistant 消息核心字段
```json
{
  "type": "assistant",
  "message": {
    "model": "claude-opus-4-7",
    "id": "msg_xxx",
    "usage": {
      "input_tokens": 10,
      "output_tokens": 817,
      "cache_creation_input_tokens": 42582,
      "cache_read_input_tokens": 0
    },
    "content": [
      { "type": "thinking", "thinking": "..." },
      { "type": "text", "text": "..." },
      { "type": "tool_use", "name": "Bash", "input": {...} }
    ]
  },
  "timestamp": "2026-06-03T15:23:03.366Z",
  "sessionId": "...",
  "cwd": "/Users/.../project",
  "gitBranch": "main",
  "version": "2.1.160"
}
```

### 3.3 配置数据源（用于"用户自定义"过滤）
- `~/.claude.json` —— 读取 `mcpServers` 和 `projects[*].mcpServers`
- `~/.claude/skills/` —— 扫描目录得到用户安装的 Skill 名单

### 3.4 数据采集策略
- 监听 `~/.claude/projects/**/*.jsonl` 文件变化（fs.watch / FSEvents）
- 增量解析新增行，避免全量重读
- 按 `message.id` 去重（同一消息可能因流式/重试出现多条记录）
- 本地持久化聚合结果（SQLite / 本地 JSON），加速重启与历史查询

---

## 4. 分类与过滤规则

### 4.1 工具调用分类逻辑
```
tool_use.name 判定：
  1. 在内置工具黑名单中 → 过滤，不展示
  2. 以 "mcp__" 开头：
     - server 在用户 mcpServers 配置中 → 展示为「用户 MCP」
     - 否则 → 过滤（Anthropic 内置 MCP）
  3. == "Skill"：
     - input.skill 在 ~/.claude/skills/ 中 → 展示为「用户 Skill」
     - 否则 → 过滤（bundled skill）
  4. 其他 → 过滤
```

### 4.2 内置工具黑名单（硬编码）
```
Bash, Read, Edit, Write, Glob, Grep, Agent,
TaskCreate, TaskUpdate, TaskList, TaskGet, TaskStop, TaskOutput,
TodoWrite, NotebookEdit, WebFetch, WebSearch,
ExitPlanMode, EnterPlanMode, Skill, ToolSearch, AskUserQuestion,
EnterWorktree, ExitWorktree, ScheduleWakeup,
CronCreate, CronDelete, CronList
```

### 4.3 花费计算

#### 价格数据源
- **唯一价格源**：LiteLLM 官方维护的开源价格表
  - URL：`https://raw.githubusercontent.com/BerriAI/litellm/main/model_prices_and_context_window.json`
  - 覆盖：Anthropic / OpenAI / Google / 以及主流第三方模型（含 GLM、DeepSeek 等）
  - 字段：`input_cost_per_token` / `output_cost_per_token` / `cache_creation_input_token_cost` / `cache_read_input_token_cost`
- **不提供**用户自定义价格表配置入口，避免维护成本与配置错误

#### 价格表分发策略
- 应用打包时内置一份 LiteLLM 价格表快照（保证离线可用）
- 启动时尝试拉取最新版本（失败则使用内置快照）
- 每 24 小时后台自动刷新一次

#### 计算公式
```
cost = input_tokens     × price.input_cost_per_token
     + output_tokens    × price.output_cost_per_token
     + cache_creation   × price.cache_creation_input_token_cost
     + cache_read       × price.cache_read_input_token_cost
```

#### 模型匹配规则
- 用 `message.model` 字段精确匹配 LiteLLM 表的 key
- 匹配不到的模型：UI 标记为「未知模型」，不计入花费，但 token 数仍统计
- 不做模糊匹配 / 别名兜底，避免错算

#### 估算性质说明
- 明确告知用户：花费为「按官方公开价格估算」
- Pro/Max 订阅用户实际为包月固定支出，仪表盘展示的金额可理解为「等效消费价值」
- UI 上始终带 "估算 (est.)" 字样，避免误读为账单

---

## 5. 数据精度说明

| 指标 | 精度 |
|------|------|
| 会话数 | ✅ 精确（sessionId 去重） |
| 消息数 | ✅ 精确（message.id 去重） |
| Token 用量 | ✅ 精确（来自 API 返回的 usage） |
| 用户 MCP 调用次数 | ✅ 精确（命名约定 + 配置白名单） |
| 用户 Skill 调用次数 | ✅ 精确（input.skill + 目录白名单） |
| 模型分布 | ✅ 精确 |
| **花费（USD）** | ✅ 精确（精确 Token 数 × LiteLLM 官方价格；订阅用户为「等效消费价值」） |

---

## 6. 技术方案

### 6.1 技术栈决策：Tauri + React（已定稿）

**最终选型：Tauri + React 前端**

#### 候选对比
| 方案 | 安装包 | 常驻内存 | 跨平台 | 复用现有 HTML | 结论 |
|------|--------|---------|--------|--------------|------|
| **Tauri** ✅ | ~3–10MB | ~30–80MB | ✅ | ✅ 直接用 | **选中** |
| Swift + SwiftUI | ~5–15MB | ~20–50MB | ❌ 仅 macOS | ❌ 需重写 | 排除（不跨平台） |
| Electron | ~80–150MB | ~100–250MB | ✅ | ✅ 直接用 | 排除（太重） |

#### 决策理由（对齐需求约束）
1. **未来可能跨平台** → 排除仅支持 macOS 的 Swift
2. **在意常驻内存，越轻越好** → 排除 Electron（每个 app 打包整个 Chromium，100MB+）；Tauri 复用系统 WebView（macOS 为 WKWebView），体积与内存接近原生
3. **UI 需要滚动 / hover / 点击 / 图表等丰富交互** → Tauri 的 UI 层即系统 WebView，React 生态的图表库（Recharts / ECharts / Chart.js）可直接使用，现有 `dashboard.html` 的样式与交互可迁移复用
4. **开发体验** → UI 用熟悉的 React；仅文件读取与日志监听等少量后端逻辑用 Rust（量小、有现成模板）

#### 前端技术细节
- **框架**：React + TypeScript
- **构建**：Vite（Tauri 默认集成）
- **图表**：Recharts 或 ECharts（按模型 / MCP / Skill 的分布图、趋势图）
- **样式**：可沿用 `dashboard.html` 既有设计，迁移为 React 组件

#### 分工
- **前端（React + TS）**：仪表盘 UI、图表、交互、菜单栏弹窗
- **后端（Rust）**：JSONL 增量解析、FS 文件监听、配置加载、LiteLLM 价格表拉取、聚合计算
- **桥接**：Tauri command / event 在前后端间传递聚合结果

### 6.2 架构概览
```
┌─────────────────────────────────────────┐
│        macOS 菜单栏 UI（壳）           │
├─────────────────────────────────────────┤
│  仪表盘视图层（图表 / 列表 / 排行）    │
├─────────────────────────────────────────┤
│  聚合层（按时间 / 模型 / MCP / Skill）  │
├─────────────────────────────────────────┤
│  内存模型 + 文件指纹缓存（轻量）        │
├─────────────────────────────────────────┤
│  采集层（FS Watcher + JSONL 增量解析）  │
├─────────────────────────────────────────┤
│  配置加载（mcpServers / skills 白名单） │
└─────────────────────────────────────────┘
            ↑ 读取
   ~/.claude/projects/**/*.jsonl
   ~/.claude.json
   ~/.claude/skills/
```

### 6.3 用户安装方式

按技术栈不同，分发与安装方式如下：

| 技术栈 | 产物 | 安装方式 |
|--------|------|---------|
| **Swift + SwiftUI** | `.app` / `.dmg` | 拖入 Applications；或 `brew install --cask tokenscope`（提交到 Homebrew Cask） |
| **Tauri** | `.dmg` / `.app` | 拖入 Applications；或 Homebrew Cask |
| **Electron** | `.dmg` / `.app` | 拖入 Applications；或 Homebrew Cask |

#### 推荐分发渠道（优先级）
1. **Homebrew Cask**（首选）—— 开发者用户习惯 `brew install`，一行命令安装与升级
2. **GitHub Releases**—— 直接下载 `.dmg`，附自动更新（Sparkle / Tauri Updater）
3. **直接构建**—— 开源仓库，开发者可自行 `clone + build`

#### 关键安装注意点
- **代码签名 + 公证（Notarization）**：未签名应用首次打开会被 Gatekeeper 拦截，需 Apple Developer 账号（$99/年）签名公证，否则用户需手动「右键打开」
- **磁盘访问权限**：应用需读取 `~/.claude/` 目录，沙盒化版本需声明对应权限；非沙盒（非 App Store）版本无需特殊授权
- **开机自启**：通过 `ServiceManagement` framework（Swift）或对应插件注册 Login Item，设置中可开关
- **不上架 Mac App Store**（v1）：App Store 沙盒对读取 `~/.claude/` 任意路径限制较多，且审核周期长；优先走 Homebrew / 直接下载

### 6.4 代码签名与公证（Code Signing & Notarization）

为让用户"双击直接打开、无 Gatekeeper 拦截"，并证明发布者身份，需对 macOS 产物做 **Developer ID 签名 + Apple 公证**。

#### 签名层级
| 层级 | 签名方式 | 用户体验 | 成本 |
|------|---------|---------|------|
| 未签名 / Ad-hoc | `codesign -s -` | 首次打开报"无法验证开发者"，需右键→打开 | 免费 |
| 自签名证书 | 自建证书 | 仍报警告（系统不信任自建根） | 免费但**对外无意义** |
| **Developer ID**（正解） | Apple 颁发的 `Developer ID Application` 证书 | 双击直开，Gatekeeper 放行 | **$99/年** |

> macOS 上唯一被系统信任、能"证明开发者身份"的方式，是加入 Apple Developer Program，用 Apple 签发的 Developer ID 证书签名。自签名证书系统不认，等同未签名。

#### 正规流程（签名 → 公证 → 钉票）
现代 macOS（10.15+）仅签名不够，**必须公证**：上传 App 给 Apple 自动扫描，通过后取回票据再"钉"回产物。
```
codesign（Developer ID + Hardened Runtime + 时间戳）
   ↓
打包 .dmg / .zip
   ↓
notarytool submit（上传 Apple，等待 Approved）
   ↓
stapler staple（公证票据钉入 .dmg/.app）
```

#### Tauri 集成
Tauri 原生支持，配好环境变量后 `tauri build` 自动完成签名+公证：
- `tauri.conf.json` → `bundle.macOS`：`hardenedRuntime: true`（公证强制要求）、`signingIdentity`（默认 `-` ad-hoc，被环境变量覆盖）
- 环境变量优先级：`APPLE_SIGNING_IDENTITY` > 配置；未设证书时自动退化为 ad-hoc/未签名，不阻断本地构建

#### CI 自动签名（GitHub Actions）
`release.yml` 的 `tauri-action` 已预置以下 Secret 占位，**未设置时照常出未签名包**，配齐后打 tag 即自动签名+公证：

| Secret | 内容 |
|--------|------|
| `APPLE_CERTIFICATE` | Developer ID `.p12` 的 base64 |
| `APPLE_CERTIFICATE_PASSWORD` | 导出 `.p12` 时设置的密码 |
| `APPLE_SIGNING_IDENTITY` | `Developer ID Application: Name (TEAMID)` |
| `APPLE_ID` | Apple ID 邮箱 |
| `APPLE_PASSWORD` | App 专用密码（appleid.apple.com 生成，非登录密码） |
| `APPLE_TEAM_ID` | 10 位 Team ID |

#### 渐进策略
- **当前（v1 自用/小范围）**：未签名，文档注明"右键→打开"或 `xattr -dr com.apple.quarantine Tokenscope.app`
- **公开分发（Homebrew Cask / 陌生用户下载）**：上 Developer ID（$99/年），填齐 Secret，签名管线一劳永逸

---

## 7. 非功能需求

- **性能**：菜单栏常驻内存 < 100MB，CPU 空闲时 < 1%
- **隐私**：所有数据本地处理，不上传任何日志或统计信息
- **响应**：日志写入后 5 秒内反映到仪表盘
- **稳定性**：日志解析容错（坏行跳过，不崩溃）
- **启动**：开机自启可选

---

## 8. 范围与边界

### 8.1 v1.0 范围（MVP）
- ✅ 菜单栏图标 + 今日用量速览
- ✅ 详细仪表盘（今日/本周/本月切换）
- ✅ Token 用量、估算花费、按模型分布
- ✅ 用户 MCP / Skill 调用统计

### 8.2 不在 v1.0 范围
- ❌ 跨设备同步
- ❌ 团队/多用户聚合
- ❌ Windows / Linux 支持
- ❌ Web 端
- ❌ 修改 Claude CLI 配置（只读）

### 8.3 后续可能扩展
- 月度报告导出（PDF / Markdown）
- 预算预警（接近设定金额时通知）
- 跨平台版本（Tauri 改造）
- 与其他 AI CLI 工具集成（Cursor、Codex 等）

---

## 9. 关键决策记录

1. **数据采集方式**：直接解析 JSONL 日志，不通过 hook 或代理 —— 零侵入、零配置
2. **MCP/Skill 过滤策略**：仅展示用户自定义安装的，过滤所有内置工具和 Anthropic 自带 MCP —— 聚焦真正的"用户行为"，不被高频内置工具淹没
3. **花费定位**：标注为"估算"，不承诺等同账单 —— 避免与订阅制实际支出混淆
