export async function resolve(specifier, context, nextResolve) {
  const local = specifier.startsWith('./') || specifier.startsWith('../');
  const hasExtension = /\.[a-z0-9]+$/i.test(specifier);
  if (local && !hasExtension) {
    return nextResolve(`${specifier}.js`, context);
  }
  return nextResolve(specifier, context);
}
