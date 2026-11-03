'use strict';
/* ---------- 管家工具按话题发送：每轮只带常用工具 + 跟最近几句话相关的组，省 token ---------- */
const TOOL_GROUPS = {
  base: { name: '常用', tools: ['get_overview', 'get_day', 'list_lessons', 'set_lesson_stars', 'add_study_log', 'remember', 'search_kb', 'load_tools'] },
  log: { name: '记录和规则', tools: ['delete_study_log', 'update_day', 'update_settings'],
    re: /删|记录|结算|起床|睡|精力|备注|系数|规则|门槛|小格|目标分钟|补记|记错|撤|减半|降|调整/ },
  schedule: { name: '课表日程', tools: ['get_week', 'add_event', 'update_event', 'delete_event', 'cancel_class'],
    re: /课表|日程|网课|停课|调课|上课|考试|训练|周[一二三四五六日天末]|星期|\d点|\d:\d\d|时段|下午|上午|晚上/ },
  goals: { name: '目标', tools: ['list_goals', 'create_goal', 'add_subgoals', 'update_goal', 'set_goal_done', 'delete_goal'],
    re: /目标|天内|之前|以前|前完成|拆|六级|四级|高分|截止|deadline|做完了|完成了/i },
  kb: { name: '知识库和卡片', tools: ['list_kb', 'read_doc', 'add_cards', 'update_card', 'save_to_kb'],
    re: /题|卡片|资料|文档|文件|知识库|笔记|讲义|提纲|手册|pdf|md|ppt|word|错|会了|不熟|熟悉|出处|存/i },
  review: { name: '复习', tools: ['list_review', 'generate_lesson_card'], re: /复习|该学|学什么|排|计划|讲义|学习卡|要点/ },
  daily: { name: '打卡图', tools: ['make_day_image'], re: /长图|打卡图|总结图|分享|生成.*图|导出/ },
  memory: { name: '记忆', tools: ['update_memory', 'forget'], re: /记忆|忘|记住|记得|不对|纠正|改一下|整理/ },
};

Chat.extra = new Set();
TOOLS.load_tools = {
  desc: '加载额外的工具组（本轮之后可用）。只在需要的工具不在当前列表里时调用。组：' +
    Object.entries(TOOL_GROUPS).filter(([k]) => k !== 'base').map(([k, g]) => `${k}=${g.name}`).join('，'),
  params: { groups: { type: 'array', items: { type: 'string', enum: Object.keys(TOOL_GROUPS).filter(k => k !== 'base') } } },
  required: ['groups'],
  run: a => {
    const ok = (a.groups || []).filter(g => TOOL_GROUPS[g]);
    ok.forEach(g => Chat.extra.add(g));
    return { ok: true, loaded: ok.flatMap(g => TOOL_GROUPS[g].tools) };
  },
};
TOOL_LABEL.load_tools = '加载工具';

// 选组：最近 3 条用户消息命中关键词的组；上下文里已经用过的工具所在的组；load_tools 请求过的组
function pickGroups(ctx) {
  const set = new Set(['base', ...(Chat.extra || [])]);
  const recent = ctx.filter(m => m.role === 'user').slice(-3).map(m => (m.content || '') + (m.imgDesc || '')).join('\n');
  for (const [k, g] of Object.entries(TOOL_GROUPS)) if (g.re && g.re.test(recent)) set.add(k);
  const used = new Set(ctx.flatMap(m => (m.tool_calls || []).map(t => t.function.name)));
  for (const [k, g] of Object.entries(TOOL_GROUPS)) if (g.tools.some(t => used.has(t))) set.add(k);
  if (ctx.some(m => m.img || (m.imgs && m.imgs.length) || m.files)) set.add('kb');
  return set;
}
Chat.tools = function (ctx) {
  const groups = pickGroups(ctx);
  const names = new Set([...groups].flatMap(g => TOOL_GROUPS[g].tools));
  if (ctx.some(m => m.img || (m.imgs && m.imgs.length))) names.add('view_image');
  if (Threads.cur && Threads.cur() !== 'main') names.add('name_thread');
  // 没归组的工具（以后新加的）默认都带上，免得漏
  const grouped = new Set(Object.values(TOOL_GROUPS).flatMap(g => g.tools).concat(['view_image', 'name_thread']));
  Object.keys(TOOLS).forEach(n => { if (!grouped.has(n)) names.add(n); });
  Chat.lastGroups = [...groups];
  return toolSpecs().filter(t => names.has(t.function.name));
};

const _sysTools = AGENT_SYS;
AGENT_SYS = function () {
  return _sysTools() + '\n- 工具按话题分组加载。需要的工具不在列表里（比如要改课表、建目标、改卡片），先调用 load_tools 加载对应组，再继续，不要说"做不到"。';
};
