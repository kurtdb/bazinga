#!/usr/bin/env bash
# Optional: prepare a local model for Bazinga (macOS, Apple Silicon recommended).
#   bash scripts/setup-local-models.sh [model]        e.g. qwen3:8b
# Installs Ollama (via Homebrew) if missing, starts it, and downloads the model.
# Then in Bazinga: Settings -> "+ Local model (Ollama)" adds a "Claude (local)" agent, and
# "Use a local model (ollama run)" points the AI review at it.
set -euo pipefail
MODEL="${1:-qwen3:8b}"

if ! command -v ollama >/dev/null 2>&1; then
  if command -v brew >/dev/null 2>&1; then
    echo "Installing Ollama with Homebrew..."
    brew install ollama
  else
    echo "Ollama is not installed. Download it from https://ollama.com/download and run this script again." >&2
    exit 1
  fi
fi

if ! curl -fsS http://localhost:11434/api/version >/dev/null 2>&1; then
  echo "Starting the Ollama server (32k context, flash attention, q8 KV cache)..."
  (OLLAMA_CONTEXT_LENGTH=32768 OLLAMA_FLASH_ATTENTION=1 OLLAMA_KV_CACHE_TYPE=q8_0 nohup ollama serve >"${TMPDIR:-/tmp}/ollama.log" 2>&1 &)
  for _ in 1 2 3 4 5 6 7 8 9 10; do
    curl -fsS http://localhost:11434/api/version >/dev/null 2>&1 && break
    sleep 1
  done
fi

echo "Downloading $MODEL (this can be several GB)..."
ollama pull "$MODEL"

cat <<MSG

Done. Notes:
- Claude Code needs a context window of 32k tokens or more. This script started the server with 32k; if you use the
  Ollama menu-bar app instead, set the context length in its settings.
- Pick a model that supports tool calling and fits your memory. Small local models are noticeably weaker than Claude at
  multi-step edits, so use them for small tasks and for reviews, and review the result carefully.
- To check by hand:  ANTHROPIC_BASE_URL=http://localhost:11434 ANTHROPIC_AUTH_TOKEN=ollama ANTHROPIC_API_KEY="" claude --model $MODEL
MSG
