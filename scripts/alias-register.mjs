import { register } from "node:module";
import { pathToFileURL } from "node:url";

register("./alias-loader.mjs", pathToFileURL(`${process.cwd().replace(/\\/g, "/")}/scripts/`));
