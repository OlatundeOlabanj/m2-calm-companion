/* What M² says on its own. Short, set phrases with the person's own numbers filled in
   (the Baymax lesson: soft, plain, no ego). It states measurements; it never names an emotion
   and never diagnoses. Pure functions, no browser needed. */
(function (root) {
  const r = (x) => Math.round(x);
  const pick = (arr, n) => arr[Math.abs(n | 0) % arr.length];

  function numbers(ctx) {
    const b = ctx.last && Number.isFinite(ctx.last.breathing) ? r(ctx.last.breathing) : null;
    const cb = ctx.base ? r(ctx.base.breathing) : null;
    return { b, cb };
  }

  function welcome(mode) {
    return 'Hello. I am M squared. Tap Talk with me, and tell me what is going on.';
  }

  function rising(ctx) {
    const { b, cb } = numbers(ctx);
    const head = b !== null && cb !== null ? 'Your breathing is climbing: ' + b + ' a minute, and your calm is ' + cb + '.' : 'Your pace is picking up.';
    return { text: head, sub: 'Want to slow down together?' };
  }

  function locked(ctx) {
    const { b, cb } = numbers(ctx);
    const head = b !== null && cb !== null ? 'You are at ' + b + ' breaths a minute; your calm is ' + cb + '.' : 'You are well above your calm.';
    return { text: head, sub: 'Let us slow down together. In for four, out for six.' };
  }

  function review(ctx) {
    return { text: 'You have settled.', sub: 'Take your time. When you are ready, we can work out what to say.' };
  }

  function opened(n) {
    return pick(['I am here.', 'Take your time.', 'Whenever you are ready.'], n);
  }

  function noSignal(hint) {
    return { text: 'I cannot see you clearly right now.', sub: (hint ? hint + '. ' : '') + 'We can still talk.' };
  }

  function calibrating() {
    return { text: 'I am learning your calm as we go.', sub: 'No need to wait. Just be yourself.' };
  }

  function ready(mode) {
    return { text: 'I know your calm now.', sub: 'Tap Talk with me and tell me what is going on.' };
  }

  function noAi() {
    return { text: 'My AI link is off, so I only know a few commands.', sub: 'Try: breathe with me, or show details.' };
  }

  const api = { welcome, rising, locked, review, opened, noSignal, calibrating, ready, noAi };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.CH = Object.assign(root.CH || {}, { phrases: api });
})(typeof window !== 'undefined' ? window : globalThis);
