// The one place to rename the product. Change these and every page follows.
export const BRAND = {
  name: 'Halfpast',
  tagline: 'Free, self-hosted scheduling you own.',
  // Shown in the footer of every page. Make it yours.
  credit: 'Built with AI in an afternoon. Yours to rename, restyle and ship.',
  // Optional: link the footer to your repo or site. Leave empty to hide it.
  sourceUrl: '',
  sourceLabel: 'Source',
};

// Fills any element marked data-brand="name|tagline|credit" and fixes up the tab title.
export function applyBrand(root = document) {
  for (const node of root.querySelectorAll('[data-brand]')) {
    const key = node.dataset.brand;
    if (key === 'source') {
      if (BRAND.sourceUrl) {
        node.href = BRAND.sourceUrl;
        node.textContent = BRAND.sourceLabel;
        node.hidden = false;
      } else {
        node.hidden = true;
      }
    } else if (typeof BRAND[key] === 'string') {
      node.textContent = BRAND[key];
    }
  }
  if (document.title.includes('Halfpast') && BRAND.name !== 'Halfpast') {
    document.title = document.title.replaceAll('Halfpast', BRAND.name);
  }
}
