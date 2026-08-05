// Test-only ESM resolve hook: maps the project's "@/..." alias to src/... so a
// plain `node` script can import route helpers without Next's bundler.
import { pathToFileURL } from "node:url";

const root = pathToFileURL(`${process.cwd().replace(/\\/g, "/")}/`);

export function resolve(specifier, context, next) {
  if (specifier.startsWith("@/")) {
    const rest = specifier.slice(2);
    const withExt = /\.[a-z]+$/i.test(rest) ? rest : `${rest}.js`;
    return next(new URL(`src/${withExt}`, root).href, context);
  }
  return next(specifier, context);
}
