//! A complete Extism application: no calculator/game logic lives in the host.
use extism_pdk::*;
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use std::collections::BTreeMap;

fn button(id: &str, label: &str, primary: bool) -> Value {
    json!({"id":id,"label":label,"disabled":false,"primary":primary})
}
fn truncate(value: &str, bytes: usize) -> String {
    let mut end = value.len().min(bytes);
    while !value.is_char_boundary(end) {
        end -= 1;
    }
    value[..end].into()
}
fn toggle(board: u32, cell: usize) -> u32 {
    let mut mask = 1 << cell;
    if cell >= 5 {
        mask |= 1 << (cell - 5);
    }
    if cell < 20 {
        mask |= 1 << (cell + 5);
    }
    if cell % 5 > 0 {
        mask |= 1 << (cell - 1);
    }
    if cell % 5 < 4 {
        mask |= 1 << (cell + 1);
    }
    board ^ mask
}
#[derive(Default, Serialize, Deserialize)]
#[serde(default, deny_unknown_fields)]
struct Lab {
    tab: String,
    text: String,
    mode: String,
    compact: bool,
    stats: Vec<Value>,
    words: Vec<Vec<String>>,
    result: String,
    files: Vec<Vec<String>>,
    network: Vec<Vec<String>>,
    network_status: String,
    board: u32,
    solution: u32,
    moves: u32,
    level: usize,
    history: Vec<usize>,
    todo_input: String,
    due: String,
    nickname: String,
    status: String,
}
impl Lab {
    fn puzzle(&mut self) {
        let patterns: [&[usize]; 3] = [
            &[7, 12, 17],
            &[1, 6, 13, 17, 24],
            &[0, 3, 6, 9, 12, 15, 18, 21],
        ];
        self.board = 0;
        self.solution = 0;
        for &cell in patterns[self.level % 3] {
            self.board = toggle(self.board, cell);
            self.solution ^= 1 << cell;
        }
        self.moves = 0;
        self.history.clear();
    }
    fn analyze(&mut self, source: &str, zh: bool) {
        let words: Vec<_> = source.split_whitespace().collect();
        self.stats = vec![
            json!({"label":if zh {"字符"} else {"Characters"},"value":source.chars().count().to_string()}),
            json!({"label":if zh {"词 / 空格分隔"} else {"Words / whitespace"},"value":words.len().to_string()}),
            json!({"label":if zh {"行"} else {"Lines"},"value":source.lines().count().to_string()}),
            json!({"label":"UTF-8 bytes","value":source.len().to_string()}),
        ];
        let mut counts = BTreeMap::new();
        for word in words {
            let word = word
                .trim_matches(|ch: char| !ch.is_alphanumeric())
                .to_lowercase();
            if !word.is_empty() {
                *counts.entry(truncate(&word, 120)).or_insert(0_u32) += 1;
            }
        }
        let mut counts: Vec<_> = counts.into_iter().collect();
        counts.sort_by(|a, b| b.1.cmp(&a.1).then(a.0.cmp(&b.0)));
        self.words = counts
            .into_iter()
            .take(8)
            .map(|(word, count)| vec![word, count.to_string()])
            .collect();
        self.result = truncate(&self.transform(source), 32000);
    }
    fn transform(&self, source: &str) -> String {
        match self.mode.as_str() {
            "upper" => source.to_uppercase(),
            "lower" => source.to_lowercase(),
            "trim" => source.lines().map(str::trim).collect::<Vec<_>>().join("\n"),
            _ => source.into(),
        }
    }
}

#[plugin_fn]
pub fn lab(input: String) -> FnResult<String> {
    let request: Value = serde_json::from_str(&input)?;
    let zh = request["locale"] == "zh-CN";
    let tr = |cn: &str, en: &str| if zh { cn.to_owned() } else { en.to_owned() };
    let raw = request["state"].as_str().unwrap_or("");
    let mut state: Lab = if raw.is_empty() {
        let mut state = Lab {
            tab: "overview".into(),
            text: tr(
                "Hello Extism!\n用 Rust、JavaScript 或 TypeScript 编写同一种扩展。\nHello reusable plugins.",
                "Hello Extism!\nBuild the same plugin with Rust, JavaScript or TypeScript.\nHello reusable plugins.",
            ),
            mode: "upper".into(),
            ..Lab::default()
        };
        state.puzzle();
        state
    } else {
        serde_json::from_str(raw)?
    };
    if !["overview", "text", "data", "todo", "game", "about"].contains(&state.tab.as_str())
        || state.text.len() > 65536
        || state.todo_input.len() > 1000
        || state.nickname.len() > 120
        || state.due.len() > 10
        || state.result.len() > 65536
        || state.words.len() > 8
        || state.files.len() > 16
        || state.network.len() > 12
        || state.history.len() > 100
        || state.board >= (1 << 25)
        || state.solution >= (1 << 25)
        || state.level > 2
        || state.history.iter().any(|cell| *cell >= 25)
    {
        return Err(Error::msg("Invalid lab state").into());
    }
    let fields = &request["fields"];
    if let Some(text) = fields["text"].as_str() {
        state.text = truncate(text, 65536);
    }
    if let Some(mode) = fields["mode"].as_str() {
        if ["upper", "lower", "trim", "original"].contains(&mode) {
            state.mode = mode.into();
        }
    }
    if let Some(compact) = fields["compact"].as_str() {
        state.compact = compact == "true";
    }
    let mut effects = Vec::<Value>::new();
    let mut errors = BTreeMap::<String, String>::new();
    let mut artifacts = Vec::<Value>::new();
    let host = &request["host"];
    let has_permission = |permission: &str| {
        host["permissions"]
            .as_array()
            .is_some_and(|items| items.iter().any(|item| item == permission))
    };
    let storage = &host["storage"];
    let values = &storage["values"];
    let todos:Vec<Value> = values["todos"].as_array().into_iter().flatten().take(50).filter_map(|item| {
        let text=item["text"].as_str()?;
        Some(json!({"text":truncate(text,1000),"due":truncate(item["due"].as_str().unwrap_or(""),10),"completed":item["completed"].as_bool().unwrap_or(false)}))
    }).collect();
    if let Some(value) = fields["todo"].as_str() {
        state.todo_input = truncate(value, 1000);
    }
    if let Some(value) = fields["due"].as_str() {
        state.due = truncate(value, 10);
    }
    if let Some(value) = fields["nickname"].as_str() {
        state.nickname = truncate(value, 120);
    }
    if raw.is_empty() {
        state.nickname = truncate(values["nickname"].as_str().unwrap_or(""), 120);
    }
    let action = request["action"].as_str().unwrap_or("");
    if let Some(tab) = action.strip_prefix("tab-") {
        if ["overview", "text", "data", "todo", "game", "about"].contains(&tab) {
            state.tab = tab.into();
        }
    }
    match action {
        "host-result" => {
            if let Some(results) = request["results"].as_array() {
                for result in results {
                    if !result["error"].is_null() {
                        state.status = format!(
                            "{}: {}",
                            tr("宿主操作失败", "Host operation failed"),
                            result["error"]["code"].as_str().unwrap_or("unknown")
                        );
                    } else if result["id"] == "fetch-todo" {
                        let value = &result["value"];
                        state.network_status = format!(
                            "HTTP {} · {}",
                            value["status"],
                            value["url"].as_str().unwrap_or("")
                        );
                        state.network = match serde_json::from_str::<Value>(
                            value["body"].as_str().unwrap_or(""),
                        ) {
                            Ok(Value::Object(object)) => object
                                .into_iter()
                                .take(12)
                                .map(|(key, value)| {
                                    vec![truncate(&key, 120), truncate(&value.to_string(), 480)]
                                })
                                .collect(),
                            _ => vec![vec![
                                "body".into(),
                                truncate(value["body"].as_str().unwrap_or(""), 480),
                            ]],
                        };
                        state.status.clear();
                    } else if result["id"] == "save-todos"
                        || result["id"] == "add-task"
                        || result["id"] == "save-preference"
                    {
                        state.status = tr(
                            "已保存到此扩展的私有存储",
                            "Saved to this extension's private storage",
                        );
                        if result["id"] == "add-task" {
                            state.todo_input.clear();
                        }
                    }
                }
            }
        }
        "fetch-todo" => {
            state.tab = "data".into();
            if has_permission("network:https") {
                effects.push(json!({"kind":"http","id":"fetch-todo","request":{"url":"https://jsonplaceholder.typicode.com/todos/1","method":"GET","headers":{},"body":null,"credential":null}}));
            } else {
                state.status = tr(
                    "请在扩展权限中允许 HTTPS 后重试",
                    "Allow HTTPS in extension permissions and retry",
                );
            }
        }
        "todo-add" => {
            if state.todo_input.trim().is_empty() {
                errors.insert("todo".into(), tr("请输入待办内容", "Enter a task"));
            } else if todos.len() >= 50 {
                errors.insert(
                    "todo".into(),
                    tr("最多保存 50 项待办", "Up to 50 tasks can be saved"),
                );
            } else if has_permission("storage") {
                let mut updated = todos.clone();
                updated.push(
                    json!({"text":state.todo_input.trim(),"due":state.due,"completed":false}),
                );
                effects.push(json!({"kind":"storage","id":"add-task","expectedRevision":storage["revision"].as_i64().unwrap_or(0),"changes":{"todos":updated}}));
            } else {
                state.status = tr(
                    "请允许扩展私有存储后重试",
                    "Allow private extension storage and retry",
                );
            }
        }
        "todo-clear" if has_permission("storage") => {
            effects.push(json!({"kind":"storage","id":"save-todos","expectedRevision":storage["revision"].as_i64().unwrap_or(0),"changes":{"todos":[]}}));
        }
        "preference-save" if has_permission("storage") => {
            effects.push(json!({"kind":"storage","id":"save-preference","expectedRevision":storage["revision"].as_i64().unwrap_or(0),"changes":{"nickname":state.nickname}}));
        }
        "export-text" => {
            artifacts.push(json!({"name":"transformed.txt","mediaType":"text/plain","encoding":"utf8","content":state.transform(&state.text)}));
        }

        "analyze" => {
            let text = state.text.clone();
            state.analyze(&text, zh);
        }
        "sample" => {
            state.text = tr(
                "Rust is fast. Wasm is portable.\nRust 与 Wasm 让插件复用。\nOne runtime, many languages.",
                "Rust is fast. Wasm is portable.\nRust and Wasm make plugins reusable.\nOne runtime, many languages.",
            );
            let text = state.text.clone();
            state.analyze(&text, zh);
        }
        "clear" => {
            state.text.clear();
            state.stats.clear();
            state.words.clear();
            state.result.clear();
        }
        "host-data" => {
            let data = &request["data"];
            let mut text = data["inputText"].as_str().unwrap_or("").to_owned();
            state.files.clear();
            if let Some(files) = data["files"].as_array() {
                for file in files.iter().take(16) {
                    let content = file["content"].as_str().unwrap_or("");
                    let utf8 = file["encoding"] == "utf8";
                    let size = if utf8 {
                        content.len()
                    } else {
                        (content.len() / 4 * 3).saturating_sub(
                            content.chars().rev().take_while(|ch| *ch == '=').count(),
                        )
                    };
                    state.files.push(vec![
                        truncate(file["name"].as_str().unwrap_or(""), 180),
                        truncate(
                            file["mediaType"]
                                .as_str()
                                .unwrap_or("application/octet-stream"),
                            120,
                        ),
                        size.to_string(),
                        if utf8 {
                            content.lines().count().to_string()
                        } else {
                            "—".into()
                        },
                    ]);
                    if utf8 {
                        text.push('\n');
                        text.push_str(content);
                    }
                }
            }
            if !text.trim().is_empty() {
                state.text = truncate(&text, 65536);
                state.analyze(&text, zh);
            }
            state.tab = "data".into();
        }
        "restart" => state.puzzle(),
        "next" => {
            state.level = (state.level + 1) % 3;
            state.puzzle();
        }
        "undo" => {
            if let Some(cell) = state.history.pop() {
                state.board = toggle(state.board, cell);
                state.solution ^= 1 << cell;
                state.moves = state.moves.saturating_sub(1);
            }
        }
        "hint" if state.board != 0 && state.solution != 0 && state.history.len() < 100 => {
            let cell = state.solution.trailing_zeros() as usize;
            state.history.push(cell);
            state.board = toggle(state.board, cell);
            state.solution ^= 1 << cell;
            state.moves += 1;
        }
        _ if action.starts_with("todo-toggle-") || action.starts_with("todo-remove-") => {
            if has_permission("storage") {
                let toggle = action.starts_with("todo-toggle-");
                let prefix = if toggle {
                    "todo-toggle-"
                } else {
                    "todo-remove-"
                };
                if let Some(index) = action
                    .strip_prefix(prefix)
                    .and_then(|s| s.parse::<usize>().ok())
                    .filter(|index| *index < todos.len())
                {
                    let mut updated = todos.clone();
                    if toggle {
                        updated[index]["completed"] =
                            json!(!updated[index]["completed"].as_bool().unwrap_or(false));
                    } else {
                        updated.remove(index);
                    }
                    effects.push(json!({"kind":"storage","id":"save-todos","expectedRevision":storage["revision"].as_i64().unwrap_or(0),"changes":{"todos":updated}}));
                }
            } else {
                state.status = tr(
                    "请允许扩展私有存储后重试",
                    "Allow private extension storage and retry",
                );
            }
        }
        _ => {
            if let Some(cell) = action
                .strip_prefix("cell-")
                .and_then(|s| s.parse::<usize>().ok())
            {
                if cell < 25 && state.board != 0 && state.history.len() < 100 {
                    state.history.push(cell);
                    state.board = toggle(state.board, cell);
                    state.solution ^= 1 << cell;
                    state.moves += 1;
                }
            }
        }
    }
    let tabs: Vec<_> = [
        ("overview", tr("总览", "Overview")),
        ("text", tr("文本工坊", "Text studio")),
        ("data", tr("数据连接", "Data explorer")),
        ("todo", tr("待办与偏好", "Tasks & preferences")),
        ("game", tr("点灯解谜", "Lights out")),
        ("about", tr("开发协议", "Developer")),
    ]
    .into_iter()
    .map(|(id, label)| json!({"id":format!("tab-{id}"),"label":label,"active":state.tab==id}))
    .collect();
    let mut view_fields = vec![];
    let mut groups = vec![];
    let mut blocks = vec![];
    let (display, description) = match state.tab.as_str() {
        "text" => {
            view_fields.push(json!({"id":"text","label":tr("编辑文本","Edit text"),"value":state.text,"kind":"textarea","maxBytes":65536}));
            view_fields.push(json!({"id":"mode","label":tr("转换方式","Transform"),"value":state.mode,"kind":"select","options":[
                {"value":"upper","label":tr("转大写","UPPERCASE")},{"value":"lower","label":tr("转小写","lowercase")},{"value":"trim","label":tr("修剪每行空白","Trim each line")},{"value":"original","label":tr("保留原文","Original")}
            ]}));
            view_fields.push(json!({"id":"compact","label":tr("只显示统计，收起转换预览","Statistics only, hide transformed preview"),"value":state.compact.to_string(),"kind":"checkbox"}));
            groups.push(json!({"columns":2,"actions":[button("analyze",&tr("分析文本","Analyze"),true),button("sample",&tr("载入样例","Load sample"),false),button("clear",&tr("清空","Clear"),false),button("export-text",&tr("生成结果文件","Generate result file"),false)]}));
            if !state.stats.is_empty() {
                blocks.push(json!({"kind":"metrics","items":state.stats}));
            }
            if !state.words.is_empty() {
                blocks.push(json!({"kind":"chart","chartType":"bar","label":tr("词频","Word frequency"),"labels":state.words.iter().map(|row|row[0].clone()).collect::<Vec<_>>(),"series":[{"label":tr("次数","Count"),"values":state.words.iter().map(|row|row[1].parse::<u32>().unwrap_or(0)).collect::<Vec<_>>()}]}));
                blocks.push(json!({"kind":"table","columns":[tr("高频词","Top words"),tr("出现次数","Count")],"rows":state.words}));
            }
            if !state.result.is_empty() && !state.compact {
                // Indented code keeps arbitrary user Markdown as literal content.
                blocks.push(json!({"kind":"markdown","text":format!("### {}\n\n{}",tr("转换预览（最多 32000 字节）","Transformed preview (up to 32000 bytes)"),state.result.lines().map(|line|format!("    {line}")).collect::<Vec<_>>().join("\n"))}));
            }
            (
                tr("让文本成为数据", "Make sense of text"),
                tr(
                    "输入、选择、复选、指标和表格都由同一个 Wasm 返回。下方可发送已授权文件，统计处理完整输入，预览有界。",
                    "Inputs, selects, checkboxes, metrics and tables all come from the same Wasm. Send authorized files below; analysis uses the full input, preview is bounded.",
                ),
            )
        }
        "data" => {
            groups.push(json!({"columns":1,"actions":[button("fetch-todo",&tr("请求真实 HTTPS 数据","Fetch live HTTPS data"),true)]}));
            if !state.status.is_empty() {
                blocks.push(json!({"kind":"markdown","text":state.status}));
            }
            blocks.push(json!({"kind":"markdown","text":tr("### 连接真实数据\n\n点击 **请求真实 HTTPS 数据**，插件声明的 GET 请求由宿主代理执行；也可在下方 **宿主数据** 发送已选文本或二进制文件。\n\n可试用 `https://jsonplaceholder.typicode.com/todos/1`。插件获得有界响应，不持有系统路径、凭据或网络句柄。","### Connect real data\n\nUse **Fetch live HTTPS data** to let the host broker execute a declared GET request; use **Host data** below to send selected text or binary files.\n\nTry `https://jsonplaceholder.typicode.com/todos/1`. The plugin gets a bounded response, with no system paths, credentials or network handles.")}));
            if !state.files.is_empty() {
                blocks.push(json!({"kind":"table","columns":[tr("已发送文件","Sent file"),"MIME","Bytes",tr("文本行数","Text lines")],"rows":state.files}));
            }
            if !state.network.is_empty() {
                blocks.push(json!({"kind":"table","columns":[tr("JSON 字段","JSON field"),tr("值","Value")],"rows":state.network}));
            }
            (
                tr("文件与 HTTPS", "Files & HTTPS"),
                if state.network_status.is_empty() {
                    tr(
                        "每次数据交付由你发起；切换页面或点击游戏不会触发网络请求。",
                        "You initiate every transfer. Switching tabs or playing never starts a network request.",
                    )
                } else {
                    state.network_status.clone()
                },
            )
        }
        "todo" => {
            view_fields.push(json!({"id":"todo","label":tr("待办内容","Task"),"value":state.todo_input,"kind":"text","maxBytes":1000}));
            view_fields.push(json!({"id":"due","label":tr("截止日期（可选）","Due date (optional)"),"value":state.due,"kind":"date","maxBytes":10}));
            view_fields.push(json!({"id":"nickname","label":tr("昵称偏好","Preferred nickname"),"value":state.nickname,"kind":"text","maxBytes":120}));
            groups.push(json!({"columns":3,"actions":[button("todo-add",&tr("添加并保存","Add & save"),true),button("todo-clear",&tr("清空待办","Clear tasks"),false),button("preference-save",&tr("保存偏好","Save preference"),false)]}));
            blocks.push(json!({"kind":"markdown","text":tr("### 重启后仍然保留\n\n待办与偏好使用插件私有存储。写入带 revision，多个窗口同时保存时会报告冲突，避免静默覆盖。拒绝存储权限时，其他离线页签仍可使用。","### Keep your work across restarts\n\nTasks and preferences use private extension storage. Revision-checked writes report concurrent changes rather than silently overwriting another window. Other offline tabs remain available without storage permission.")}));
            if !todos.is_empty() {
                blocks.push(json!({"kind":"table","columns":[tr("任务","Task"),tr("截止日期","Due"),tr("状态","Status")],"rows":todos.iter().map(|item|vec![item["text"].as_str().unwrap_or("").to_owned(),item["due"].as_str().unwrap_or("").to_owned(),if item["completed"].as_bool().unwrap_or(false) {tr("已完成","Done")} else {tr("待办","Pending")}]).collect::<Vec<_>>()}));
                let mut actions = Vec::new();
                for (index, item) in todos.iter().take(50).enumerate() {
                    let title = truncate(item["text"].as_str().unwrap_or(""), 60);
                    let toggle = if item["completed"].as_bool().unwrap_or(false) {
                        tr("恢复", "Reopen")
                    } else {
                        tr("完成", "Complete")
                    };
                    actions.push(button(
                        &format!("todo-toggle-{index}"),
                        &format!("{toggle}: {title}"),
                        false,
                    ));
                    actions.push(button(
                        &format!("todo-remove-{index}"),
                        &format!("{}: {title}", tr("删除", "Remove")),
                        false,
                    ));
                }
                groups.push(json!({"columns":2,"actions":actions}));
            }
            blocks.push(json!({"kind":"progress","label":tr("完成进度","Tasks completed"),"value":todos.iter().filter(|item|item["completed"]==true).count(),"max":todos.len().max(1)}));
            (
                tr("有记忆的扩展", "An extension with memory"),
                state.status.clone(),
            )
        }
        "game" => {
            let actions: Vec<_> = (0..25).map(|cell| {
                let on = state.board & (1 << cell) != 0;
                let label = format!("{} {}, {}",tr("格","Cell"), cell+1,tr(if on {"亮"} else {"灭"},if on {"on"} else {"off"}));
                json!({"id":format!("cell-{cell}"),"label":if on {"●"} else {"○"},"ariaLabel":label,"primary":on,"disabled":state.board==0 || state.history.len()>=100})
            }).collect();
            groups.push(json!({"columns":5,"board":true,"actions":actions}));
            let mut undo = button("undo", &tr("撤销", "Undo"), false);
            undo["disabled"] = json!(state.history.is_empty());
            let mut hint = button("hint", &tr("提示一步", "Hint"), false);
            hint["disabled"] =
                json!(state.board == 0 || state.solution == 0 || state.history.len() >= 100);
            groups.push(json!({"columns":4,"actions":[undo,hint,button("restart",&tr("重新开始","Restart"),false),button("next",&tr("下一关","Next"),true)]}));
            blocks.push(json!({"kind":"metrics","items":[{"label":tr("关卡","Puzzle"),"value":format!("{} / 3",state.level+1)},{"label":tr("已走步数","Moves"),"value":state.moves.to_string()},{"label":tr("剩余亮灯","Lights on"),"value":state.board.count_ones().to_string()}]}));
            blocks.push(json!({"kind":"markdown","text":tr("**规则**：点击一格会切换它和上下左右邻格的灯，熄灭所有灯即获胜。支持键盘 Tab / Enter，提示会执行一步可行解，撤销可回退。\n\n棋盘、关卡、胜负、撤销和提示算法全部在插件内运行。","**Rules:** A cell toggles itself and its four neighbors. Turn every light off to win. Use Tab / Enter, a hint for a solving move, or Undo.\n\nThe board, puzzles, win detection, undo and hint algorithms all run inside the plugin.")}));
            (
                if state.board == 0 {
                    tr("漂亮，全部熄灭！", "Brilliant. All lights out!")
                } else {
                    tr("把每一盏灯熄灭", "Turn every light off")
                },
                tr(
                    "一个有规则、有解法、有进度的完整小游戏。",
                    "A complete puzzle with rules, solutions and progress.",
                ),
            )
        }
        "about" => {
            blocks.push(json!({"kind":"markdown","text":tr("### 一份插件，多种语言\n\n使用 **Extism PDK** 将 Rust / JavaScript / TypeScript 编译成 Wasm。清单 v3 为每条命令声明输入输出、入口和权限，API v2 使用同一 JSON 协议。\n\n- **贡献入口**：侧栏、命令面板、独立系统窗口。\n- **宿主视图**：页签、表单与字段错误、按钮、指标、分页表格、图表、进度、内嵌图片和安全 Markdown。\n- **能力**：用户选择的文件、声明 HTTPS 服务、隔离私有存储、用户确认保存的结果文件。\n- **交互协议**：Wasm 返回 effects，宿主验证权限并执行，再以 `host-result` 回传结果；插件始终不持有原生路径或凭据。\n- **会话与数据**：窗口会话可导入导出；长期业务数据放私有存储，以 revision 避免并发覆盖。\n\n完整源码在 `examples/extensions/apps/`，开发文档位于扩展中心。","### One plugin, many languages\n\nCompile Rust / JavaScript / TypeScript to Wasm with an **Extism PDK**. Manifest v3 declares formats, surfaces and permissions per command; API v2 uses one JSON protocol.\n\n- **Entrypoints**: sidebar, command palette and native windows.\n- **Views**: tabs, fields and validation errors, buttons, metrics, paginated tables, charts, progress, embedded images and safe Markdown.\n- **Capabilities**: selected files, declared HTTPS services, private storage and result files saved by the user.\n- **Effects**: Wasm requests effects; the host validates grants, executes them and returns `host-result`. Native paths and credentials remain with the host.\n- **Sessions and data**: import/export window sessions; persist long-lived data in revision-checked private storage.\n\nFull source: `examples/extensions/apps/`. Open the extension center for developer docs.")}));
            (
                tr("从这里开发你的扩展", "Build your extension"),
                tr(
                    "这整页也是扩展返回的数据，宿主没有实验室专用渲染逻辑。",
                    "This page is plugin data too. The host has no lab-specific rendering logic.",
                ),
            )
        }
        _ => {
            blocks.push(json!({"kind":"metrics","items":[{"label":tr("运行时","Runtime"),"value":"Extism / Wasm"},{"label":tr("界面入口","Surfaces"),"value":tr("页面 + 窗口","Page + window")},{"label":tr("宿主数据权限","Host permissions"),"value":"4"}]}));
            blocks.push(json!({"kind":"markdown","text":tr("### 不止一个按钮示例\n\n这是一个真正安装的扩展。切换上方页签，体验不同界面和数据能力。\n\n**文本工坊** — 编辑、转换与分析；字符统计和高频词表由 Wasm 计算。\n\n**数据连接** — 向插件发送指定文件或公共 HTTPS 响应，展示真实授权边界。\n\n**待办与偏好** — 私有存储、并发冲突保护、字段校验和完成进度。\n\n**点灯解谜** — 5 × 5 棋盘、三关、撤销和提示，展示连续状态与通用棋盘布局。\n\n**开发协议** — 查看清单片段和可复用能力。右上角可在独立系统窗口打开，主窗口继续使用。","### More than a button demo\n\nThis is a real installed extension. Explore the tabs above.\n\n**Text studio** — edit, transform and analyze; Wasm computes statistics and word frequencies.\n\n**Data explorer** — send specific files or public HTTPS responses through explicit permissions.\n\n**Tasks & preferences** — private storage, revision conflicts, validation and progress.\n\n**Lights out** — a 5 × 5 board, three puzzles, undo and hints demonstrate state and reusable board layouts.\n\n**Developer** — inspect the manifest and reusable capabilities. Open a native window from the page header and keep using the main window.")}));
            (
                tr("扩展实验室", "Extension Lab"),
                tr(
                    "在一个应用里，探索扩展能做到什么。",
                    "Explore what an extension can do, in one app.",
                ),
            )
        }
    };
    let serialized_state = serde_json::to_string(&state)?;
    if serialized_state.len() > 256 * 1024 {
        return Err(Error::msg("Lab session exceeds state budget").into());
    }
    Ok(json!({"version":2,"state":serialized_state,"display":display,"description":description,"tabs":tabs,"fields":view_fields,"groups":groups,"blocks":blocks,"errors":errors,"effects":effects,"artifacts":artifacts}).to_string())
}
