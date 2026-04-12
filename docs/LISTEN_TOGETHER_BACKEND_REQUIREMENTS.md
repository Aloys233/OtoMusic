# OtoMusic 一起听后端需求（Go 版）

## 1. 文档目标

本文档定义 OtoMusic 「一起听」功能的后端需求，作为 Go 服务实现的基线规范，覆盖：

- 业务范围与边界
- 功能需求（MVP 与后续阶段）
- 接口与实时事件协议
- 数据模型与状态机
- 非功能需求（性能、可用性、安全）
- 开发里程碑与验收标准

---

## 2. 范围定义

### 2.1 MVP 范围（第一阶段，必须实现）

- 支持创建房间、加入房间、离开房间、解散房间
- 支持房间内播放状态实时同步（播放/暂停/拖动/切歌）
- 支持断线重连后的状态恢复
- 支持基础权限模型（房主可控或全员可控）
- 只支持「同服一起听」：
  - 房间内成员需连接同一音乐服务器（同一个 `serverId`）
  - 不处理跨服务器歌曲映射

### 2.2 非 MVP（第二阶段及以后）

- 跨服务器一起听（曲目映射：ISRC 或元数据匹配）
- 房间内投票切歌/点歌队列
- 历史房间、邀请链接有效期管理
- 分布式多实例扩展与跨节点广播

---

## 3. 角色与术语

- `房主(Host)`：房间创建者，默认具备管理权限
- `成员(Member)`：加入房间的普通用户
- `房间(Room)`：一起听会话容器
- `房间状态(Room State)`：当前曲目、播放状态、进度锚点、版本号等
- `修订号(Revision)`：房间状态单调递增版本，用于乱序与幂等控制
- `锚点时间(AnchorTimeMs)`：服务端记录状态产生时刻（Unix ms）

---

## 4. 业务规则

### 4.1 房间规则

- 房间由唯一 `roomCode` 标识（短码，用于分享）
- 同一时刻一个用户只能活跃在一个房间（MVP 约束，简化状态）
- 房间无人在线超过 N 分钟后自动回收（建议 N=30）

### 4.2 同步规则

- 所有控制命令必须先到服务端再广播，不允许点对点直连控制
- 服务端是房间状态唯一事实来源（source of truth）
- 每次状态变更必须生成新 `revision`
- 客户端仅接受 `revision` 更大的事件

### 4.3 权限规则

- 模式 A：仅房主可控（成员只读）
- 模式 B：全员可控
- 房主可在运行时切换模式（切换也视为状态变更事件）

---

## 5. 功能需求（详细）

### 5.1 房间生命周期

- 创建房间：
  - 输入：用户身份、目标音乐服务器标识 `serverId`
  - 输出：`roomId`、`roomCode`、`joinToken`、初始房间状态
- 加入房间：
  - 校验房间是否存在、是否可加入、`serverId` 是否一致（MVP）
  - 返回当前 `Room State Snapshot`
- 离开房间：
  - 成员离开后广播成员变化事件
  - 房主离开可配置为：移交房主或直接解散（MVP 建议解散）
- 解散房间：
  - 仅房主可执行
  - 广播房间关闭事件，客户端退出同步页

### 5.2 播放控制同步

- 需要同步的动作：
  - `PLAY`
  - `PAUSE`
  - `SEEK`
  - `SET_TRACK`（含 track key）
  - `NEXT` / `PREV`（可映射为服务端计算后的 `SET_TRACK`）
- 每个动作由服务端写入统一事件流并广播：
  - `eventId`
  - `roomId`
  - `revision`
  - `serverTimeMs`
  - `actorUserId`
  - `payload`

### 5.3 状态恢复与重连

- 客户端 WS 断线重连后：
  - 先拉取最新快照 `GET /rooms/{roomId}/state`
  - 再订阅 WS 增量事件
- 服务端需提供心跳机制：
  - 服务端定时 `PING`
  - 客户端 `PONG`
  - 超时判定离线并广播成员状态

### 5.4 时间对齐

- 房间状态必须包含：
  - `positionMs`（状态写入时播放位置）
  - `anchorTimeMs`（服务端时间）
  - `isPlaying`
- 客户端收到状态后按以下逻辑计算目标位置：
  - 若 `isPlaying=true`：`target = positionMs + (nowServerAligned - anchorTimeMs)`
  - 若 `isPlaying=false`：`target = positionMs`
- 客户端偏差阈值建议：
  - `abs(local - target) > 200ms` 执行 seek 校正

---

## 6. API 需求（HTTP + WebSocket）

### 6.1 HTTP 接口（MVP）

1. `POST /api/v1/rooms`
   - 描述：创建房间
   - 请求：`{ serverId, controlMode }`
   - 响应：`{ roomId, roomCode, token, state }`

2. `POST /api/v1/rooms/join`
   - 描述：加入房间
   - 请求：`{ roomCode, serverId }`
   - 响应：`{ roomId, token, state, member }`

3. `POST /api/v1/rooms/{roomId}/leave`
   - 描述：离开房间

4. `POST /api/v1/rooms/{roomId}/close`
   - 描述：解散房间（仅房主）

5. `GET /api/v1/rooms/{roomId}/state`
   - 描述：获取当前快照（重连恢复）

6. `POST /api/v1/rooms/{roomId}/commands`
   - 描述：提交控制命令（play/pause/seek/set_track）
   - 请求：`{ type, payload, clientCommandId }`
   - 响应：`{ accepted, revision, eventId }`

### 6.2 WebSocket 通道（MVP）

- 连接：`GET /api/v1/ws?token=...`
- 服务端下行事件：
  - `room.snapshot`
  - `room.member_joined`
  - `room.member_left`
  - `room.state_changed`
  - `room.closed`
  - `sys.ping`
- 客户端上行事件：
  - `sys.pong`
  - `room.ack`（可选，用于诊断）

---

## 7. 数据模型需求

### 7.1 Room

- `id` (string/uuid)
- `code` (string, unique)
- `hostUserId` (string)
- `serverId` (string)
- `controlMode` (`host_only` | `everyone`)
- `status` (`active` | `closed`)
- `createdAt` / `updatedAt`

### 7.2 RoomMember

- `roomId`
- `userId`
- `role` (`host` | `member`)
- `online` (bool)
- `joinedAt`
- `lastSeenAt`

### 7.3 RoomState

- `roomId`
- `revision` (int64)
- `trackKey` (string)
- `isPlaying` (bool)
- `positionMs` (int64)
- `anchorTimeMs` (int64)
- `volume` (int, optional)
- `updatedBy`
- `updatedAt`

### 7.4 RoomEvent（建议）

- `eventId` (string/uuid)
- `roomId`
- `revision`
- `eventType`
- `payload` (json)
- `actorUserId`
- `createdAt`

---

## 8. 技术实现要求（Go）

### 8.1 推荐技术选型

- Go: `1.23+`（与团队标准一致即可）
- Web 框架：`gin` / `echo` / `fiber`（三选一）
- WebSocket：`gorilla/websocket` 或框架原生支持
- 存储：
  - MVP：内存 + 定时快照（允许重启丢失）
  - 生产：Redis（房间态）+ MySQL/PostgreSQL（持久数据）
- 日志：`zap` / `zerolog`
- 配置：环境变量 + `yaml`（可选）

### 8.2 服务内模块划分

- `api`：HTTP/WS 路由与请求校验
- `service`：房间管理、命令处理、权限校验
- `sync`：广播、连接管理、心跳
- `store`：Room/State/Event 抽象存储接口
- `auth`：token 签发与校验

### 8.3 核心并发要求

- 同一 `roomId` 的命令处理必须串行化，避免 revision 冲突
- 跨房间可并行
- 广播与命令入队解耦，避免慢连接阻塞主流程

---

## 9. 非功能需求

### 9.1 性能指标（MVP 目标）

- 单房间实时广播延迟（P95）：< 150ms（同地域）
- 命令处理耗时（P95）：< 50ms（不含客户端播放执行）
- 单实例支撑：>= 1,000 并发 WS 连接（基础目标）

### 9.2 可用性

- 服务重启不应导致进程崩溃循环
- WS 异常断开自动清理连接与成员在线态
- 提供 `/healthz` 与 `/readyz`

### 9.3 安全

- 所有房间写操作需要身份认证
- 命令接口需进行房间权限校验
- 基础限流（IP + 用户维度）
- 输入校验与长度限制，防止异常 payload

### 9.4 可观测性

- 关键日志字段：`roomId`, `userId`, `commandType`, `revision`, `latencyMs`
- 指标：
  - 在线房间数
  - 在线连接数
  - 命令 QPS / 错误率
  - 广播耗时分位数

---

## 10. 错误码建议

- `ROOM_NOT_FOUND`
- `ROOM_CLOSED`
- `ROOM_SERVER_MISMATCH`
- `ROOM_PERMISSION_DENIED`
- `ROOM_MEMBER_LIMIT_EXCEEDED`
- `COMMAND_CONFLICT`
- `INVALID_COMMAND_PAYLOAD`
- `UNAUTHORIZED`

---

## 11. 测试与验收

### 11.1 必要测试

- 单元测试：
  - 权限判断
  - revision 递增与乱序丢弃
  - 时间对齐计算
- 集成测试：
  - 创建/加入/离开/解散
  - 双端同步（play/pause/seek/set_track）
  - 断线重连恢复
- 稳定性测试：
  - 连接抖动
  - 慢连接广播

### 11.2 MVP 验收标准

- 两个客户端在同一 `serverId` 下可稳定一起听
- 常见操作（播放、暂停、拖动、切歌）两端状态一致
- 断线 30 秒内重连后可恢复到房间当前状态
- 非授权成员无法执行受限命令

---

## 12. 开发里程碑建议

1. `M1 - 基础设施`
   - Go 服务骨架、配置、日志、健康检查、CI

2. `M2 - 房间域模型`
   - Room/Member/State 内存实现、HTTP 基础接口

3. `M3 - WS 同步链路`
   - 连接管理、心跳、状态广播、revision 机制

4. `M4 - 权限与稳定性`
   - control mode、限流、异常处理、重连恢复

5. `M5 - 灰度上线`
   - 联调客户端、监控指标、压测和问题修复

---

## 13. 第二阶段（跨服）预留要求

- 将 `trackKey` 从「本地 trackId」升级为可跨服标识：
  - 优先：ISRC
  - 兜底：`normalized(title + artists + duration)`
- 状态增加匹配结果字段：
  - `matchStatus`: `exact` | `fallback` | `unavailable`
- 客户端在 `unavailable` 时需要降级提示，不阻塞房间同步时钟

---

## 14. 建议的交付物清单

- API 文档（OpenAPI）
- WS 事件协议文档（字段级）
- 错误码文档
- 部署文档（环境变量、端口、探针、日志）
- 压测报告（并发连接与广播延迟）
