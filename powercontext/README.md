# PowerContext 完整版部署与防坑指南（T3 + AGY + Codex + Magpie 终极形态）

这份文档还原的是主力机经过实机调优验证后的 **完整版 PowerContext 1.5.1 记忆架构**——不是只能给单一 CLI 用的半成品，而是 **Codex、Pi、T3 子代理、原生 Antigravity（AGY）全部共用同一套「按项目严格隔离、零串台、防膨胀、防死循环、带踩坑经验库」** 的完整体系。

---

## 一、整体架构（为什么这套稳、不串台、不膨胀）

```text
┌───────────────────┐   ┌───────────────────┐
│  Codex CLI / App  │   │  T3 研发子代理群   │  (Explore / Lin / Rigel / Review)
└─────────┬─────────┘   └─────────┬─────────┘
          │  全部走本机网关          │
          ▼                       ▼
┌───────────────────────────────────────────┐
│        Magpie 本地网关 (127.0.0.1:3425)    │
│  插件: @magpie-community/gateway-powercontext
│  Scope 设置: 「由服务端解析」(按 cwd sha256) │
└─────────────────────┬─────────────────────┘
                      │ 自动召回 + 空闲归档对话
                      ▼
┌───────────────────────────────────────────┐      ┌──────────────────────────────────┐
│     PowerContext 服务 (127.0.0.1:17429)    │◄────►│ 本地 MLX 向量服务 (127.0.0.1:8001) │
│  • 数据库: SQLite (按项目独立 Scope 池)      │      │ EmbeddingGemma-2-768 (免费毫秒级) │
│  • 提炼模型: group/262k (具名Key防自噬死循环) │      └──────────────────────────────────┘
│  • 提炼策略: coding (只留铁律/决策/偏好)     │
│  • 面板: http://127.0.0.1:17429/dashboard │
└─────────────────────▲─────────────────────┘
                      │ MCP (/mcp/) + pc.mjs 脚本直连
                      │ (同样按 sha256(path.resolve(root)) 对齐同一项目池!)
┌─────────────────────┴─────────────────────┐
│       原生 Antigravity (AGY 主窗口)        │
└───────────────────────────────────────────┘
```

### 核心解决的 4 个实战大坑（已全部固化进本目录模板）
1. **切断“后台自己吃自己”的死循环**：PowerContext 后台整理记忆也是调 Magpie `127.0.0.1:3425/v1` 的 `group/262k`。如果用匿名钥匙，Magpie 会把整理请求又当成新聊天抓进 `Default` 池无限套娃！**必须在 Magpie 创建一个具名网关钥匙（如 `powercontext-worker`）填进 PowerContext `.env` 的 `OPENAI_API_KEY`**，Magpie 识别具名钥匙会自动跳过抓取。
2. **解除超长代码对话卡死（`24,000` → `180,000` tokens）**：PowerContext 默认把单轮 `Memory` 提炼上限锁在 `24,000` token，一旦开启「保存完整对话」，读代码/跑测试的长对话会报 `context_overflow` 堵死整个项目的提炼队列。`.env.template` 已调至 `180000` token + `SOURCE_WINDOW_LIMIT=1` + `low` 推理档位 + 3 Worker 并发，实测十万字对话 10 秒消化、零报错。
3. **补齐 `Experience`（踩坑经验）断层**：Magpie 自动保存对话只生成 `Memory` 和 `Topic Memory`，**从不自动生成 `Experience`**；且排障对话一旦出现 `token:`/`authorization:` 字样会被防泄密整轮跳过。因此我们配套了 `pc.mjs`（全局）与 `powercontext-record-lesson.mjs`（项目级），在修完隐蔽真坑后一键脱敏沉淀进 `Experience` 并自动审批生效。
4. **关闭 Codex 内置记忆防双份串味**：Codex 自带的 `[memories]` 是跨项目全局大杂烩（每次白塞 9~15 KB 旧项目习惯）。统一关掉 Codex 自带记忆，单轨只用 PowerContext 按项目隔离记忆。

---

## 二、新电脑一步步完整搭建（Apple Silicon Mac）

> 也可以直接运行半自动引导脚本：`bash scripts/setup-powercontext.sh`，它会帮你建好目录、装好本地向量服务并生成 `.env`。

### 第 1 步：启动本机免费 Embedding 向量服务（`127.0.0.1:8001`）

无需购买外部 Embedding API，Apple Silicon 直接本地跑 `EmbeddingGemma-2-768`（768 维单位向量）：

```bash
# 1. 创建目录并复制服务代码
mkdir -p ~/powercontext-embed-eg2
cp powercontext/embed-server/*.py ~/powercontext-embed-eg2/

# 2. 用 uv 创建虚拟环境并安装依赖（首次运行会自动从 HuggingFace 缓存 mlx-community/embeddinggemma-2-8bit）
uv venv ~/powercontext-embed-eg2/.venv --python 3.12
uv pip install --python ~/powercontext-embed-eg2/.venv/bin/python \
  mlx mlx-vlm transformers fastapi uvicorn numpy pydantic

# 3. 安装开机自启 LaunchAgent
sed "s|__HOME__|$HOME|g" powercontext/embed-server/com.t3tools.powercontext-embed.plist.template \
  > ~/Library/LaunchAgents/com.t3tools.powercontext-embed.plist
launchctl unload ~/Library/LaunchAgents/com.t3tools.powercontext-embed.plist 2>/dev/null || true
launchctl load -w ~/Library/LaunchAgents/com.t3tools.powercontext-embed.plist

# 4. 验证健康状态（首次加载模型约需 10~30 秒）
curl -sS http://127.0.0.1:8001/health
# 期望返回: {"status":"ok","model":"EmbeddingGemma-2-768","model_id":"mlx-community/embeddinggemma-2-8bit","dim":768}
```

> **如果新电脑不是 Apple Silicon（如 Linux / Intel）**：跳过本步，直接把第 2 步 `.env` 里的 `POWERCONTEXT_SERVER_INFERENCE_EMBEDDING_*` 改成你自己的 OpenAI 兼容 Embedding 接口即可。

---

### 第 2 步：安装 PowerContext `1.5.1` 并配置具名防递归钥匙

```bash
# 1. 安装 CLI + 服务端（固定已验证版本 1.5.1）
uv tool install "powercontext[cli,server]==1.5.1"
powercontext --version

# 2. 在 Magpie 桌面端创建一个「具名网关钥匙（Caller Key）」：
#    打开 Magpie -> 网关钥匙 / Caller Keys -> 新建钥匙，名称填: powercontext-worker
#    复制生成的 sk-magpie-key-xxxxxxxx...

# 3. 生成配置文件（权限严格设为 0600）
mkdir -p ~/powercontext && chmod 700 ~/powercontext
cp powercontext/.env.template ~/powercontext/.env
chmod 600 ~/powercontext/.env
# 用编辑器把 ~/powercontext/.env 里的 OPENAI_API_KEY=<REDACTED...> 替换成刚复制的 sk-magpie-key-...

# 4. 确保 Magpie 里已建好 group/262k 模型组（参考 powercontext/magpie-groups.reference.json）

# 5. 注册并启动后台常驻服务
powercontext service install --env-file ~/powercontext/.env
powercontext service status
curl -sS http://127.0.0.1:17429/health
```

> **重要提示**：以后每次手动修改 `~/powercontext/.env` 后，请执行 `powercontext service install --env-file ~/powercontext/.env`（或 `powercontext service restart`），因为 LaunchAgent 会校验 `.env` 的 inode / 修改时间元数据！

---

### 第 3 步：开启 Magpie 的 PowerContext 插件 + 关闭 Codex 自带记忆

1. **Magpie 插件配置**（对照 [`powercontext/magpie-plugins.template.json`](./magpie-plugins.template.json)）：
   - 在 Magpie 插件界面启用 `@magpie-community/gateway-powercontext`：
     - **服务地址**：`http://127.0.0.1:17429`
     - **记忆空间 ID（Scope）**：**必须选 `由服务端解析`**（千万别填死 ID！）
     - **保存完整对话**：`已开启`（`capture: true`）
   - **顺手避坑**：如果你在这台机器上还跑 OCR / 爬虫 / 客服自动跑批程序调 Magpie，务必也给跑批程序单独建一把具名钥匙，避免把成百上千条跑批请求塞进公共 `Default` 池。

2. **关闭 Codex 自带全局记忆**（在 `~/.codex/config.toml` 中确认以下 4 项全为 `false`）：
   ```toml
   [features]
   memories = false
   chronicle = false

   [memories]
   generate_memories = false
   use_memories = false
   ```

---

### 第 4 步：给每个项目绑定独立记忆池（防串台铁律）

PowerContext **不会自动给新文件夹创建独立池**——未绑定的目录第一次发请求会落进公共 `Default` 池。
只要运行过本仓库的 `bash scripts/install.sh`，全局脚本 `~/.agents/skills/powercontext-memory/scripts/pc.mjs` 就已经装好了！

**在新电脑上打开任意项目前，进入该项目根目录跑一行即可永久绑好：**

```bash
cd /path/to/your-project
node ~/.agents/skills/powercontext-memory/scripts/pc.mjs ensure
# 输出示例: PowerContext scope_id=scp_xxxxxxxxxxxxxxxx root=/path/to/your-project
```

- **AGY 主窗口**在项目里开工时，会自动根据全局规则调用：
  ```bash
  node ~/.agents/skills/powercontext-memory/scripts/pc.mjs recall --query "任务关键词"
  ```
- **排障修完真坑后**，沉淀进 `Experience`（立即可被 Magpie 与 AGY 召回）：
  ```bash
  node ~/.agents/skills/powercontext-memory/scripts/pc.mjs experience \
    --cue "报错关键词或触发特征" \
    --symptom "表面现象" \
    --situation "触发场景" \
    --action "验证有效的修复动作" \
    --outcome "实际修复结果" \
    --condition "验收方式" \
    --lesson "可复用避坑结论"
  ```
- 如果你想把绑定与记坑脚本也放进某个业务仓库内部（如 `making` 的做法），直接把 [`powercontext/project-kit/`](./project-kit/) 下的 `scripts/*.mjs` 拷进目标项目的 `scripts/` 目录即可。

---

## 三、验收与日常运维速查

1. **可视化看板**：浏览器打开 `http://127.0.0.1:17429/dashboard/home`，可直观看到每个项目的独立 Scope、`Memory`（精准规则）、`Topic Memory`（专题归档）和 `Experience`（踩坑经验）。
2. **核查某个项目是否真正绑定在独立池（而非落入 `Default`）**：
   ```bash
   cd /path/to/your-project
   WK=$(node -e 'const p=require("path"),c=require("crypto");console.log(c.createHash("sha256").update(p.resolve(process.cwd())).digest("hex"))')
   curl -sS -X POST http://127.0.0.1:17429/v1/scope-bindings/resolve \
     -H 'Content-Type: application/json' \
     -d "{\"allow_default\":false,\"explicit_scope_id\":null,\"binding_keys\":[{\"integration\":\"magpie\",\"kind\":\"workspace\",\"external_id\":\"$WK\"}]}"
   # 必须返回 HTTP 200 且带有该项目专属 scope_id
   ```
3. **如果某天上游模型断网导致某个项目的 `Topic Memory` 触发熔断暂停**：
   ```bash
   powercontext topic-memory retry --scope-id <该项目_scope_id>
   ```
