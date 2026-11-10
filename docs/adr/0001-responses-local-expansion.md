# HTTP Responses 续接一律本地展开，不依赖上游服务端会话

状态：accepted（2026-11-10）

vm2api 的 GPT 账号池中每个 ChatGPT 账号都会因 5h 额度、冷却、维护而常态轮换，而 Responses 的 `previous_response_id`（服务端续接）把对话锁死在创建该响应的那一个账号上：调度到别的账号时上游报 `Invalid previous_response_id`，原账号不可用时网关只能 409 `response_not_portable`，且繁忙的原账号无法换号。我们决定在 HTTP `/v1/responses` 上对带 `previous_response_id` 的请求一律在网关本地展开为全量输入（进程级回放缓存，按 API key 隔离，复用 WS 路径已验证的机制），该字段永不出网关——这与 WS 路径自第一天的行为一致，代价是上游请求体随轮次增大，而这正是 Codex CLI 直连的原生工作方式（store:false 全量重放），并非新增负担。

被否决的替代方案：仅在没有粘性绑定时展开的混合模式——保留了两条代码路径与 409 失败面，省下的上游流量只惠及"绑定恰好命中"的客户端。回退方式：`KIN_CODEX_PREVIOUS_RESPONSE_EXPANSION=0` 恢复旧的账号钉定续接。

后果：进程重启后回放缓存丢失，进行中的续接对话会收到 `400 previous_response_not_found`，客户端重发完整上下文即可恢复（Codex 系客户端本地都保有全量历史）；`pickCodexCandidates` 里的 `continuesResponse` / `response_not_portable` 逻辑仅作为关闭开关时的回退路径保留。
