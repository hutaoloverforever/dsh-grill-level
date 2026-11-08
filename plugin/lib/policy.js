/**
 * The single readable policy module shared by the Host half.
 *
 * Every wording of the five intensity levels lives here: nothing about the
 * levels is scattered across prompts or ad-hoc scripts. The client half keeps
 * only the short labels/descriptions used in the `+` menu picker.
 *
 * Rules are stored per level as *additions* and rendered cumulatively, so a
 * higher level literally contains every line of the lower ones. That is the
 * monotonic-coverage property the acceptance criteria ask for, and it means the
 * model never has to infer "and everything the lower level said" from a phrase.
 */

/** Ordered level ids, weakest first. */
export const LEVELS = ['off', 'low', 'medium', 'high', 'full'];

/** Monotonic strength rank used for "is this a downgrade" decisions. */
export const RANK = { off: 0, low: 1, medium: 2, high: 3, full: 4 };

/** Chinese labels, also used by diagnostics. */
export const LABELS = { off: '关', low: '低', medium: '中', high: '高', full: '完全' };

/** Prompt section name; stable because it is addressed by the settings UI. */
export const SECTION_NAME = 'grill-level:policy';

/** Prompt section order: after PUA (120), before persona suffix regions. */
export const SECTION_ORDER = 130;

/** Short label for one level, falling back to the raw id. */
export function levelLabel(level) {
  return LABELS[level] ?? String(level);
}

/**
 * Normalize one level token.
 * @param value - user text, possibly with surrounding whitespace or casing.
 * @returns the canonical id, or `null` when it names no level.
 */
export function normalizeLevel(value) {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim().toLowerCase();
  if (trimmed.length === 0) return null;
  return LEVELS.includes(trimmed) ? trimmed : null;
}

/**
 * The rhythm rules that hold at every enabled level.
 *
 * Note what is *not* here: the "just get on with it once information is enough"
 * permission. It used to live in this shared list and it is exactly what let the
 * `full` level answer a trivial question outright instead of asking. It now
 * lives in {@link PERMISSION_RULES} and is withheld from `full`.
 */
const RHYTHM = [
  '一轮只问一个核心问题：不要把多个独立问题塞进同一个编号。',
  '每个问题附上推荐答案和简短理由；缺少依据时明说"不确定"，不要编造。',
  '能通过读代码、读配置、读文档或做低风险实验查到的，先自查，不要甩给用户。',
  '已经回答过、或已有可靠证据的问题不重复问。',
  '用户反问时先正常回答，再继续澄清。',
  '本档位不覆盖宿主权限、安全规则，以及用户最新的停止/关闭/改档指令。',
];

/**
 * "You may skip the interview" permissions: every level except `full` carries
 * them. At `full` they are omitted on purpose, because `full` must ask before it
 * answers even when the task looks trivial and complete.
 *
 * Exported so the acceptance tests can assert both directions: present at
 * low/medium/high, absent at full.
 */
export const PERMISSION_RULES = Object.freeze([
  '信息足够就整理决策并执行，不把访谈本身当成最终产物。',
  '简单且信息完整的任务仍然可以直接完成。',
]);

/** Levels that keep the permissions above. */
const PERMISSION_LEVELS = Object.freeze(['low', 'medium', 'high']);

/**
 * Per-level rule additions, weakest first. `off` has no group because it is
 * never injected. Each group is rendered only at its own level and above.
 */
const RULE_GROUPS = [
  {
    level: 'low',
    title: '低 · 默认执行',
    rules: [
      '默认直接执行，不要为了澄清而澄清。',
      '只有这几种情况必须先问：关键目标缺失、需求自相矛盾、不可逆或高代价的选择缺少授权依据。',
      '非阻塞细节按现有约定或保守默认处理，并在结果里用一句话记录假设。',
      '阻塞点消除后立刻执行，不要扩散到低价值分支。',
    ],
  },
  {
    level: 'medium',
    title: '中 · 澄清会改变结果的歧义',
    rules: [
      '较复杂的任务里，凡是会明显改变结果或导致返工的歧义，先澄清再动手。',
      '重点覆盖：目标、范围、重要约束、关键方案、验收标准。',
      '次要且可逆的实现细节自行决定，不要拿去占用用户注意力。',
      '核心决策明确后立即执行。',
    ],
  },
  {
    level: 'high',
    title: '高 · 非平凡任务先结构化澄清',
    rules: [
      '非平凡任务默认先结构化澄清，再动手。',
      '额外检查：决策依赖、异常路径、边界条件、兼容性、失败恢复、重要取舍。',
      '只探索与当前任务相关的分支，不扩大范围、不过度设计。',
    ],
  },
  {
    level: 'full',
    title: '完全 · 本会话的首要交互协议（强制提问）',
    rules: [
      '本会话以 grill-me 技能为首要交互协议；技能全文由插件按请求装载。',
      '**强制**：每一轮面向用户的回答之前，必须先抛出至少一个确认性问题，然后停下来等用户回答。',
      '**禁止直接给答案**：任务再简单、信息再完整、你认为答案再确定，也要先问再答。不得以"没有待澄清项"为理由跳过提问。',
      '允许的问题形态：确认目标与会话意图、确认验收标准、确认边界或假设、就一个具体取舍请用户拍板。选最贴近本轮任务的那一种。',
      '同一个问题不要问第二遍：用户已经答过的，或已有可靠证据的，直接采用并推进。',
      '不得递归调用自身，不得为了制造调用记录而伪造工具调用。',
    ],
  },
];

/**
 * All rule groups that apply at one level, weakest first.
 * @param level - canonical level id.
 * @returns the applicable groups (empty for `off`).
 */
function groupsThrough(level) {
  const limit = RANK[level];
  if (!Number.isSafeInteger(limit) || limit <= 0) return [];
  return RULE_GROUPS.filter((group) => RANK[group.level] <= limit);
}

/**
 * Render the policy text for one state.
 * @param state - projected session state (`level`, `version`).
 * @returns the prompt text; empty string means "inject nothing".
 */
export function policySection(state) {
  const level = normalizeLevel(state?.level);
  if (level === null || level === 'off') return '';
  const version = Number.isSafeInteger(state?.version) ? state.version : 0;
  const blocks = [];
  for (const group of groupsThrough(level)) {
    blocks.push(`### ${group.title}`);
    for (const rule of group.rules) blocks.push(`- ${rule}`);
    blocks.push('');
  }
  // `full` deliberately omits the "you may skip the interview" permissions.
  const permissions = PERMISSION_LEVELS.includes(level) ? PERMISSION_RULES : [];
  return [
    '## Grill me 澄清强度（由 dsh-grill-level 插件注入）',
    `当前档位：${levelLabel(level)}（${level}）· 策略版本 v${version} · 仅对当前会话生效。`,
    level === 'full'
      ? '以下规则逐级累加。本档位是强制提问档：较弱档位的"信息足够就执行"类许可在本档位不适用。'
      : '以下规则逐级累加：本档位包含全部较弱档位的规则，再加上本节列出的增补项。',
    '',
    ...blocks,
    ...(permissions.length === 0
      ? []
      : ['### 执行许可（仅在非「完全」档位适用）', ...permissions.map((line) => `- ${line}`), '']),
    '### 节奏要求（所有非「关」档位一致）',
    ...RHYTHM.map((line) => `- ${line}`),
  ].join('\n').trimEnd();
}

/**
 * Render the message that carries the skill body at the `full` level.
 * @param state - projected session state.
 * @param skill - resolved skill definition text.
 * @returns the message text.
 */
export function fullLoadText(state, skill) {
  const version = Number.isSafeInteger(state?.version) ? state.version : 0;
  return [
    `【dsh-grill-level 装载】档位=完全（full）· 策略版本 v${version}`,
    '以下 grill-me 技能全文由宿主技能目录解析后随本请求装载，是本会话当前的首要交互协议。',
    '如果其中条款与宿主权限、安全规则或用户最新的停止/改档指令冲突，以宿主与用户为准。',
    '',
    '--- grill-me SKILL.md ---',
    skill,
    '--- end grill-me SKILL.md ---',
  ].join('\n');
}

/**
 * Render the short message that resumes a turn interrupted by a downgrade.
 * @param state - projected session state after the downgrade.
 * @returns the message text.
 */
export function resumeText(state) {
  const level = normalizeLevel(state?.level) ?? 'off';
  const version = Number.isSafeInteger(state?.version) ? state.version : 0;
  return [
    `【dsh-grill-level 恢复】澄清强度已改为 ${levelLabel(level)}（${level}）· 策略版本 v${version}。`,
    '上一轮按旧档位进行的内容已中断。请保留已经取得的事实、用户已给出的回答和已达成的决策，',
    '不要重复已经问过的问题，不要重做已经完成且有副作用的操作，按新档位继续推进当前任务。',
  ].join('\n');
}
