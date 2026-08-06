import { getProviderConnections } from "../src/lib/localDb.js";

const conns = await getProviderConnections();
const ghConns = conns.filter(c => c.provider === "github");
console.log(`Found ${ghConns.length} GitHub account(s):`);
ghConns.forEach(c => {
  console.log(`- name: "${c.name}", displayName: "${c.displayName}", hasError: ${!!c.errorCode}`);
});

const claudeSonetCombos = conns.filter(c => c.name && c.name.includes("claude") && c.name.includes("sonet"));
console.log(`\nAccounts with "claude" + "sonet" in name: ${claudeSonetCombos.length}`);
claudeSonetCombos.forEach(c => console.log(`- ${c.name} (${c.provider})`));
