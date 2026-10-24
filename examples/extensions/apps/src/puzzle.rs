use serde::{Deserialize, Serialize};
use serde_json::{Value, json};

const CELLS: usize = 25;
const BOARD_MASK: u32 = (1 << CELLS) - 1;
const MAX_MOVES: usize = 100;
const PATTERNS: [&[usize]; 6] = [
    &[7, 12, 17],
    &[1, 6, 13, 17, 24],
    &[0, 3, 6, 9, 12, 15, 18, 21],
    &[0, 4, 12, 20, 24],
    &[1, 3, 5, 9, 11, 13, 15, 19, 21, 23],
    &[0, 1, 2, 7, 12, 17, 22, 23, 24, 19, 14, 9, 4],
];

#[derive(Serialize, Deserialize, Debug, Clone, Eq, PartialEq)]
#[serde(default, deny_unknown_fields)]
pub(crate) struct Puzzle {
    pub(crate) board: u32,
    pub(crate) solution: u32,
    pub(crate) moves: u32,
    pub(crate) level: usize,
    pub(crate) history: Vec<usize>,
}

impl Default for Puzzle {
    fn default() -> Self {
        Self::start(0)
    }
}

fn toggle(board: u32, cell: usize) -> u32 {
    let mut mask = 1 << cell;
    if cell >= 5 {
        mask |= 1 << (cell - 5);
    }
    if cell < 20 {
        mask |= 1 << (cell + 5);
    }
    if !cell.is_multiple_of(5) {
        mask |= 1 << (cell - 1);
    }
    if cell % 5 < 4 {
        mask |= 1 << (cell + 1);
    }
    board ^ mask
}

fn button(id: &str, label: String, primary: bool, disabled: bool) -> Value {
    json!({"id":id,"label":label,"primary":primary,"disabled":disabled})
}

impl Puzzle {
    fn start(level: usize) -> Self {
        let mut state = Self {
            board: 0,
            solution: 0,
            moves: 0,
            level,
            history: Vec::new(),
        };
        for &cell in PATTERNS[level] {
            state.board = toggle(state.board, cell);
            state.solution ^= 1 << cell;
        }
        state
    }

    /// An imported board must be exactly the result of replaying its legal moves.
    pub(crate) fn validate(&self) -> Result<(), String> {
        if self.level >= PATTERNS.len()
            || self.board & !BOARD_MASK != 0
            || self.solution & !BOARD_MASK != 0
            || self.history.len() > MAX_MOVES
            || self.moves as usize != self.history.len()
            || self.history.iter().any(|&cell| cell >= CELLS)
        {
            return Err("Invalid puzzle bounds / 解谜状态超出范围".into());
        }
        let mut expected = Self::start(self.level);
        for &cell in &self.history {
            if expected.board == 0 {
                return Err("Puzzle history continues after victory / 获胜后仍有落子记录".into());
            }
            expected.press(cell);
        }
        if expected.board != self.board || expected.solution != self.solution {
            return Err("Puzzle does not match its move history / 棋盘与落子记录不一致".into());
        }
        Ok(())
    }

    fn press(&mut self, cell: usize) {
        self.history.push(cell);
        self.board = toggle(self.board, cell);
        self.solution ^= 1 << cell;
        self.moves += 1;
    }

    /// Returns whether this is a puzzle action, including disabled/no-op actions.
    pub(crate) fn act(&mut self, action: &str) -> bool {
        match action {
            "restart" => *self = Self::start(self.level),
            "next" => *self = Self::start((self.level + 1) % PATTERNS.len()),
            "undo" => {
                if let Some(cell) = self.history.pop() {
                    self.board = toggle(self.board, cell);
                    self.solution ^= 1 << cell;
                    self.moves -= 1;
                }
            }
            "hint" => {
                if self.board != 0 && self.solution != 0 && self.history.len() < MAX_MOVES {
                    self.press(self.solution.trailing_zeros() as usize);
                }
            }
            _ => {
                let Some(suffix) = action.strip_prefix("cell-") else {
                    return false;
                };
                let Some(cell) = suffix.parse::<usize>().ok().filter(|&cell| cell < CELLS) else {
                    return false;
                };
                if self.board != 0 && self.history.len() < MAX_MOVES {
                    self.press(cell);
                }
            }
        }
        true
    }

    pub(crate) fn render(&self, zh: bool) -> (String, String, Vec<Value>, Vec<Value>) {
        let tr = |cn: &str, en: &str| if zh { cn.to_owned() } else { en.to_owned() };
        let names = [
            ("交叉火花", "Cross sparks"),
            ("散落星光", "Scattered stars"),
            ("斜线回声", "Diagonal echoes"),
            ("四角与中心", "Corners and center"),
            ("棋盘节奏", "Checkerboard rhythm"),
            ("光之回廊", "Corridor of light"),
        ];
        let (cn, en) = names[self.level];
        let won = self.board == 0;
        let at_limit = self.history.len() >= MAX_MOVES;
        let actions: Vec<_> = (0..CELLS)
            .map(|cell| {
                let on = self.board & (1 << cell) != 0;
                json!({
                    "id":format!("cell-{cell}"),
                    "label":if on {"●"} else {"○"},
                    "ariaLabel":if zh {
                        format!("第 {} 行，第 {} 列，{}",cell/5+1,cell%5+1,if on {"亮"} else {"灭"})
                    } else {
                        format!("Row {}, column {}, {}",cell/5+1,cell%5+1,if on {"on"} else {"off"})
                    },
                    "primary":on,
                    "disabled":won || at_limit
                })
            })
            .collect();
        let next_label = if self.level + 1 == PATTERNS.len() {
            tr("回到第一关", "Back to puzzle 1")
        } else if won {
            tr("挑战下一关", "Play next puzzle")
        } else {
            tr("跳至下一关", "Skip to next puzzle")
        };
        let groups = vec![
            json!({"columns":5,"board":true,"actions":actions}),
            json!({"columns":4,"actions":[
                button("undo",tr("撤销一步","Undo"),false,self.history.is_empty()),
                button("hint",tr("执行解步","Play a hint"),false,won || self.solution==0 || at_limit),
                button("restart",tr("重玩本关","Restart"),false,false),
                button("next",next_label,won,false)
            ]}),
        ];
        let mut blocks = vec![
            json!({"kind":"metrics","items":[
                {"label":tr("关卡","Puzzle"),"value":format!("{} / {}",self.level+1,PATTERNS.len())},
                {"label":tr("已走步数","Moves"),"value":self.moves.to_string()},
                {"label":tr("亮灯数量","Lights on"),"value":self.board.count_ones().to_string()},
                {"label":tr("可行解剩余步数","Moves in a known solution"),"value":if won {0} else {self.solution.count_ones()}.to_string()}
            ]}),
            json!({"kind":"markdown","text":tr(
                "**目标：熄灭全部 25 格灯。** ● 表示亮灯，○ 表示熄灭。每次点击会同时切换该格与它上、下、左、右的相邻格，边缘不会绕到另一侧。\n\n**执行解步** 会直接走一步可行解，也计入步数；它不是最优步数提示。点错可 **撤销一步**，也可 **重玩本关**。获胜后挑战下一关，六关均可解。支持键盘 Tab 选择、Enter / 空格落子。",
                "**Goal: turn off all 25 lights.** ● means on and ○ means off. Each move toggles the selected cell and its immediate neighbors above, below, left and right. Edges never wrap.\n\n**Play a hint** makes one move from a known solution and counts as a move; it does not promise the shortest solution. Use **Undo** or **Restart** to experiment. After winning, continue to the next of six solvable puzzles. Use Tab to focus a cell and Enter / Space to play."
            )}),
        ];
        if at_limit && !won {
            blocks.push(json!({"kind":"markdown","text":tr(
                "已达到本局 100 步上限。请撤销几步或重玩本关；进度仍保留。",
                "This attempt reached its 100-move limit. Undo some moves or restart this puzzle; your current progress is preserved."
            )}));
        }
        let description = format!(
            "{} · {} / {}{}",
            tr(cn, en),
            self.level + 1,
            PATTERNS.len(),
            if won {
                tr(
                    " · 点击下方按钮继续挑战",
                    " · Use the button below to keep playing",
                )
            } else {
                String::new()
            }
        );
        (
            if won {
                tr("全部熄灭，挑战成功！", "All lights out. Puzzle solved!")
            } else {
                tr("让星光安静下来", "Let the lights go quiet")
            },
            description,
            groups,
            blocks,
        )
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn every_level_can_be_solved_with_hints_and_undo_restores_victory() {
        for level in 0..PATTERNS.len() {
            let mut puzzle = Puzzle::start(level);
            assert_ne!(puzzle.board, 0);
            let initial = puzzle.clone();
            let mut before_last = initial.clone();
            while puzzle.board != 0 {
                before_last = puzzle.clone();
                assert!(puzzle.moves < 25);
                assert!(puzzle.act("hint"));
                assert!(puzzle.validate().is_ok());
            }
            let won = puzzle.clone();
            assert!(puzzle.act("cell-0"));
            assert_eq!(puzzle, won);
            puzzle.act("undo");
            assert_eq!(puzzle, before_last);
            puzzle.act("hint");
            assert_eq!(puzzle, won);
            puzzle.act("restart");
            assert_eq!(puzzle, initial);
        }
    }

    #[test]
    fn repeated_clicks_cancel_and_undo_restores_the_exact_state() {
        let mut puzzle = Puzzle::default();
        let initial = puzzle.clone();
        puzzle.act("cell-0");
        let after_one = puzzle.clone();
        puzzle.act("cell-0");
        assert_eq!(puzzle.board, initial.board);
        assert_eq!(puzzle.solution, initial.solution);
        assert_eq!(puzzle.moves, 2);
        assert!(puzzle.validate().is_ok());
        puzzle.act("undo");
        assert_eq!(puzzle, after_one);
        puzzle.act("undo");
        assert_eq!(puzzle, initial);
        assert!(!puzzle.act("cell-25"));
        assert!(!puzzle.act("cell-invalid"));
        assert!(!puzzle.act("another-feature"));
        assert_eq!(puzzle, initial);
    }

    #[test]
    fn next_cycles_six_distinct_levels() {
        let mut puzzle = Puzzle::default();
        let mut boards = Vec::new();
        for level in 0..6 {
            assert_eq!(puzzle.level, level);
            assert!(!boards.contains(&puzzle.board));
            boards.push(puzzle.board);
            puzzle.act("next");
        }
        assert_eq!(puzzle, Puzzle::default());
    }

    #[test]
    fn move_limit_preserves_the_board_and_undo_makes_it_playable_again() {
        let mut puzzle = Puzzle::default();
        for _ in 0..MAX_MOVES {
            puzzle.act("cell-0");
        }
        let at_limit = puzzle.clone();
        puzzle.act("hint");
        puzzle.act("cell-1");
        assert_eq!(puzzle, at_limit);
        assert!(puzzle.validate().is_ok());
        puzzle.act("undo");
        assert_eq!(puzzle.moves, MAX_MOVES as u32 - 1);
        puzzle.act("hint");
        assert!(puzzle.validate().is_ok());
        assert_eq!(puzzle.moves, MAX_MOVES as u32);
        puzzle.act("restart");
        assert_eq!(puzzle, Puzzle::default());
    }

    #[test]
    fn imported_state_must_replay_its_board_solution_and_move_count() {
        let initial = Puzzle::default();
        let mut invalid = initial.clone();
        invalid.board ^= 1;
        assert!(invalid.validate().is_err());
        invalid = initial.clone();
        invalid.solution ^= 1;
        assert!(invalid.validate().is_err());
        invalid = initial.clone();
        invalid.moves = 1;
        assert!(invalid.validate().is_err());
        invalid = initial.clone();
        invalid.level = 6;
        assert!(invalid.validate().is_err());
        invalid = initial.clone();
        invalid.board |= 1 << 25;
        assert!(invalid.validate().is_err());
        invalid = initial.clone();
        invalid.history.push(25);
        invalid.moves = 1;
        assert!(invalid.validate().is_err());
        invalid = initial;
        while invalid.board != 0 {
            invalid.act("hint");
        }
        invalid.press(0);
        assert!(invalid.validate().is_err());
    }

    #[test]
    fn serde_roundtrip_retains_playable_progress_and_defaults_to_first_puzzle() {
        let mut puzzle = Puzzle::default();
        puzzle.act("cell-4");
        puzzle.act("hint");
        let restored: Puzzle =
            serde_json::from_str(&serde_json::to_string(&puzzle).unwrap()).unwrap();
        assert_eq!(restored, puzzle);
        assert!(restored.validate().is_ok());
        let empty: Puzzle = serde_json::from_str("{}").unwrap();
        assert_eq!(empty, Puzzle::default());
        assert!(serde_json::from_str::<Puzzle>("{\"unexpected\":true}").is_err());
    }
}
