import { nativeSmoke } from "./native.ts";

console.log(JSON.stringify(await nativeSmoke(), null, 2));
