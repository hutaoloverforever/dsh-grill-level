# dsh-grill-level

> 给 [grill-me](#-开篇与溯源声明) 装上「强度旋钮」——在 DeepSeek Harness 的「＋」菜单里，用五档控制 AI 追问你的力度。

一个 **DeepSeek Harness (DSH) 插件**：把「要么全开、要么全关」的 grill-me 拷问技能，变成 **关 / 低 / 中 / 高 / 完全** 五档可调，并按会话独立保存、即时生效。

```
┌──────────────────────────────────────────────┐
│  点「＋」 →「Grill me 澄清强度」→ 选一档      │
│                                              │
│   关     不注入，回到宿主原生交互             │
│   低     默认直接执行，只在真正阻塞时澄清     │
│   中     会明显改变结果的歧义先澄清           │
│   高     非平凡任务默认先结构化澄清           │
│   完全   每轮回答前必须先抛出一个确认性问题   │
└──────────────────────────────────────────────┘
```

---

## 📜 开篇与溯源声明

**本项目不是从零发明的。** 它的核心交互逻辑来自他人的开源工作，工程规范受过他人写作的启发。以下逐条声明。

### 1. 核心交互逻辑：移植自 Matt Pocock 的 `grill-me` Skill

本插件的全部「提问方法论」——**一次只问一个问题、每个问题附推荐答案、能自查的绝不问用户、沿设计树的依赖关系逐层推进**——移植自知名开发者 **Matt Pocock** 的开源仓库：

- **原仓库**：<https://github.com/mattpocock/skills>
- **相关 Skill**：`skills/productivity/grill-me`、`skills/productivity/grilling`
- **本项目基线 commit**：`4ae2317ddb22b046e26455e4f9c9b3aaaf62212d`（`software-factory: glossary skill for designing a factory (#1316)`，2026-10-31）
- **原仓库许可证**：MIT，Copyright (c) 2026 Matt Pocock

上游的 `grill-me/SKILL.md` 正文本身只有一句 `Call the Skill tool with "grilling".`，真正的方法论在 `grilling/SKILL.md`。本项目把两者**合并**成一份适配版（详见 [`skill/grill-me/PROVENANCE.md`](skill/grill-me/PROVENANCE.md)），并保留上游 MIT 许可证原文。

### 2. 交互范式：参考知乎问答《大家用 grill-me（拷问我）这个 AI Agent Skill 的体验如何？》

- **原文链接**：<https://www.zhihu.com/question/2054005413406946147>

产品形态上的几个决定——**一次一问而不是一轮抛完整个 frontier**、**每题必附推荐答案**、**能查的不问**——参考了这篇实践复盘文章对 grill-me 的观察与批评（原文作者提出的「翻转交互模式」、11 问案例、以及「为什么有人用三轮就删」）。

### 3. 工程验收与排错规范：关于验收与排错纪律的灵感

本仓库的工程纪律——**让 AI 自我审计**、**用退出码 / 原始输出验证而不是用自然语言声明**、**先取证再下结论**——关于验收与排错纪律的灵感，感谢作者提供的 Vibe Coding 实战洞察。

### 4. 本项目做了什么：宿主级扩展的二次创作

在**原版 prompt 的基础上**，本项目新增了两样上游没有的东西：

| 新增 | 说明 |
| --- | --- |
| **多档位控制 UI** | 在 DSH「＋」菜单里内嵌五档选择器，不用改 prompt、不用记命令 |
| **即时生效机制** | 切档后**下一次模型请求**即按新档位装配，不需要刷新页面、不需要重开会话 |

> 一句话：**方法论是别人的，旋钮是我们加的。**

---

## 🎯 适用范围（什么情况下用）

**适合：**

- 从 0 到 1 的架构设计——需要把模糊想法逼成可执行方案
- 需求模糊、还没对齐——需要 AI 帮你把「我以为的完整」拆开
- 复杂重构之前——需要先问清边界、兼容性、失败恢复

**不适合：**

- **极度确定的常识问题**（如「1+1 等于几」）——开高档位纯属浪费
- **赶 deadline 的紧急任务**——拷问需要时间，此时应该切到「关」或「低」
- 已经有完整 PRD、只需照着实现的业务代码——高档位会问出过度设计的问题

> 这也是本插件存在的理由：grill-me 上游是**开关**，而真实任务需要**旋钮**。

---

## 🔧 插件作用（它做了什么）

**在 DSH 输入框左下角「＋」菜单里生成原生 UI**，提供五档档位，动态控制 System Prompt 中 grill-me 规则的注入严格程度。

| 档位 | 注入内容 | 典型行为 |
| --- | --- | --- |
| `off` 关 | 空字符串（完全不注入） | 宿主原生交互，AI 直接干活 |
| `low` 低 | 约 534 字符 | 默认直接执行，只在关键目标缺失 / 需求矛盾 / 高代价决策缺授权时澄清 |
| `medium` 中 | 约 667 字符 | 会明显改变结果或导致返工的歧义先澄清 |
| `high` 高 | 约 773 字符 | 非平凡任务默认先结构化澄清，额外检查边界条件、兼容性、失败恢复 |
| `full` 完全 | 约 1018 字符 + 技能全文 | **强制提问档**：每轮回答前必须先抛出至少一个确认性问题 |

两条关键设计：

1. **规则逐级累加**——选「高」时，prompt 里同时含低档与中档的全部规则，再加高档增补项。单调性由单测 `coverage grows monotonically` 守住。
2. **「完全」档刻意剔除免责条款**——「信息足够就执行」「简单任务可以直接完成」这两条许可**不注入 full 档**（`PERMISSION_RULES` 只对 low/medium/high 生效），否则模型会用它跳过提问。

对照实测（`policySection()` 渲染长度，严格单调）：

```
off     0
low     534
medium  667
high    773
full    1018
```

---

## ⚙️ 技术原理（它是怎么做到的）

**没有侵入 DSH 核心代码。** 全部通过宿主公开的服务接口实现。

### `systemPrompt.section` — 动态上下文组装

```js
ctx.systemPrompt.section({
  name: 'grill-level:policy',
  order: 130,
  text: (context) => {
    const agent = context?.agent ?? context?.scope;
    const state = ctx.sessionProjections.stateOf(agent.session, 'grillLevel');
    if (state.level === 'off') return '';          // 空串 = 完全不注入
    return policySection(state);                    // 每次 assemble 重新渲染
  },
});
```

关键点：**`text` 是一个函数，不是字符串**。DSH 在每个 step 的 `preStep()` 都会调用
`systemPrompt.assemble()`，因此这段文本**每个 step 都会重新求值**——这就是「切档即时生效」的机制来源，不需要轮询、不需要重启。

空字符串会被 `renderPrompt` 的 `.filter(t => t.length > 0)` 过滤掉，所以 `off` 档等价于**彻底不注入**。

### `sessionProjections` — 会话级状态持久化

```js
ctx.sessionProjections.register({
  key: 'grillLevel',
  stateVersion: 1,
  init: () => ({ level: 'off', version: 0, updatedAt: 0 }),
  apply: (state, event) => { /* 只折叠 command/run 事件 */ },
  wire: { viewSchema, view: (s) => ({ level: s.level, version: s.version, updatedAt: s.updatedAt }) },
});
```

关键点：

- **状态是会话日志的纯派生**，不是插件内存里的变量。插件卸载后重装，档位从日志重建，不丢。
- **新会话默认 `off`**：`init()` 返回 `EMPTY_STATE`。
- **会话间隔离**：投影 key 挂在 session 上，不会串档。
- **`apply` 对无关事件返回同一引用**，触发 `Object.is` 门禁，不产生变更通知。

### 写入路径唯一

`/grill-level <level>` 是唯一写入点。它会落 `command/run` 到会话日志，从而驱动上面的投影。客户端点选也走这条路——`sessions.binding(id).session.command('/grill-level full')`。

### 「完全」档的技能正文装载

`systemPrompt.section` 的 `text` 回调里拼上 `ctx.skills.get('grill-me').content`，并用 `skills/change` 事件刷新缓存。取不到时降级为「只注入档位规则」，并在 `status` 里如实标 `missing`。

### 目录结构

```
.
├── package.json          # DSH 插件清单：dsh.bundle.patch + dsh.client
├── cordis.patch.yml      # 只插入 host 半边
├── LICENSE               # MIT
├── README.md             # 本文件
├── lib/
│   ├── policy.js         # 纯函数：五档规则文案（可单测，零宿主依赖）
│   ├── index.js          # host 半边：投影 + section + 命令
│   └── client.js         # 浏览器半边：commandUi 贡献 popupSelect
├── test/
│   ├── policy.test.mjs   # 13 例
│   └── state.test.mjs    # 9 例
└── skill/
    └── grill-me/         # 适配版 skill（SKILL.md / LICENSE / PROVENANCE.md）
```

---

## ⚠️ 已知局限（它做不到什么）

诚实说明，不粉饰。

### 1. AI 不总是 100% 遵循 Prompt 规则

插件能保证的是**注入内容**的严格程度单调递增，**不能保证模型语义必然遵从**。这中间隔着一层模型行为，没有任何 prompt 工程能完全消除。

因此：验收时我们区分两层——

- ✅ **注入层**（插件负责，可验证）：每档的文本长度、规则条数、是否含强制条款
- ⚠️ **行为层**（模型负责，不可机械验收）：同一任务在五档下的实际提问数量

### 2. 档位越高，Token 消耗和等待时间越长

`full` 档在每个模型请求里都要装载一遍技能全文（实测约 1400 字符 + 1018 字符策略文本），并强制执行至少一轮问答往返。这是**设计如此**，不是缺陷——但赶时间时应该切到「关」或「低」。

### 3. 对已经写好 PRD 的业务代码，可能问出过度设计的问题

`high` / `full` 档会检查「决策依赖、异常路径、边界条件、兼容性、失败恢复」等维度。如果你的需求文档本身已经把这些写清楚了，这些提问就是冗余的。此时建议切到 `low`。

### 4. 浏览器半边需要刷新页面才消失

禁用 / 卸载插件后，宿主行（`/grill-level`）会立即卸载，但浏览器那半是**页面加载时注入的 ES 模块**，「Grill me 澄清强度」这一行在刷新页面前仍会留在「＋」菜单里。点它会因宿主命令缺失而明确报错「宿主没有提供 /grill-level 命令。」——不会静默失败。

### 5. 「＋」菜单里有两行相关条目

宿主命令 `grill-level`（支持 `/grill-level status` 诊断）与浏览器贡献 `grill`（五档点选）名字必须不同——宿主 UI 在两者重名时直接抛错。这是 DSH 的规则，不是本插件的选择。

---

## 📦 安装

### 一行命令安装（推荐）

```bash
dsh plugin --profile <你的profile名称> add https://github.com/hutaoloverforever/dsh-grill-level/releases/download/v0.10/dsh-grill-level-0.1.0.tgz
```

把 `<你的profile名称>` 换成你实际使用的 profile（例如 `desktop` 或 `default`）。DSH 会下载 tarball、写入 `dsh.profile.bundles` 并完成安装，**重启宿主后生效**。

> 该 Release 资产的 SHA256 为 `3f3bb7394f1292f1d2abb065d60c0dd38f91b8559ea2b491c87a912934f10d0c`，可自行校验：
> ```bash
> curl -sSL -o dsh-grill-level-0.1.0.tgz https://github.com/hutaoloverforever/dsh-grill-level/releases/download/v0.10/dsh-grill-level-0.1.0.tgz
> sha256sum dsh-grill-level-0.1.0.tgz
> ```

### 方式二：从源码安装（开发用）

```bash
git clone https://github.com/hutaoloverforever/dsh-grill-level.git
dsh plugin --profile <你的profile名称> add <你的路径>/dsh-grill-level
```

插件通过 `link:` 依赖装入 profile，`node_modules/dsh-grill-level` 是指向源码目录的 Junction，**改代码不需要重装**（但宿主半边需要重载才生效）。

### 配套安装 skill

「完全」档需要 `grill-me` 技能正文才能装载全套方法论。把仓库里的 `skill/grill-me/` 整个目录复制到 DSH 的用户技能根：

```bash
cp -r skill/grill-me <你的 DSH_HOME>/skills/grill-me
```

（也可从已安装的包内取：`<你的 DSH_HOME>/profiles/<你的profile>/node_modules/dsh-grill-level/skill/grill-me/`）

验证：

```
/grill-level status
```

应看到 `技能来源：<你的 DSH_HOME>/skills/grill-me/SKILL.md`。

### 验证安装

```powershell
# 插件是否在跑
plugin_manager action=list_plugins       # 找 include:dsh-grill-level, fiberPhase: "active"

# 当前档位与诊断
/grill-level status

# 自测（需 node >= 22）
cd <你的路径>/dsh-grill-level && node --test test/    # 22/22 pass
```

---

## 🚀 使用

### 图形界面

点输入框左下角 **「＋」** → 滚到「指令」段末尾 → **「Grill me 澄清强度」** → 选档。

当前档位带 `· 当前（策略版本 vN）` 标记。菜单关闭时插件**不渲染任何 UI**，不占用输入区。

### 命令行

```
/grill-level <off|low|medium|high|full>   设置当前会话档位
/grill-level status                        打印诊断
```

`status` 输出示例：

```
grill-level · 当前会话档位 完全（full）· 策略版本 v2
技能正文：1416 字符（host）
技能来源：<你的 DSH_HOME>/skills/grill-me/SKILL.md · provider=dsh-skills-manager-external
最近 24 次装配记录（新→旧）：
- 2026-11-08T04:34:52.195Z 档位=full v2 阶段=running skill=loaded 1416B
- 2026-11-08T04:34:43.432Z 档位=full v2 阶段=running skill=loaded 1416B
```

装配记录最多保留 24 条，回答四个问题：当前档位是什么 / 策略版本是几 / 技能正文从哪来 / 最近一次实际装配发生在何时、当时 agent 在什么状态。

---

## 🔄 即时生效与中断语义

| 场景 | 行为 |
| --- | --- |
| 空闲时切档 | 下一个模型请求即用新档位 |
| 等待用户回答澄清时切档 | 立即改变后续交互 |
| 正在生成 + **升档** | 不打断，本轮结束后按新档位继续 |
| 正在生成 + **降档** | `agent.cancel()` 中断当前流，再 `agent.followup()` 注入恢复提示，按新档位继续 |
| 工具执行边界 | 已完成的工具结果保留；中断不重放已执行的有副作用操作 |

**明确边界**：插件无法修改「已经发出去的那个模型请求」的输入——这是宿主协议决定的。它做的是**中断该请求，用新档位发起后续请求**。界面上不会把「状态已更新」伪装成「那个请求已收到新指令」。

### 策略版本机制

每次换档，投影里的 `version` 自增，注入文本里带 `策略版本 vN`，因此可以核对「这轮回答到底用的是哪一版策略」。快速连续切档时：

- 状态由 `sessionProjections` 按事件顺序同步折叠，后到的覆盖先到的
- 客户端投影通道按 `seq` 单调递增落值（`if (seq <= row.seq) return`），旧值不会覆盖新值
- 策略文本每次组装时**重新读取**当前投影状态，不使用会话创建时的快照

---

## 🧹 卸载 / 回滚

```powershell
# 1. 禁用（保留状态，随时可恢复）
plugin_manager action=set_plugin target="include:dsh-grill-level" enabled=false

# 2. 彻底卸载
plugin_manager action=remove_bundle target="dsh-grill-level"

# 3. 清理 pnpm 可能遗留的 junction（重要）
$nm = "<你的 DSH_HOME>/profiles/<你的profile>/node_modules/dsh-grill-level"
if ((Get-Item $nm -Force -ErrorAction SilentlyContinue).Target -like "*dsh-grill-level*") { cmd /c rmdir "$nm" }
```

> ⚠️ 必须用 `rmdir`（删 junction 本身），**不要用 `Remove-Item -Recurse`**——后者会顺着链接把插件源码删掉。

卸载后：`systemPrompt` 的 section 随 fiber 释放消失，投影 key 从快照移除，宿主命令注销。**会话档位不丢**——它存在会话日志里，重装后重新 fold，读数与卸载前一致。

---

## 🧪 开发

```bash
node --test test/          # 22 个用例
node --check lib/index.js  # 语法检查
```

- 规则文案只在 `lib/policy.js`，改规则不用碰宿主 API。
- `coverage grows monotonically` 这条单测会拦住「高档漏了低档规则」这类退化。
- `stateVersion` 只在状态形状变更时上调——上调会让所有 checkpoint 失配、强制全日志 refold，代价真实存在。

---

## 📄 许可证

**MIT**。见 [`LICENSE`](LICENSE)。

上游 `grill-me` / `grilling` 同样为 MIT（Copyright (c) 2026 Matt Pocock），原文保留在 [`skill/grill-me/LICENSE`](skill/grill-me/LICENSE)。

---

## 🙏 致谢

- **Matt Pocock** — [mattpocock/skills](https://github.com/mattpocock/skills)，grill-me 方法论的作者
- [知乎问答《大家用 grill-me（拷问我）这个 AI Agent Skill 的体验如何？》](https://www.zhihu.com/question/2054005413406946147) — 交互范式的实践参照
- **Vibe Coding 实战洞察**（作者内部文档）— 关于验收与排错纪律的灵感，感谢作者提供的 Vibe Coding 实战洞察

如果本插件对你有用，去给上游仓库点个 star——**真正的功劳在那里**。
