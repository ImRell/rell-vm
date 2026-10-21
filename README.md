# Rell VM

A JavaScript obfuscator powered by a custom binary virtual machine.

Rell VM transpiles modern JavaScript to ES5, compiles it into a compact binary bytecode format with peephole opcode fusion, encrypts the program using ChaCha20-Poly1305 AEAD, and bundles it with an obfuscated polymorphic virtual machine runtime into a standalone JavaScript file.

## Features

- **Modern JavaScript Normalization**: Normalizes modern JavaScript (ES6+) to ES5 via Babel.
- **Binary Bytecode Engine**: Compact binary bytecode serialization with variable-length integer (varint) encoding and an indexed constant pool.
- **Peephole Opcode Fusion**: Macro instructions for common sequences (variable access, constant arithmetic, returns) to boost execution efficiency and thwart linear disassembly.
- **Polymorphic Opcode Mapping**: Dynamic per-build opcode remapping and randomized dispatch handler shuffling.
- **ChaCha20-Poly1305 AEAD Encryption**: Cryptographic envelope with split-key derivation and chunk order permutation.
- **On-Demand Decryption**: Lazy evaluation of encrypted string literals and nested function bytecode payloads.
- **Full ES5 Language Coverage**: Closures, lexical environments, objects, arrays, prototype chains, and exception handling (`try/catch/finally`).
- **Host Interoperability**: Seamless interop with host JavaScript globals, browser DOM, and Node.js APIs.
- **Dead Code Elimination**: Automatic tree-shaking and pruning of unused VM opcode handlers.
- **Hardened Runtime**: Internal property mangling, minification, and masked diagnostic errors (`???`).

Obfuscation is enabled by default.

## Installation

Requires Node.js 22 or higher (Node.js 24 recommended).

```sh
npm install
```

## Usage

### CLI

Compile a JavaScript file:

```sh
node bin/jsvm.js examples/input.js --output examples/output.js
```

Or using the npm script:

```sh
npm start
```

Run the generated bundle with Node.js:

```sh
node examples/output.js
```

Or include it in an HTML document:

```html
<script src="examples/output.js"></script>
```

The output bundle includes the lightweight VM runtime and requires zero external dependencies to execute. Output files are overwritten if they already exist.

### Programmatic API

Rell VM can also be used as a module:

```js
import { compileFile, buildBrowserScript, compileToBytecode, executeBytecode } from 'rell-vm';

// High-level file compilation
await compileFile({
  inputPath: 'src/main.js',
  outputPath: 'dist/bundle.js',
  minify: true,
  encryptProgram: true,
});
```

### Example

Input (`examples/input.js`):

```js
console.log('Hello, World!');
```

Output bundle excerpt (`examples/output.js`):

```js
(()=>{
  // Lightweight polymorphic VM runtime with ChaCha20-Poly1305 AEAD decryption
  // ...
  Lt(F({
    v: 1,
    k: ["cqPe4XwZZs1ctehcMLueE3ZiT508KrEYdEwlk5uxCFQ=", "/5LcZ00EH6QxTZM/EsgxEsQcQ9LgI2XWZxwBdia4Riw="],
    n: "3hH6veNcCb842ygu",
    t: "UAaoFrHh9rWRrX2sizERig==",
    c: ["7oYEXvUROfQibVdW0HAGgYMxd+UqBrhtpAf/ckofCTX..."],
    o: [0]
  }), {
    _rell_vm_3fd803e9: Ut([[...]])
  });
})();
```

## CLI Options

Show all available options:

```sh
node bin/jsvm.js --help
```

| Option | Description |
| --- | --- |
| `-o, --output <path>` | Set output file path (overwritten if it exists). |
| `--keep-function-names` | Preserve observable `function.name` while still mangling locals. |
| `--no-normalize` | Skip Babel ES6+ to ES5 normalization. |
| `--no-mangle-names` | Disable variable and parameter metadata mangling. |
| `--no-encrypt-program` | Disable whole-program envelope encryption. |
| `--no-protect-strings` | Disable string operand encryption. |
| `--no-randomize-instructions` | Keep canonical instruction opcodes. |
| `--no-mangle-properties` | Keep internal VM runtime property names. |
| `--no-prune-opcodes` | Keep all opcode handlers in runtime bundle. |
| `--no-mask-errors` | Keep detailed VM diagnostic messages. |
| `--no-minify` | Keep readable runtime formatting for debugging. |

String protection is independent of whole-program encryption. Disabling `--no-encrypt-program` alone does not expose protected string operands.

## Testing

Run the comprehensive test suite (1,400+ tests):

```sh
npm test
```

To limit parallel test concurrency:

```sh
node --test --test-concurrency=2
```

## Security & Limitations

- Rell VM is an obfuscation and code-protection tool designed to raise the reverse-engineering barrier; it is not a secure cryptographic sandbox for hosting secrets or untrusted multi-tenant code.
- Dynamic debugging tools can inspect runtime memory values and intercept evaluated outputs.
- Transpiling input to ES5 preserves standard ECMAScript semantics, but does not polyfill missing host platform APIs or DOM features.
- Obfuscation adds payload size and execution overhead relative to native V8 JIT execution.