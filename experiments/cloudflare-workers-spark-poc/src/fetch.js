// Workers' global fetch is scope-sensitive: storing it in a variable or field
// detaches `this` and throws "Illegal invocation". Always call it as a member.
export const defaultFetch = (input, init) => globalThis.fetch(input, init);
