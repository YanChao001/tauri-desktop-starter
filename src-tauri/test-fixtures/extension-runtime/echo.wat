;; 测试 Extism 输入输出 ABI，逐字节回显输入，不提供业务功能。
(module
  (import "extism:host/env" "input_offset" (func $offset (result i64)))
  (import "extism:host/env" "input_length" (func $length (result i64)))
  (import "extism:host/env" "output_set" (func $output (param i64 i64)))
  (func $echo (export "echo") (export "repeat") (result i32)
    (call $output (call $offset) (call $length))
    (i32.const 0)))
