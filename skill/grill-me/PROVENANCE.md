# 来源与适配差异（grill-me · DSH 适配版）

## 上游

| 项目 | 值 |
| --- | --- |
| 仓库 | https://github.com/mattpocock/skills |
| commit | `4ae2317ddb22b046e26455e4f9c9b3aaaf62212d` |
| commit 时间 | 2026-10-31T14:23:30Z |
| commit 标题 | `software-factory: glossary skill for designing a factory (#1316)` |
| 版本 | `mattpocock-skills` v1.3.2 |
| 许可证 | MIT，Copyright (c) 2026 Matt Pocock |
| 取得时间 | 2026-11-08（本地 shallow clone，工作区干净） |
| 上游副本位置 | 开发者本地 shallow clone（只读保留，本适配版不覆盖它）；复现：`git clone https://github.com/mattpocock/skills && git checkout 4ae2317` |

上游相关文件：

- `skills/productivity/grill-me/SKILL.md`（7 行）：frontmatter 三行 + 正文一行 `Call the Skill tool with "grilling".`
- `skills/productivity/grilling/SKILL.md`（30 行）：真正的方法论（design tree / rounds / frontier / 格式模板 / 事实归 agent）。
- `skills/productivity/grill-me/agents/openai.yaml`：`policy.allow_implicit_invocation: false`（仅适用于 OpenAI 形态的宿主，DSH 不读这个文件）。

## 适配差异（逐条）

| # | 差异 | 原因 |
| --- | --- | --- |
| 1 | **合并两个 skill 为一个**：`grilling` 的方法论内联进 `grill-me/SKILL.md`，不再依赖二级 skill 调用。 | 上游 `grill-me` 正文只有 `Call the Skill tool with "grilling".`。DSH 的 skill 加载由 `skill` 工具按名加载，没有"技能里再点名另一个技能"的等价惯例；拆成两个会让安装者必须同时装两个目录，且 `grilling` 名与做法都不在本仓发布范围内。 |
| 2 | **一次只问一个核心问题**，而不是一轮抛出整个 frontier。 | 用户明确要求（知乎文章同款结论）：一口气抛 5-6 问会让用户随手糊弄，访谈失效。frontier 仍作为**内部**结构保留——它决定"下一个该问哪个"，只是不再一次性倾倒给用户。 |
| 3 | **推荐答案改为中文格式** `➡️ 推荐答案：<推荐> —— 理由：<理由>`。 | 默认中文交互；同时把"给理由"从可选变成格式的一部分（上游只要求 `➡️ <your recommended answer>`）。 |
| 4 | **子代理查证改为 DSH 工具名**：`read`/`grep`/`glob`/`pwsh`/`subagent`。 | 上游写的是"dispatch a sub-agent with a fresh context window"，未指定工具；DSH 里对应 `subagent` 工具。 |
| 5 | **新增"收尾必须落盘决策清单"**一节。 | 上游"只提问不整理"是公开承认的缺陷；用户要求"信息足够后整理决策并执行，不把访谈本身当最终产物"。 |
| 6 | **新增"与上游的差异"指向本节**，并保留 `disable-model-invocation: true`。 | 保持 user-invoked 语义（DSH 的 `parseInvocationPolicy` 识别 `disable-model-invocation`），与本 skill"必须主动触发"的定位一致。 |
| 7 | 描述与标题改为中文，`description` 补充 DSH 触发语（`拷问我`/`压力测试这个方案`）。 | 默认中文交互；DSH 的 skill 目录用 `description` 做路由，需要中文触发词。 |

## 未采纳的上游内容

- `agents/openai.yaml`：DSH 不读该文件，`policy.allow_implicit_invocation` 的等价物是 frontmatter 的 `disable-model-invocation: true`。
- 上游 `docs/productivity/grill-me.md`、`docs/productivity/grilling.md`：面向人类读者的说明页，不参与运行时。
- `.out-of-scope/native-question-tool.md`、`question-limits.md`、`subagent-recursion.md`：上游明确排除的范围，本适配版同样不实现。

## 升级方式

上游有新版时：

1. `git -C upstream fetch && git -C upstream log --oneline HEAD..origin/main -- skills/productivity/grill-me skills/productivity/grilling`
2. 逐个 commit 比对 `grilling/SKILL.md` 的方法论段落。
3. 只把方法论差异合并进本目录 `SKILL.md`；**不要**覆盖上游副本，也不要把上游 `grill-me/SKILL.md` 的一行式正文搬回来。
4. 更新本文件的 commit / 取得时间。

## 许可证

本适配版与上游同为 MIT。上游 `LICENSE` 原文逐字保留在同目录 `LICENSE`（1089 字节，与 `upstream/LICENSE` 哈希一致）。
