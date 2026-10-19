#!/usr/bin/env node

import {
  HELP_TEXT,
  parseArguments,
} from '../src/cli/parse-arguments.js';

import { compileFile } from '../src/cli/compile-file.js';

process.exitCode = await main(process.argv.slice(2));

async function main(args) {
  let options;

  try {
    options = parseArguments(args);
  } catch (error) {
    console.error(`Argument error: ${getMessage(error)}`);
    console.error('Use --help to see usage.');

    return 2;
  }

  if (options.help) {
    console.log(HELP_TEXT);
    return 0;
  }

  try {
    const result = await compileFile(options);

    console.log(
      `Built: ${result.outputPath} (${result.bytes} bytes)`,
    );

    return 0;
  } catch (error) {
    if (error?.code === 'EEXIST') {
      console.error(
        'Build error: output path already exists. ' +
          'Choose another output path or remove the existing file.',
      );
    } else {
      console.error(`Build error: ${getMessage(error)}`);
    }

    return 1;
  }
}

function getMessage(error) {
  return error instanceof Error
    ? error.message
    : String(error);
}