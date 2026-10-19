# Rell VM

A JavaScript obfuscator powered by a custom virtual machine.

Rell VM transpiles modern JavaScript to ES5, compiles it into a custom WASM-like text instruction format, and bundles the program with its runtime into a standalone JavaScript file.

This format is not WebAssembly and does not require a WebAssembly engine.

## Features

- Modern JavaScript normalization through Babel.
- Custom text-based VM instructions.
- Functions, closures, objects, arrays, and exception handling.
- Access to the host JavaScript environment.
- Variable and parameter name mangling.
- Randomized instruction names.
- Whole-program encryption.
- Lazy decryption of string operands and protected nested function bodies.
- Internal runtime property mangling.
- Removal of unused opcode handlers.
- Runtime minification and masked VM diagnostics.

Obfuscation is enabled by default.

## Installation

Requires a modern Node.js version. Node.js 24 is recommended.

```sh
npm install
```

## Usage

```sh
node bin/jsvm.js examples/input.js --output examples/output.js
```

Run the generated file with Node.js:

```sh
node examples/output.js
```

Or include it in a browser:

```html
<script src="examples/output.js"></script>
```

The output includes the VM runtime and does not require the project dependencies to execute.

Existing output files are not overwritten. Remove the old file or choose a new output path before rebuilding.

## Options

Show all available options:

```sh
node bin/jsvm.js --help
```

Common options:

| Option | Description |
| --- | --- |
| `-o, --output <path>` | Set the output file path. |
| `--keep-function-names` | Preserve observable function names. |
| `--no-normalize` | Skip Babel normalization. |
| `--no-mangle-names` | Disable variable and parameter metadata mangling. |
| `--no-encrypt-program` | Disable whole-program encryption. |
| `--no-protect-strings` | Disable string operand encryption. |
| `--no-randomize-instructions` | Keep canonical instruction names. |
| `--no-mangle-properties` | Keep internal VM property names. |
| `--no-prune-opcodes` | Keep all opcode handlers. |
| `--no-mask-errors` | Keep detailed VM diagnostics. |
| `--no-minify` | Keep readable runtime formatting. |

String protection is independent of whole-program encryption. Disabling `--no-encrypt-program` alone does not expose string operands.

## Testing

```sh
npm test
```

To reduce parallel test load:

```sh
node --test --test-concurrency=2
```

## Limitations

Rell VM is an obfuscation tool, not a security sandbox or a place to store secrets. A debugger can inspect runtime values and intercept decrypted strings.

Not every JavaScript behavior is supported. Transpiling input to ES5 does not guarantee full ES5 compatibility, provide missing platform APIs, or make the generated runtime compatible with old ES5-only browsers.

Obfuscation adds output size and execution overhead. Name mangling and masked diagnostics can also change observable names and error messages.