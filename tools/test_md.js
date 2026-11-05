// md() 渲染测试：node tools/test_md.js（build.py 不调用它，CI 会跑）
const fs = require('fs'), vm = require('vm');
const src = fs.readFileSync('web/ai.js', 'utf8');
const start = src.indexOf('function md(s)');
const end = src.indexOf('async function runAI');
const code = src.slice(start, end);
const ctx = { esc: s => String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'), scheduleMath() { ctx.mathCalled = true; } };
vm.createContext(ctx);
vm.runInContext(code + '\nthis.md = md;', ctx);
const md = ctx.md;
let fail = 0;
const ok = (name, cond, extra) => { if (!cond) { fail++; console.log('FAIL', name, extra ?? ''); } else console.log('ok  ', name); };

// 1 XSS 转义
let h = md('<img src=x onerror=alert(1)> **粗体**');
ok('no raw <img>', !h.includes('<img'), h);
ok('bold works', h.includes('<b>粗体</b>'), h);

// 2 代码块闭合
h = md('说明\n```js\nlet a = 1 < 2;\n**不加粗**\n```\n后面');
ok('code block present', h.includes('<pre class="mdcode"><code>let a = 1 &lt; 2;\n**不加粗**</code></pre>'), h);
ok('no bold inside code', !h.includes('<b>不加粗</b>'), h);

// 3 未闭合代码块（流式）
h = md('答案：\n```python\nprint(1)\nprint(2)');
ok('unclosed fence still a pre', h.includes('<pre class="mdcode"><code>print(1)\nprint(2)</code></pre>'), h);

// 4 行内代码
h = md('用 `x**2` 表示');
ok('inline code literal', h.includes('<code class="mdic">x**2</code>'), h);

// 5 表格
h = md('| 科目 | 分钟 |\n|---|---|\n| 数学 | 60 |\n| 英语 | 30 |\n\n结束');
ok('table thead', h.includes('<th>科目</th><th>分钟</th>'), h);
ok('table rows', h.includes('<td>数学</td><td>60</td>') && h.includes('<td>英语</td><td>30</td>'), h);
ok('paragraph after table', h.includes('<p>结束</p>'), h);

// 6 有序/无序列表、标题、引用、分隔线
h = md('## 标题\n- a\n- b\n1. 第一\n2) 第二\n> 引用\n---');
ok('heading', h.includes('<div class="mdh">标题</div>'), h);
ok('ul', h.includes('<ul><li>a</li><li>b</li></ul>'), h);
ok('ol', h.includes('<ol><li>第一</li><li>第二</li></ol>'), h);
ok('blockquote', h.includes('<blockquote>引用</blockquote>'), h);
ok('hr', h.includes('<hr>'), h);

// 7 公式不被改写（LaTeX 下划线/星号）
h = md('积分 $\int_0^1 x^2 dx$ 与 $$a*b*c$$');
ok('inline math placeholder', h.includes('data-tex="\int_0^1 x^2 dx"') && h.includes('data-display="0"'), h);
ok('display math placeholder', h.includes('data-tex="a*b*c"') && h.includes('data-display="1"'), h);
ok('math not italicised', !h.includes('<i>'), h);
ok('scheduleMath called', ctx.mathCalled === true);

// 8 链接白名单（只允许 http/https）
h = md('[点我](https://a.com/x) 和 [坏](javascript:alert(1))');
ok('https link', h.includes('<a href="https://a.com/x" target="_blank" rel="noopener">点我</a>'), h);
ok('javascript link not linkified', !h.includes('href="javascript'), h);

// 9 段落与换行
h = md('第一行\n第二行\n\n第三段');
ok('soft break', h.includes('<p>第一行<br>第二行</p>'), h);
ok('two paragraphs', h.includes('<p>第三段</p>'), h);

// 10 斜体不误伤乘号
h = md('2*3*4 = 24，*强调*文字');
ok('italic emphasis', h.includes('<i>强调</i>'), h);

// 11 空输入
ok('empty', md('') === '' && md(null) === '');

console.log(fail ? `\n${fail} 项失败` : '\n全部通过');
process.exit(fail ? 1 : 0);
