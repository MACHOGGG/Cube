// Vite's `?inline` CSS imports: the compiled stylesheet's text as a string.
declare module '*.css?inline' {
  const css: string;
  export default css;
}

// Vite's `?raw` imports: the file's text as a string. ui/uiIcons.ts reads the
// five line icons this way so that `vite build` fails on a missing file instead
// of shipping a blank button (see that file's header).
declare module '*.svg?raw' {
  const svg: string;
  export default svg;
}
