export function packagedResourcePath(path: string) {
  return path.replace(/([\\/])app\.asar([\\/])/u, "$1app.asar.unpacked$2");
}
