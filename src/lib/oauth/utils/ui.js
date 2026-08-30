import chalk from "chalk";
import ora from "ora";

/**
 * UI Helper Functions
 */

export function success(message) {
  console.log(chalk.green(`\n✓ ${message}\n`));
}

export function error(message) {
  console.log(chalk.red(`\n✗ ${message}\n`));
}

export function info(message) {
  console.log(chalk.blue(`\n${message}\n`));
}

export function warn(message) {
  console.log(chalk.yellow(`\n⚠ ${message}\n`));
}

export function gray(message) {
  console.log(chalk.gray(message));
}

export function spinner(text) {
  return ora(text);
}

