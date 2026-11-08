/**
 * Host half of `dsh-grill-level`.
 *
 * Three responsibilities, one place each:
 *   1. the per-session level lives in a session projection folded from the
 *      durable `command/run` records of `/grill-level` (no bespoke event type,
 *      no side channel), so it survives reopen and never leaks across sessions;
 *   2. the active level reaches the model through one system-prompt section
 *      that is re-rendered on every `systemPrompt.assemble()` call (every
 *      pre-step), which is what makes a switch take effect immediately;
 *   3. `/grill-level` writes the level and, on a downgrade while a turn is
 *      generating, cancels that turn the same way the user's own stop does and
 *      re-queues a resume message under the new level.
 */

import { randomUUID } from 'node:crypto';

import {
  LEVELS,
  RANK,
  SECTION_NAME,
  SECTION_ORDER,
  levelLabel,
  normalizeLevel,
  policySection,
  fullLoadText,
  resumeText,
} from './policy.js';

/** Cordis plugin name. */
export const name = 'grill-level';

/** Services this plugin cannot work without. */
export const inject = ['commands', 'systemPrompt', 'sessionProjections'];

/** Projection key; also the client-side key the picker reads. */
const PROJECTION_KEY = 'grillLevel';

/** Plugin id used in message sources and diagnostics. */
const PLUGIN_ID = 'dsh-grill-level';

/** Slash command name. Must not collide with an existing host command. */
const COMMAND_NAME = 'grill-level';

/** Skill directory name resolved through `ctx.skills`. */
const SKILL_NAME = 'grill-me';

/** How many assemble records one session keeps for diagnostics. */
const DIAG_LIMIT = 24;

/** State used before anything was ever written. */
const EMPTY_STATE = Object.freeze({ level: 'off', version: 0, updatedAt: 0 });

/**
 * Schema for the projected state. Only `.parse` is consumed by the registry,
 * so a plain object keeps this plugin free of a zod dependency (the profile
 * carries zod 3 while bundled packages carry zod 4).
 */
const stateSchema = {
  parse(value) {
    const record = typeof value === 'object' && value !== null ? value : {};
    const level = normalizeLevel(record.level) ?? 'off';
    const version = Number.isSafeInteger(record.version) && record.version >= 0 ? record.version : 0;
    const updatedAt = Number.isSafeInteger(record.updatedAt) && record.updatedAt >= 0 ? record.updatedAt : 0;
    return { level, version, updatedAt };
  },
};

/** Wire schema for the value the browser reads. */
const viewSchema = {
  parse(value) {
    const record = typeof value === 'object' && value !== null ? value : {};
    return {
      level: normalizeLevel(record.level) ?? 'off',
      version: Number.isSafeInteger(record.version) && record.version >= 0 ? record.version : 0,
      updatedAt: Number.isSafeInteger(record.updatedAt) && record.updatedAt >= 0 ? record.updatedAt : 0,
    };
  },
};

/** Parse the first token of a command's recorded arguments. */
export function parseLevelArgument(args) {
  if (typeof args !== 'string') return null;
  const parts = args.trim().split(/\s+/).filter((part) => part.length > 0);
  if (parts.length !== 1) return null;
  return normalizeLevel(parts[0]);
}

/**
 * Fold the durable command records into the session's grill level.
 *
 * Only `command/run` of this plugin's command changes anything; every other
 * event returns the previous reference so the projection's `Object.is` gate
 * stays quiet.
 */
export function applyEvent(state, event) {
  if (event.type !== 'command/run') return state;
  const data = event.data;
  if (typeof data !== 'object' || data === null || data.name !== COMMAND_NAME) return state;
  const level = parseLevelArgument(data.args);
  if (level === null || level === state.level) return state;
  return { level, version: state.version + 1, updatedAt: event.time };
}

/** Build the assistant-visible message that carries a plugin instruction. */
function pluginUserMessage(text) {
  return {
    id: randomUUID(),
    role: 'user',
    content: [{ type: 'text', text }],
    source: { kind: `plugin:${PLUGIN_ID}` },
  };
}

/**
 * Rebuild the level that was in force *before* the newest `/grill-level` record.
 *
 * `execute()` appends `command/run` before the handler runs and the projection
 * folds it synchronously, so by handler time the projection already shows the
 * new level and cannot answer "what did I just replace?". Replaying the durable
 * log minus its last record is the only reload-proof answer: an in-memory cache
 * is empty after a plugin reload, and guessing `off` there turns a real
 * downgrade into a silent no-op.
 */
export function previousStateFromEvents(events) {
  let lastRecordSeq = -1;
  for (const event of events) {
    if (event.type === 'command/run' && event.data?.name === COMMAND_NAME) lastRecordSeq = event.seq;
  }
  let previous = EMPTY_STATE;
  for (const event of events) {
    if (event.seq === lastRecordSeq) break;
    previous = applyEvent(previous, event);
  }
  return previous;
}

/**
 * Cordis entry point.
 * @param ctx - the plugin context.
 */
export function apply(ctx) {
  /** Bounded per-session assemble records, newest last. */
  const diagnostics = new WeakMap();
  /** Cached skill body, refreshed when the skill catalog changes. */
  let skillCache = { content: undefined, at: 0, source: 'unloaded', path: undefined, provider: undefined };

  const note = (session, record) => {
    const list = diagnostics.get(session) ?? [];
    list.push(record);
    while (list.length > DIAG_LIMIT) list.shift();
    diagnostics.set(session, list);
  };

  // Read back the level the newest `/grill-level` record replaced.
  const previousState = (session, current) => {
    try {
      return previousStateFromEvents(session.snapshotEvents());
    } catch (error) {
      ctx.logger?.warn?.(`grill-level: could not replay the session log: ${String(error)}`);
      return current;
    }
  };

  ctx.sessionProjections.register({
    key: PROJECTION_KEY,
    stateVersion: 1,
    stateSchema,
    init: () => EMPTY_STATE,
    apply: applyEvent,
    wire: {
      viewSchema,
      view: (state) => ({ level: state.level, version: state.version, updatedAt: state.updatedAt }),
    },
  });

  /** Refresh the cached skill body from the host skill catalog. */
  const refreshSkill = async (agent) => {
    const skills = ctx.get('skills');
    if (skills === undefined || typeof skills.get !== 'function') {
      skillCache = { content: undefined, at: Date.now(), source: 'no-skills-service' };
      return skillCache;
    }
    try {
      const definition = await skills.get(SKILL_NAME, agent === undefined ? {} : { scope: agent });
      const content = typeof definition?.content === 'string' && definition.content.length > 0
        ? definition.content
        : undefined;
      skillCache = {
        content,
        at: Date.now(),
        source: content === undefined ? 'missing' : 'host',
        path: typeof definition?.path === 'string' ? definition.path : undefined,
        provider: typeof definition?.provider === 'string' ? definition.provider : undefined,
      };
    } catch (error) {
      skillCache = { content: undefined, at: Date.now(), source: `error: ${String(error)}` };
      ctx.logger?.warn?.(`grill-level: skill "${SKILL_NAME}" unavailable: ${String(error)}`);
    }
    return skillCache;
  };

  // Warm the cache once and keep it fresh; the render path below must stay
  // synchronous, so it serves the last successfully resolved body.
  void refreshSkill(undefined);
  ctx.on('skills/change', () => { void refreshSkill(undefined); });

  ctx.systemPrompt.section({
    name: SECTION_NAME,
    order: SECTION_ORDER,
    text: (context) => {
      const agent = context?.agent ?? context?.scope;
      if (agent === undefined) return '';
      const session = agent.session;
      if (session === undefined) return '';
      const state = ctx.sessionProjections.stateOf(session, PROJECTION_KEY) ?? EMPTY_STATE;
      const loaded = state.level === 'full' && typeof skillCache.content === 'string';
      note(session, {
        at: Date.now(),
        level: state.level,
        version: state.version,
        phase: typeof agent.status === 'string' ? agent.status : 'unknown',
        skill: state.level === 'full' ? (loaded ? 'loaded' : skillCache.source) : 'not-required',
        bytes: loaded ? skillCache.content.length : 0,
      });
      if (state.level === 'off') return '';
      const body = policySection(state);
      if (state.level !== 'full') return body;
      if (!loaded) return body;
      return `${body}\n\n${fullLoadText(state, skillCache.content)}`;
    },
  });

  /** Resolve the live agent that owns a session, tolerating partial command contexts. */
  const liveAgentFor = (agent) => {
    if (agent !== undefined && typeof agent.cancel === 'function') return agent;
    const id = agent?.id ?? agent?.session?.id;
    if (id === undefined) return undefined;
    try {
      return ctx.get('agents')?.get?.(id);
    } catch {
      return undefined;
    }
  };

  const describeDiagnostics = (session, state) => {
    const list = diagnostics.get(session) ?? [];
    const lines = [
      `grill-level · 当前会话档位 ${levelLabel(state.level)}（${state.level}）· 策略版本 v${state.version}`,
      `技能正文：${typeof skillCache.content === 'string' ? `${skillCache.content.length} 字符（${skillCache.source}）` : `未取得（${skillCache.source}）`}`,
      `技能来源：${skillCache.path ?? '未知'}${skillCache.provider === undefined ? '' : ` · provider=${skillCache.provider}`}`,
      `最近 ${list.length} 次装配记录（新→旧）：`,
    ];
    for (const record of [...list].reverse()) {
      const time = new Date(record.at).toISOString();
      lines.push(
        `- ${time} 档位=${record.level} v${record.version} 阶段=${record.phase} skill=${record.skill}${record.bytes > 0 ? ` ${record.bytes}B` : ''}`,
      );
    }
    if (list.length === 0) lines.push('- （本会话尚未发生装配）');
    return lines.join('\n');
  };

  ctx.commands.register({
    name: COMMAND_NAME,
    description: '设置当前会话的 grill-me 澄清强度（off / low / medium / high / full）',
    input: { hint: `<${LEVELS.join('|')}|status>` },
    handler: (invocation) => {
      const agent = invocation.agent;
      const session = agent?.session;
      if (session === undefined) {
        return { kind: 'error', text: 'grill-level：当前命令没有可用的会话上下文。' };
      }
      const raw = invocation.rawInput.trim();
      if (raw === 'status') {
        const state = ctx.sessionProjections.stateOf(session, PROJECTION_KEY) ?? EMPTY_STATE;
        return { kind: 'success', text: describeDiagnostics(session, state) };
      }
      if (raw.length === 0) {
        return { kind: 'error', text: `grill-level：用法 /${COMMAND_NAME} <${LEVELS.join('|')}>` };
      }
      const parts = raw.split(/\s+/);
      const level = normalizeLevel(parts[0]);
      if (level === null) {
        return { kind: 'error', text: `grill-level：未知档位「${parts[0]}」，可选 ${LEVELS.join(' / ')}。` };
      }
      if (parts.length > 1) {
        return { kind: 'error', text: 'grill-level：一次只接受一个档位参数。' };
      }
      // `execute()` appends `command/run` *before* it calls the handler, and the
      // projection folds that record synchronously, so `current` already carries
      // the level this invocation just wrote. The level it replaced is read back
      // from the durable log rather than from in-memory bookkeeping: a reload of
      // this plugin resets any WeakMap, and guessing `off` from an empty cache
      // would silently turn a downgrade into a no-op.
      const current = ctx.sessionProjections.stateOf(session, PROJECTION_KEY) ?? EMPTY_STATE;
      const previous = previousState(session, current);
      if (previous.level === level) {
        return {
          kind: 'success',
          text: `澄清强度已经是 ${levelLabel(level)}（${level}）· 策略版本 v${current.version}，无需改动。`,
        };
      }
      let interrupted = false;
      if (RANK[level] < RANK[previous.level]) {
        const live = liveAgentFor(agent);
        if (live !== undefined && live.status === 'running') {
          live.cancel({ kind: 'user' });
          live.followup(pluginUserMessage(resumeText(current)));
          interrupted = true;
        }
      }
      return {
        kind: 'success',
        text: [
          `澄清强度已切换为 ${levelLabel(level)}（${level}）· 策略版本 v${current.version}。`,
          interrupted
            ? '已中断正在生成的旧档位回答，并按新档位重新排队恢复消息。'
            : '下一次模型请求即按新档位装配。',
        ].join(' '),
      };
    },
  });
}
