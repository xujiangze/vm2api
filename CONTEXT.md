# vm2api

VM-fidelity subscription-to-API gateway: turns Claude / ChatGPT subscription slots hosted on VMs into OpenAI- / Anthropic-compatible API endpoints behind an account pool.

## Language

### Responses 续接

**回放缓存 (Replay Store)**:
按 `resp_xxx` id 存储该响应的 input/output 快照、供本地展开的存储。生命周期分两种：**连接级**（WS 路径，随连接销毁）与**进程级**（HTTP 路径，随控制平面进程销毁）。
_Avoid_: 响应缓存、会话存储

**本地展开 (Local Expansion)**:
网关把请求中的 `previous_response_id` 还原为全量输入（快照 input + 快照 output + 本轮新输入）并删除该字段、不再依赖上游服务端会话状态的动作。
_Avoid_: 上下文重放、展开转发
