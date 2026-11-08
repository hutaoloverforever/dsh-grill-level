# PLAN — grill-me 适配版 + dsh-grill-level 控制插件

状态：实现完成，进入安装与实机验收。
基线时间：2026-11-08（Asia/Shanghai）。

---

## 0. 目标与边界

**要交付的两件东西**

1. **交付 A**：grill-me 的 DSH 适配版 skill，装到宿主真实发现的位置，保留 MIT 许可证、来源、commit、取得时间、适配差异。
2. **交付 B**：配套插件 `dsh-grill-level`，五档（关/低/中/高/完全）会话级控制，入口在输入框左下角「＋」下拉菜单**内部**，切换即时生效，可诊断、可卸载。

**明确不做**

- 不改 DSH 核心代码或打包产物（`app.asar`、`dsh-asar-full` 只读不写）。
- 不用 DOM 猴子补丁伪造入口。
- 不把入口挪到别处（不新增常驻按钮、不占输入区）。
- 不把「即时生效」降级为「刷新后生效 / 下一轮生效」。
- 不覆盖上游副本（`grill-work/upstream/` 保持原样）。

---

## 1. 环境基线（实测）

| 项 | 值 | 取证方式 |
| --- | --- | --- |
| DSH 版本 | `0.2.1-rc.5` | `dsh --version` |
| 活动 profile | `desktop` → `<DSH_HOME>/profiles/desktop` | `$env:DSH_PROFILE_DIR` |
| DSH_HOME | `<DSH_HOME>` | `$env:DSH_HOME` |
| 权威包目录 | `<DSH 安装目录>/node_modules/@deepseek-ai/`（~430 个包） | 目录枚举 |
| 本会话 session id | `session-efeb7dda-7c36-4b9e-a7ac-7f24a74d86a4` | `$env:DSH_SESSION_ID` |
| Web GUI | `http://127.0.0.1:55627` | `$env:DSH_WEB_URL` |
| Node | v26.8.1 | `node --version` |

**备份**：安装前已记录 profile `package.json` 与 `cordis.patch.yml` 原样（见 §7 回滚）。上游仓库工作区 `git status --porcelain` 为空。

---

## 2. 关键决策与依据

### D1 「＋」菜单入口走 client 命令贡献，不走 DOM、不走宿主命令目录

**证据**：
- `dsh-client-ui-conversation\lib\client.js` L18960 — `useMenuLauncher((source) => source === "command")`：`+` 按钮和输入行里的 `/` 打开的是**同一个**菜单。
- 同文件 L19239–19254 — `+` 按钮的 `onClick` 只是 `toggleCommandMenu?.(caretSpan())`，由 `inputTriggers` 驱动。
- `dsh-client-ui-commands\lib\client.js` L1385–1444 — `CommandUiRuntime` 向 `inputTriggers` 注册**唯一**的 `/` source，名为 `command`。
- 同文件 L1345–1361 `sectionRows()` — 空查询时菜单排成 Add 段 + Commands 段，**未列入白名单的行按输入顺序追加到 Commands 段末尾**。
- 同文件 L1532–1555 `candidates()` — 宿主命令行与客户端贡献行都会进列表；L1554 `rows.filter(c => req.position === "leading" || c.hint === void 0)`，即**带 `input.hint` 的宿主命令在「＋」菜单里会被过滤掉**。

**推论**：要让五档出现在「＋」菜单里，必须用 `commandUi.register({ ui: { kind: 'popupSelect', ... } })`；用带 `input.hint` 的宿主命令反而会被过滤。已按此实现。

### D2 浏览器行的命令名与宿主命令名必须不同

**证据**：`dsh-client-ui-commands\lib\client.js` L1546 — 贡献名与宿主命令同名时抛 `ui-commands: contribution /<name> collides with a host command`。

**决策**：宿主命令 = `grill-level`（管参数、诊断、写入）；浏览器贡献 = `grill`（只管开 popup）。`grill`/`grill-level` 均未被占用（全库扫描 `commands.register(` 只有 compact/feedback/goal/permission/plan/export 六条）。

### D3 会话状态用 session projection，从 `command/run` 折叠，不自造事件类型

**证据**：
- `dsh-session-projection\lib\index.js` — `register()` 校验 `stateVersion` 为非负整数；`apply` 未变化必须返回同引用（`Object.is` 变更门）；注册是 effect，随 fiber 释放则 key 从快照消失；`stateVersion` 变更会让 checkpoint 行失配、强制全日志 refold。
- `dsh-permission-presets\lib\index.js` L188–201 是同一模式的官方实例（`key:"permissions"`, `stateVersion:2`, `wire:{viewSchema, view}`）。
- 插件开发规范（`cordis-plugin-development/practices.md`）明确：不要 append 新 type 的 session event；per-session 派生状态用 `ctx.sessionProjections` 单元。

**决策**：`key:'grillLevel'`、`stateVersion:1`、`apply` 只认 `event.type === 'command/run' && event.data.name === 'grill-level'`，其余一律返回同引用。状态是会话日志的**纯派生**——重开会话自动恢复，卸载后不留残余。

**代价**：`stateVersion` 一旦上调就要全量 refold，所以定 1 且不动。

### D4 写入路径只有一条：`/grill-level <level>`

客户端 `session.command('/grill-level high')` → host `commands.execute` → append `command/run` → projection 折叠 → 下一次 `systemPrompt.assemble()` 读到新档位。

**证据**：`dsh-commands\lib\index.js` L334–339 —— `execute()` **先** append `command/run` 再调 handler；因此 handler 里读投影拿到的已是新值。这直接决定了降档判定不能读投影当前值，必须用 `known`/`transitions` 记录的旧值（实现见 §3）。

### D5 策略注入用 `systemPrompt.section`，`off` 返回空串

**证据**：
- `dsh-system-prompt\lib\index.js` L356–406 —— `assemble()` **每次**都重新调用 `section.text(context)`；`renderPrompt` 会 `.filter(text => text.length > 0)`。
- `dsh-agent-loop\lib\index.js` L907 —— `preStep()` 里 `await this.loopCtx.systemPrompt.assemble(...)`，**每个 step 都重算**。
- `dsh-agent\lib\index.js` 尾部 `assembleContextFor(agent, signal)` 返回 `{ agent, scope: agent, ... }` —— 所以 `text` 回调能拿到 agent。
- `dsh-pua` L40–42 是同一写法（`order:120`, 返回 `''` 即不注入）。

**决策**：`name:'grill-level:policy'`、`order:130`；`off` 返回 `''`（等于完全不入 prompt）；`full` 额外拼 skill 正文。

### D6 即时生效的三态处理

| 态 | 处理 | 依据 |
| --- | --- | --- |
| 空闲 | 下一次 assemble 就用新档位 | L907 每 step 重算 |
| 等待澄清 | 同空闲；旧访谈流程不再有策略文本支撑 | 同上 |
| 正在生成 + 降档 | `agent.cancel({kind:'user'})` 后 `agent.followup(resumeMessage)` | `dsh-agent\lib\index.js` L26–37 是官方「用户停止」范式；`dsh-agent-loop` L815–821 `cancel()` 清 inbox + abort phase；L800–805 `followup` = `send(input,'next-turn',true)`，且在 abort 后会自动降级为 `next-turn` |
| 正在生成 + 升档 | 不打断，本轮结束后生效 | 打断升档没有收益，且会丢已生成内容 |

**边界（不掩饰）**：已经发出去的那个模型请求，其输入无法被改写。插件做的是中断它、以新档位重新发起。UI 不会声称「那个请求已收到新指令」。

### D7 schema 用纯对象 `.parse`，不引入 zod

**证据**：`dsh-session-projection\lib\index.js` 只用 `def.stateSchema.parse(...)` 与 `def.wire.viewSchema.parse(...)`（L254/L258/L296/L304/L421/L432）。profile 顶层是 zod 3.25.76，`dsh-asar-full` 内是 zod 4.4.3，同时 import 会打架。

**决策**：`{ parse(value) { ... } }`。零依赖，行为等价。

### D8 规则文案逐级累加，不是逐档重写

**原因**：首版把中/高/完全写成「在低档之上……」的引用式，导致 `policySection('medium')` 的文本里**不含**低档规则行。单测 `coverage grows monotonically` 直接抓到（`AssertionError: medium must keep the rule: - 默认直接执行，不要为了澄清而澄清。`）。

**修法**：`RULE_GROUPS` + `groupsThrough(level)`（`RANK[group.level] <= RANK[level]`），渲染时逐组展开。这样「高档包含低档全部规则」是**结构保证**，不是文案巧合。

### D9 完全档的「每轮装载」用既有 section，不额外注册 pre-step 监听

**理由**：`systemPrompt.section` 本身就是每 step 重算的；再加一个 `agent/pre-step` 往 `decision.messages` 里 push 消息，会让同一份技能正文在一轮里出现两次（section + user message），既浪费 token 又可能让模型把它当成用户输入。

**决策**：完全档 = `policySection(state) + fullLoadText(state, skillContent)`，在同一个 section 里返回。「每次装载」由 assemble 频次保证；诊断里 `skill=loaded 4791B` 就是这条的可见证据。

---

## 3. 实现要点

### host 半边（`lib/index.js`，318 行）

- `name = 'grill-level'`，`inject = ['commands','systemPrompt','sessionProjections']`。
- `applyEvent(state, event)` — 纯函数，只认本命令的 `command/run`；同档或非法参数返回**同引用**。
- `apply(ctx)`：
  - `known` / `transitions` / `diagnostics` 三个 `WeakMap`，全部按 session 键。
  - `seed()` 从投影回填 `known`，挂 `session/created`，并遍历已有 session。
  - `session/event` 监听器重建 `before/after` —— **因为 handler 运行时投影已 fold 成新值**，旧值只能从这里拿。
  - `sessionProjections.register({ key:'grillLevel', stateVersion:1, stateSchema, init, apply: applyEvent, wire:{ viewSchema, view } })`。
  - `refreshSkill()` 用 `ctx.get('skills')?.get('grill-me', { scope })`，失败降级并把 `source` 记成 `missing | no-skills-service | error: ...`；`skills/change` 时刷新。
  - `systemPrompt.section({ name, order:130, text })` —— 每次组装写一条诊断，`off` 返回 `''`。
  - `commands.register({ name:'grill-level', input:{ hint }, handler })` —— `status` 走诊断；换档按 §D6 处理降档中断。

### 浏览器半边（`lib/client.js`，118 行）

`window.__ModuleLoader__.load({ id, factory })`，`inject = ['commandUi','sessions']`。只做三件事：读投影、建五行 options、把选中项转成 `live.command('/grill-level <level>')`。不缓存状态、不做乐观更新。

### 测试（20 例，全绿）

- `test/policy.test.mjs`（9 例）：档位表一致性、`normalizeLevel` 边界、`off` 四级空串、每档含自身 label 与版本号、**单调覆盖**、RHYTHM 跨档共享、`fullLoadText` 只在 full 带正文、`resumeText`。
- `test/state.test.mjs`（11 例）：参数解析、换档递增、同档同引用、非法参数同引用、无关事件同引用、纯函数性、多档序列收敛；**外加 4 例 `previousStateFromEvents`**（从日志还原前值、空日志、同档重复不涨版本、无关记录不干扰）——这 4 例是为修一个真实 bug 补的，见 §8 变更记录。

---

## 4. 假设（若被推翻需重新设计）

| # | 假设 | 当前证据强度 | 推翻后果 |
| --- | --- | --- | --- |
| A1 | `systemPrompt.section.text(ctx)` 运行时能拿到 `ctx.agent` | 类型上未声明，但 `assembleContextFor` 实现会传；`dsh-pua` 已在用 | 拿不到 agent 就拿不到 session，策略无法按会话区分 → 必须改用 `systemPrompt.context()` 或在 `agent/created` 里按 agent 注册 section |
| A2 | `commandUi` 是运行时可通过 `ctx.get`/`inject` 取到的 cordis Service | 源码 L1385 `super(ctx,"commandUi")`；它不在 client Service inspect 目录里（目录只列 typert 已知脸） | 取不到就没有「＋」入口 → 需改用 `slots.register('conversation.input.left')`（但那不是「＋」菜单内部，属降级，必须报告） |
| A3 | `session.projections.faceOf(key).getSnapshot()` 在 key 未产生过值时返回 `undefined` 而非抛错 | `dsh-api-session-controller\lib\client.js` L1567 注释原文：「Always defined — absence is an `undefined` snapshot, never a missing face」 | 若抛错，picker 打开即崩 → 需外层 try/catch |
| A4 | `ctx.skills.get('grill-me')` 能取到本插件配套的适配版正文 | 未实测（当前会话能看到 `grill-me`，但来源是 workbuddy 市场版） | 取到的是 workbuddy 版 → 完全档装载的是别人的方法论。缓解：诊断里暴露 `path`；安装后实测核对 |
| A5 | 装到 `~/.dsh/skills/grill-me/` 会以 `user-dsh` / rank 399 进 provider | skills-manager `core.js` L127/L3405 已读 | 若被 workbuddy 同名副本遮蔽（外部 root 无 rank，排序为 NaN 不稳定），需在 skills-manager 里禁用 workbuddy 副本 |

---

## 5. 验收计划（对应需求第八节 A–E）

每条都要有真实命令与原始输出。跑不了的写 `NOT RUN`，测不出的写 `UNKNOWN`。

### A 安装与兼容
- A1 插件出现在 `plugin_manager list_plugins`，`enabled: true`。
- A2 `node --check` 三个源文件；`node --test test/` 16/16。
- A3 skill 在 `~/.dsh/skills/grill-me/`，frontmatter 有 `name` + `description`；`skill` 工具能加载到**新副本**（路径指向 `.dsh`，不是 `.workbuddy`）。
- A4 卸载插件后宿主恢复正常（不再有 `grill-level:policy` section、菜单行消失）。

### B 界面
- B1 「＋」菜单里能看到「Grill me 澄清强度」一行（截图）。
- B2 菜单关闭时无新增常驻控件（对比安装前后截图）。
- B3 选中项 / `status` 输出 / 注入文本三者一致。

### C 档位
- C1 新会话默认 `off`（投影初始值 + `status`）。
- C2 两个会话独立（各自 `status`）。
- C3 同一会话重开恢复（重载后 `status` 仍为新档位）。
- C4 五档对同一组样例任务的行为差异（简单/缺目标/复杂但文档全/高代价决策/开放设计）。
- C5 门槛随档位单调（单测已覆盖文案层；行为层用样例观察）。
- C6 完全档有逐轮装载证据（`status` 的装配记录逐条增加，且 `skill=loaded`）。
- C7 关档不注入（section 返回空串）；不会被旧访谈状态重新开启。

### D 实时切换
- D1 同会话「关→高→完全→关」不刷新。
- D2 覆盖空闲 / 等待澄清 / 正在生成 / 工具执行边界。
- D3 快速连续切档，旧版本不覆盖新版本（`version` 单调增，投影通道按 seq 落值）。
- D4 切档不重复执行有副作用的操作。
- D5 日志能说明选择时间、生效时间、请求采用的版本（`status` 的装配记录 + `策略版本 vN`）。

### E 故障与回滚
- E1 状态保存失败有明确提示（模拟：命令未注册 → `宿主没有提供 /grill-level 命令`）。
- E2 skill 缺失有明确提示（`status` 里 `来源 missing`，且不崩）。
- E3 插件重载后状态从会话日志恢复。
- E4 卸载/回滚方式已验证，不破坏其他 skill 或插件。

**已知限制**：正在生成的降档中断（D2 的一个子项）需要真实模型流在跑时点菜单，捕捉难度高。若无法稳定复现，标注为「代码路径已验证 / 实机未捕捉」，不写成「已验证」。

---

## 6. 未决事项

| # | 事项 | 处置 |
| --- | --- | --- |
| U1 | workbuddy 市场版 `grill-me` 与适配版同名 | 安装后实测 `skills.get('grill-me').path`，若指向 `.workbuddy` 则处理（禁用 workbuddy 副本或调整优先级），并在最终报告里写明 |
| U2 | 完全档的「每轮装载」是否需要更强的确定性保证（当前是 section 每 step 重算，属"插件保证注入"而非"模型语义必然遵从"） | 已在 README 与 policy 文案里区分这两层，不宣称确定性执行 |
| U3 | 降档中断的实机证据 | 尽力捕捉；捕捉不到就标 NOT RUN 并给精确复现步骤 |
| U4 | `stateVersion` 后续若需变更 | 变更即全量 refold，需在 CHANGELOG 里标注代价 |

---

## 7. 回滚

1. `plugin_manager action=remove_bundle target="dsh-grill-level"` —— section / 投影 / 菜单行随 fiber 释放全部消失。
2. 删除 `<DSH_HOME>/skills/grill-me/` —— 回到只有机器上原有同名 skill 的原始状态。
3. `upstream/` 从未被写入，无需恢复。
4. profile 的 `package.json` / `cordis.patch.yml` 由 `plugin_manager` 写入，卸载时由其回收；若需手工核对，本文件记录了安装前形态。

---

## 8. 变更记录

- 2026-11-08 首版：D1–D9 定稿，插件三文件 + 16 单测 + skill 三文件落盘。
- 2026-11-08 诊断增强：`skillCache` 增加 `path` / `provider`，`/grill-level status` 输出「技能来源」行，用于验收 A 的运行时闭环（证明宿主解析到的是 `~/.dsh/skills` 而不是 `.workbuddy`）。
- 2026-11-08 **修真实缺陷**：降档判定的「切换前档位」原用内存 `transitions` WeakMap 还原，插件重载后为空 → 回落 `current`（已被 fold 成新档位）→ 降档中断被整段跳过（实测 seq 3619 报「已经是 关（off），无需改动」）。改为 `previousStateFromEvents(session.snapshotEvents())` 从 durable 日志重放（截到倒数第一条 `command/run` 之前），异常回落 `current` 并 `ctx.logger.warn`。删掉 `known` / `transitions` / `seed` / `session/created` 播种代码。单测 16 → 20。
- 2026-11-08 **D7 实测通过**：running 状态下 `/grill-level off`（high v4 → off v5）触发真实中断——`turn/end` → `turn/start`、resume 消息入 inbox 后被消费并落为 `user/message`、off 档 `system/message` 长度为 0。证据 `evidence/07-interrupt-events.txt`。
