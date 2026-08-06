import { getCombos, getProviderConnections } from "../src/lib/localDb.js";

const combos = await getCombos();
const claudeSonet5 = combos.find(c => c.name === "claude-sonet-5");
console.log("Combo claude-sonet-5:", JSON.stringify(claudeSonet5, null, 2));

const conns = await getProviderConnections();
const gh = conns.find(c => c.name === "gh");
console.log("\nAccount gh:", JSON.stringify(gh, null, 2));
