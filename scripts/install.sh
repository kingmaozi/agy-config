#!/usr/bin/env bash
set -euo pipefail
export LC_ALL=en_US.UTF-8 LANG=en_US.UTF-8

INSTALL_ALL_SKILLS=false
for arg in "$@"; do
  case "$arg" in
    --all-skills) INSTALL_ALL_SKILLS=true ;;
    *) echo "未知参数: $arg (支持: --all-skills)" >&2; exit 1 ;;
  esac
done

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
STAMP="$(date +%Y%m%d-%H%M%S)"
BACKUP_DIR="${HOME}/.gemini/backups/agy-config-${STAMP}"

echo "==> [1/6] 创建安全备份目录: ${BACKUP_DIR}"
mkdir -p "${BACKUP_DIR}"

backup_if_exists() {
  local target="$1"
  local label="$2"
  if [ -e "$target" ] || [ -L "$target" ]; then
    mkdir -p "${BACKUP_DIR}/${label}"
    cp -a "$target" "${BACKUP_DIR}/${label}/" 2>/dev/null || true
  fi
}

# 根据本机实际存在的二进制/插件目录过滤 MCP 配置，确保外部用户(如无私有仓权限)零报错启动
render_smart_mcp() {
  local template_file="$1"
  local t3_dir="${2:-}"
  python3 - "$template_file" "$HOME" "$t3_dir" <<'PY'
import json, pathlib, sys
tpl_path, home, t3_dir = sys.argv[1], sys.argv[2], sys.argv[3]
raw = pathlib.Path(tpl_path).read_text().replace("__HOME__", home)
if t3_dir:
    raw = raw.replace("__T3_AGY_DIR__", t3_dir)
cfg = json.loads(raw)
servers = cfg.get("mcpServers", {})
filtered = {}
skipped = []
for name, spec in servers.items():
    if "url" in spec:
        filtered[name] = spec
        continue
    cmd = spec.get("command", "")
    args = spec.get("args", [])
    ok = True
    if cmd.startswith("/") and not pathlib.Path(cmd).exists():
        ok = False
    if args and args[0].startswith("/") and not pathlib.Path(args[0]).exists():
        ok = False
    if name == "codegraph":
        cg_bin = spec.get("env", {}).get("CODEGRAPH_BIN", "")
        if cg_bin and not pathlib.Path(cg_bin).exists():
            ok = False
    if name == "lcu" and not (pathlib.Path(home) / ".local/share/lcu/releases").exists():
        ok = False
    if ok:
        filtered[name] = spec
    else:
        skipped.append(name)
if skipped:
    print(f"    [自适应跳过未安装的本地可选 MCP: {', '.join(skipped)}]", file=sys.stderr)
print(json.dumps({"mcpServers": filtered}, indent=2, ensure_ascii=False))
PY
}

# 1. 还原跨宿主共享技能 (~/.agents/skills，AGY 与 Codex 共读)
echo "==> [2/6] 同步 6 个跨宿主核心 Skills 到 ~/.agents/skills/"
mkdir -p "${HOME}/.agents/skills"
chmod 700 "${HOME}/.agents" "${HOME}/.agents/skills" 2>/dev/null || true
for sk in t3-subagent-routing powercontext-memory agent-reach ponytail ponytail-audit ponytail-review; do
  if [ -d "${REPO_ROOT}/agy/skills/${sk}" ]; then
    backup_if_exists "${HOME}/.agents/skills/${sk}" "agents-skills"
    rm -rf "${HOME}/.agents/skills/${sk}"
    cp -R "${REPO_ROOT}/agy/skills/${sk}" "${HOME}/.agents/skills/${sk}"
  fi
done

# 2. 还原本地 vendor 插件 (rea-anything & lcu-proxy)
echo "==> [3/6] 还原随仓开源插件 (~/plugins/rea-anything 与 lcu 代理桥)"
mkdir -p "${HOME}/plugins"
if [ ! -d "${HOME}/plugins/rea-anything" ]; then
  cp -R "${REPO_ROOT}/vendor/rea-anything" "${HOME}/plugins/rea-anything"
  sed -i.bak "s|__HOME__|${HOME}|g" "${HOME}/plugins/rea-anything/.mcp.json" && rm -f "${HOME}/plugins/rea-anything/.mcp.json.bak"
  chmod +x "${HOME}/plugins/rea-anything/mcp/launch.sh"
  if command -v npm >/dev/null 2>&1; then
    echo "    正在为 rea-anything 安装 npm 依赖..."
    (cd "${HOME}/plugins/rea-anything" && npm ci --silent || npm install --silent)
  else
    echo "    [提示] 未检测到 npm，装好 Node.js 后请执行: cd ~/plugins/rea-anything && npm ci"
  fi
else
  echo "    ~/plugins/rea-anything 已存在，跳过覆盖"
fi

if [ ! -f "${HOME}/.local/share/lcu/proxy/antigravity-cua.mjs" ]; then
  mkdir -p "${HOME}/.local/share/lcu/proxy"
  cp "${REPO_ROOT}/vendor/lcu-proxy/antigravity-cua.mjs" "${HOME}/.local/share/lcu/proxy/antigravity-cua.mjs"
fi

# 3. 还原独立桌面端 Antigravity (~/.gemini)
echo "==> [4/6] 配置 ~/.gemini (桌面端 AGY 规则、Skills 与自适应 MCP)"
mkdir -p "${HOME}/.gemini/config/rules" "${HOME}/.gemini/config/skills" "${HOME}/.gemini/skills" "${HOME}/.gemini/antigravity"
backup_if_exists "${HOME}/.gemini/GEMINI.md" "gemini-root"
backup_if_exists "${HOME}/.gemini/config/rules/AGENTS.md" "gemini-rules"
backup_if_exists "${HOME}/.gemini/config/mcp_config.json" "gemini-mcp"

cp "${REPO_ROOT}/agy/rules/AGENTS.md" "${HOME}/.gemini/config/rules/AGENTS.md"
ln -sfn "${HOME}/.gemini/config/rules/AGENTS.md" "${HOME}/.gemini/GEMINI.md"

for sk in agent-reach powercontext-memory t3-subagent-routing ponytail ponytail-audit ponytail-review; do
  ln -sfn "${HOME}/.agents/skills/${sk}" "${HOME}/.gemini/skills/${sk}"
done

DESKTOP_MCP="${HOME}/.gemini/config/mcp_config.json"
RENDERED_DESKTOP_MCP="$(render_smart_mcp "${REPO_ROOT}/agy/mcp_config.desktop.template.json")"
if [ ! -f "${DESKTOP_MCP}" ]; then
  printf '%s\n' "${RENDERED_DESKTOP_MCP}" > "${DESKTOP_MCP}"
else
  printf '%s\n' "${RENDERED_DESKTOP_MCP}" > "${DESKTOP_MCP}.from-repo"
  echo "    已存在 ${DESKTOP_MCP}，新模板已生成至 ${DESKTOP_MCP}.from-repo 供比对合并"
fi
ln -sfn "${DESKTOP_MCP}" "${HOME}/.gemini/antigravity/mcp_config.json"

# 4. 自动发现并还原 T3 Code 下的 Antigravity 实例配置
echo "==> [5/6] 检测 T3 Code 的 Antigravity 实例目录..."
T3_PROVIDER_BASE="${HOME}/.t3/userdata/providers/antigravity"
shopt -s nullglob
T3_INSTANCES=("${T3_PROVIDER_BASE}"/*)
shopt -u nullglob

if [ "${#T3_INSTANCES[@]}" -eq 0 ]; then
  echo "    [提示] 尚未检测到 ${T3_PROVIDER_BASE}/<hash>。"
  echo "    请先打开一次 T3 Code 并选中 Antigravity 模型初始化目录后，再次运行 bash scripts/install.sh（幂等安全）！"
else
  for T3_AGY_DIR in "${T3_INSTANCES[@]}"; do
    [ -d "${T3_AGY_DIR}" ] || continue
    echo "    -> 正在配置 T3 AGY 实例: ${T3_AGY_DIR}"
    mkdir -p "${T3_AGY_DIR}/config/rules" "${T3_AGY_DIR}/config/skills" "${T3_AGY_DIR}/vendor"

    backup_if_exists "${T3_AGY_DIR}/config/rules/AGENTS.md" "t3-rules"
    backup_if_exists "${T3_AGY_DIR}/config/mcp_config.json" "t3-mcp"

    cp "${REPO_ROOT}/agy/rules/AGENTS.md" "${T3_AGY_DIR}/config/rules/AGENTS.md"
    ln -sfn "${T3_AGY_DIR}/config/rules/AGENTS.md" "${HOME}/.gemini/GEMINI.md"
    ln -sfn "${T3_AGY_DIR}/config/rules/AGENTS.md" "${HOME}/.gemini/config/rules/AGENTS.md"

    for skill_src in "${REPO_ROOT}/agy/skills"/*; do
      [ -d "${skill_src}" ] || continue
      sk_name="$(basename "${skill_src}")"
      rm -rf "${T3_AGY_DIR}/config/skills/${sk_name}"
      cp -R "${skill_src}" "${T3_AGY_DIR}/config/skills/${sk_name}"
    done
    if [ "${INSTALL_ALL_SKILLS}" = true ]; then
      echo "    -> 额外安装 23 个可选扩展 Skills (--all-skills)..."
      for skill_src in "${REPO_ROOT}/agy/optional-skills"/*; do
        [ -d "${skill_src}" ] || continue
        sk_name="$(basename "${skill_src}")"
        rm -rf "${T3_AGY_DIR}/config/skills/${sk_name}"
        cp -R "${skill_src}" "${T3_AGY_DIR}/config/skills/${sk_name}"
      done
    fi

    if [ -f "${T3_AGY_DIR}/config/skills/cdp-inject/SKILL.md" ]; then
      sed -i.bak "s|__T3_AGY_SKILLS_DIR__|${T3_AGY_DIR}/config/skills|g" "${T3_AGY_DIR}/config/skills/cdp-inject/SKILL.md"
      rm -f "${T3_AGY_DIR}/config/skills/cdp-inject/SKILL.md.bak"
    fi

    # 仅当当前账号对 kingmaozi/briking-private 有访问权限时才静默克隆（外部用户自动跳过不报错）
    if [ ! -d "${T3_AGY_DIR}/vendor/briking-private/.git" ]; then
      if command -v gh >/dev/null 2>&1 && gh repo view kingmaozi/briking-private >/dev/null 2>&1; then
        echo "    -> 检测到私有扩展权限，正在克隆 kingmaozi/briking-private..."
        git clone --filter=blob:none https://github.com/kingmaozi/briking-private.git "${T3_AGY_DIR}/vendor/briking-private" >/dev/null 2>&1 || true
      fi
    fi

    # 自适应生成 T3 AGY MCP 配置（未安装的私有/本地插件自动跳过，另存全量参考模板）
    sed -e "s|__HOME__|${HOME}|g" -e "s|__T3_AGY_DIR__|${T3_AGY_DIR}|g" \
      "${REPO_ROOT}/agy/mcp_config.t3.template.json" > "${T3_AGY_DIR}/config/mcp_config.full-reference.json"

    T3_MCP="${T3_AGY_DIR}/config/mcp_config.json"
    RENDERED_MCP="$(render_smart_mcp "${REPO_ROOT}/agy/mcp_config.t3.template.json" "${T3_AGY_DIR}")"
    if [ ! -f "${T3_MCP}" ]; then
      printf '%s\n' "${RENDERED_MCP}" > "${T3_MCP}"
    else
      printf '%s\n' "${RENDERED_MCP}" > "${T3_MCP}.from-repo"
      echo "    已存在 ${T3_MCP}，新模板已生成至 ${T3_MCP}.from-repo 供比对合并"
    fi
  done
fi

echo "==> [6/6] 还原完成！"
echo ""
echo "下一步待办（详见仓库 Issue #1 与 powercontext/README.md）："
echo "  1. 部署完整版 PowerContext + 本地向量服务：bash scripts/setup-powercontext.sh"
echo "  2. 在 Magpie 中建立模型组 (group/262k, group/code, group/code-reivew) 与具名钥匙 powercontext-worker"
echo "  3. 进入任意项目根目录执行: node ~/.agents/skills/powercontext-memory/scripts/pc.mjs ensure"
