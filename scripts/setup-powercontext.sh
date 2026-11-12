#!/usr/bin/env bash
set -euo pipefail
export LC_ALL=en_US.UTF-8 LANG=en_US.UTF-8

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

echo "==> [1/3] 检查 uv 工具链..."
if ! command -v uv >/dev/null 2>&1; then
  echo "未检测到 uv，请先安装: brew install uv (或 curl -LsSf https://astral.sh/uv/install.sh | sh)"
  exit 1
fi

if [ "$(uname -s)" = "Darwin" ] && [ "$(uname -m)" = "arm64" ]; then
  echo "==> [2/3] Apple Silicon 检测通过，部署本机 MLX EmbeddingGemma-2-768 向量服务 (127.0.0.1:8001)..."
  mkdir -p "${HOME}/powercontext-embed-eg2" "${HOME}/Library/LaunchAgents"
  cp "${REPO_ROOT}/powercontext/embed-server/"*.py "${HOME}/powercontext-embed-eg2/"

  if [ ! -x "${HOME}/powercontext-embed-eg2/.venv/bin/python" ]; then
    uv venv "${HOME}/powercontext-embed-eg2/.venv" --python 3.12
  fi
  uv pip install --python "${HOME}/powercontext-embed-eg2/.venv/bin/python" \
    mlx mlx-vlm transformers fastapi uvicorn numpy pydantic

  PLIST="${HOME}/Library/LaunchAgents/com.t3tools.powercontext-embed.plist"
  sed "s|__HOME__|${HOME}|g" "${REPO_ROOT}/powercontext/embed-server/com.t3tools.powercontext-embed.plist.template" > "${PLIST}"
  launchctl unload "${PLIST}" 2>/dev/null || true
  launchctl load -w "${PLIST}"
  echo "    本地向量服务已加载至 LaunchAgent (${PLIST})"
else
  echo "==> [2/3] 非 Apple Silicon Mac，跳过 MLX 向量服务，请在 ~/powercontext/.env 中配置远程 Embedding 接口。"
fi

echo "==> [3/3] 安装 PowerContext 1.5.1 并准备配置文件..."
uv tool install "powercontext[cli,server]==1.5.1"

mkdir -p "${HOME}/powercontext"
chmod 700 "${HOME}/powercontext"
if [ ! -f "${HOME}/powercontext/.env" ]; then
  cp "${REPO_ROOT}/powercontext/.env.template" "${HOME}/powercontext/.env"
  chmod 600 "${HOME}/powercontext/.env"
  echo "    已生成 ${HOME}/powercontext/.env (权限 0600)"
else
  cp "${REPO_ROOT}/powercontext/.env.template" "${HOME}/powercontext/.env.from-repo"
  chmod 600 "${HOME}/powercontext/.env.from-repo"
  echo "    ${HOME}/powercontext/.env 已存在，参考模板已写入 .env.from-repo"
fi

echo ""
echo "=== 仅剩最后 2 步手动填钥匙即可启动 ==="
echo "1. 打开 Magpie -> 新建具名网关钥匙「powercontext-worker」，填入 ~/powercontext/.env 的 OPENAI_API_KEY"
echo "2. 执行启动命令:"
echo "   powercontext service install --env-file ~/powercontext/.env"
echo "   curl -sS http://127.0.0.1:17429/health"
