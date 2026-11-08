/**
 * Browser half of `dsh-grill-level`.
 *
 * Exactly one surface, and it is the real one: a client command contribution.
 * The Host's `+` button and a typed `/` open the same menu
 * (`@deepseek-ai/dsh-client-ui-commands` binds one `/` source named "command"),
 * and every contribution that carries no `input.hint` lands in the empty-query
 * list under the "Commands" section. So this file adds a row to the `+` menu
 * without touching the menu's DOM, its ordering table, or the composer.
 *
 * The row opens a `popupSelect` shell (the same shell shipped `/permission`
 * and `/model` use); picking a level writes it through the Host command
 * `/grill-level <level>`, which is what makes the durable session record and
 * the projection advance. Nothing is mirrored in browser state: the picker
 * reads the projection the Host already folded, so a stale click cannot show a
 * level the runtime is not actually on.
 *
 * The contribution name must differ from the Host command name: `candidates()`
 * throws `ui-commands: contribution /<name> collides with a host command` when
 * a contribution shadows a catalog entry. The Host command is `grill-level`
 * (it owns the arguments and the diagnostics line), the browser row is `grill`.
 */

window.__ModuleLoader__.load({
	id: 'dsh-grill-level',
	factory: () => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' });

		/** Same order as lib/policy.js; weakest first. */
		const LEVELS = ['off', 'low', 'medium', 'high', 'full'];

		/** Row labels. Kept short because the menu row is one line. */
		const LABELS = { off: '关', low: '低', medium: '中', high: '高', full: '完全' };

		/** One-line behavior summary shown under the label in the picker. */
		const DETAILS = {
			off: '不注入、不调度，回到宿主原生交互',
			low: '默认直接执行，只在真正阻塞时澄清',
			medium: '会明显改变结果或导致返工的歧义先澄清',
			high: '非平凡任务默认先结构化澄清，再动手',
			full: '每轮回答前先确认未决决策，按需装载技能全文',
		};

		/** Projection key, matching lib/index.js. */
		const PROJECTION_KEY = 'grillLevel';

		/** Host command this picker writes through. */
		const HOST_COMMAND = 'grill-level';

		/** Services this half needs. */
		const inject = ['commandUi', 'sessions'];

		/**
		 * Read one session's grill level from the Host-folded projection.
		 * The face is always defined, so an unwritten session reads as `off`
		 * rather than throwing.
		 */
		function viewOf(sessions, session) {
			const live = sessions?.binding?.(session?.sessionId)?.session;
			const face = live?.projections?.faceOf?.(PROJECTION_KEY);
			return face?.getSnapshot?.();
		}

		/** Build the five picker rows with the live level marked active. */
		function optionsOf(view) {
			const current = LEVELS.includes(view?.level) ? view.level : 'off';
			const version = Number.isSafeInteger(view?.version) ? view.version : 0;
			return LEVELS.map((level) => ({
				id: level,
				label: LABELS[level],
				detail: `${DETAILS[level]}${level === current ? ` · 当前（策略版本 v${version}）` : ''}`,
				...(level === current ? { active: true } : {}),
			}));
		}

		/**
		 * Client plugin body.
		 * @param ctx - client root context.
		 */
		function apply(ctx) {
			const command = ctx.get('commandUi');
			const sessions = ctx.get('sessions') ?? ctx.sessions;
			if (command === undefined || sessions === undefined) return;

			ctx.effect(() => command.register({
				name: 'grill',
				label: () => 'Grill me 澄清强度',
				description: () => '五档：关 / 低 / 中 / 高 / 完全 · 仅对当前会话生效',
				available: () => true,
				ui: {
					kind: 'popupSelect',
					searchMode: 'substring',
					searchLabels: () => ({
						placeholder: '筛选档位',
						empty: '没有匹配的档位',
						noResults: '没有匹配的档位',
					}),
					options: async (session) => optionsOf(viewOf(sessions, session)),
					onSelect: async (option, session) => {
						const live = sessions.binding(session.sessionId)?.session;
						if (live === undefined) throw new Error('当前会话尚未建立，无法切换档位。');
						const result = await live.command(`/${HOST_COMMAND} ${option.id}`);
						if (!result.ok) {
							throw new Error(`档位切换失败：${result.error.code}: ${result.error.message}`);
						}
						if (!result.value.matched) throw new Error(`宿主没有提供 /${HOST_COMMAND} 命令。`);
					},
				},
			}), 'grill-level: + menu contribution');
		}

		exports.apply = apply;
		exports.inject = inject;
		return module.exports;
	},
});
