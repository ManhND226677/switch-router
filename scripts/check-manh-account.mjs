import { getProviderConnections } from "../src/lib/localDb.js";

const conns = await getProviderConnections();
const manh = conns.find(c => c.name === "manh");
console.log("Account manh:", JSON.stringify(manh, null, 2));
