# AGENTS.md

vm2api：VM-fidelity subscription-to-API 网关（Claude / ChatGPT 订阅槽位 → OpenAI / Anthropic 兼容 API）。单进程 Node 控制面（`src/server.mjs`），集群节点只承载槽位容器。

## 分支策略（重要）

本仓库是 dofastted/vm2api 的**二开 fork**（`xujiangze/vm2api`）：

- **`main`**：上游同步分支，保持纯净，不放私有提交，定期与上游同步。
- **`xjz`**：**专用二开分支，唯一发布源**。所有私有改动提交到这里，并推送到 `origin/xjz`。会定期 merge `main` 同步上游变更。

任何私有改动必须同时登记到 `docs/二开版本/私有发布日志.md`（含动机、改动文件、与上游同步时的注意点），发布流程见 `docs/二开版本/私有发布规范.md`，线上升级步骤见 `docs/二开版本/升级手册.md`。私有镜像发布在 `ghcr.io/xujiangze/vm2api`，tag 格式 `xjz-{日期}`（如 `xjz-20261112`，不带 `v` 前缀，避免触发上游 release workflow）。

## 开发速览

- 测试：`npm run test:unit`（需 Node ≥ 24：`export PATH="/Users/dc/.nvm/versions/node/v24.15.0/bin:$PATH"`；本机环境 `kernel-install-writer-locks.test.mjs` 会挂起，属环境问题可跳过；其余 infra 类失败需与干净 `main` 对比确认是否环境性）
- 格式：`npx biome format --write <files>`
- 代码全部 ESM（`.mjs`），协议处理在 `src/lib/protocol/`，池调度在 `src/lib/pool/`
- 领域术语见 `CONTEXT.md`，架构决策见 `docs/adr/`
