// Tiny hyperscript helper: h('button.primary', { onclick }, 'Label').
export function h(selector, props, ...children) {
  // Props are optional: h('div', child, ...) is accepted too.
  const isProps = props && typeof props === 'object' && !Array.isArray(props) && !props.nodeType;
  if (!isProps) {
    children.unshift(props);
    props = {};
  }
  const [tag, ...classes] = selector.split('.');
  const el = document.createElement(tag || 'div');
  if (classes.length) el.className = classes.join(' ');
  for (const [key, value] of Object.entries(props)) {
    if (value == null || value === false) continue;
    if (key.startsWith('on')) el.addEventListener(key.slice(2).toLowerCase(), value);
    else if (key === 'dataset') Object.assign(el.dataset, value);
    else if (key in el && key !== 'list') el[key] = value;
    else el.setAttribute(key, value === true ? '' : value);
  }
  for (const child of children.flat()) {
    if (child == null || child === false) continue;
    el.append(child.nodeType ? child : document.createTextNode(String(child)));
  }
  return el;
}
