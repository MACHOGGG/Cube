// All of the app's CSS, bundled as strings and installed from JS at boot.
//
// The published Artifact build wraps our head+body fragment inside its own
// document skeleton, and a large static <style> block has proven flaky in
// that wrapper — pages occasionally came up completely unstyled (raw block
// layout, black letters, unconstrained SVGs). Routing every stylesheet
// through the JS bundle instead means: if the app runs at all, its styles
// are there — one code path on every host, dev server included.
import fontsCss from './fonts.css?inline';
import baseCss from './style.css?inline';
import squareCss from './shapes/square.css?inline';
import circleCss from './shapes/circle.css?inline';
import triangleCss from './shapes/triangle.css?inline';
import splashCss from './ui/loadingScreen.css?inline';

export function injectStyles(): void {
  if (document.getElementById('slides-styles')) return;
  const tag = document.createElement('style');
  tag.id = 'slides-styles';
  tag.textContent = [fontsCss, baseCss, squareCss, circleCss, triangleCss, splashCss].join('\n');
  document.head.appendChild(tag);
}
