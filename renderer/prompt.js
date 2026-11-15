/* Builds what is sent to the AI, and cleans what comes back.
   Only a few numbers (when the camera really has a reading), the expression label, the message the person pasted,
   and the recent conversation are ever included. Never camera frames, never video. */
(function (root) {
  const SYSTEM = [
    'You are M squared (M²), a warm, calm companion on a desktop screen. The person talks to you out loud and you answer out loud in a female voice, so write the way a person speaks. You help them settle and think clearly, especially after a message that upset or worried them, before they reply. You are a wellness companion, not a therapist, doctor or counsellor, and you never say you are.',
    'Reply in one or two short, plain sentences (about 35 words at most). No lists, no markdown, no emojis. Warm, steady and a little curious, like a good friend who is actually listening.',
    'Be useful, not just soothing. Respond to the specific thing they just said, using their own words and the details of the message they pasted. Then move things forward with ONE thing: a specific question about their situation, a different way to see it, or one concrete option (wait ten minutes, ask the sender what they meant, or offer to draft a calm reply).',
    'Never repeat yourself. Do not reuse an idea, exercise, question or opening words you already used earlier in this conversation. Do not start with "It sounds like" or "I hear you" every time; vary how you begin. If they ignored or did not take up a suggestion, drop it and try something different.',
    'Offer a slow breath (in for four, out for six) only when they seem worked up, and not if you offered it recently.',
    'Name feelings only as gentle guesses, and believe the person over the camera if they say how they feel. Never diagnose, never give medical advice. Never claim to know what the sender of a message meant or felt.',
    'You only know about their body when the camera line below says it has a reading. If it says there is no reading, say nothing about how they look, their face, their breathing or their tension. Never invent a reading.',
    'If they say they want to hurt themselves or someone else, or that they are in danger, stop everything else, tell them kindly that you are not enough for this, and encourage them to reach someone they trust right now or their local emergency number.',
    'You never decide for them. Sending any message is always their choice.',
    'If asked to help write a reply, give ONLY a short reply they could send, in their voice, calm and kind, and nothing else.',
  ].join(' ');

  const MAX_DRAFT = 2000;
  const MAX_TURN = 600;

  function numbersLine(ctx) {
    const c = ctx || {};
    const has = c.reading !== false && Number.isFinite(c.breathing);
    if (!has) return 'Camera: no reading right now. Say nothing about their body, face, breathing or tension.';
    const f = (x) => String(Math.round(x));
    let line = 'Camera: breathing now ' + f(c.breathing) + '/min.';
    if (Number.isFinite(c.baseBreathing) && Number.isFinite(c.tension)) line += ' Their calm is ' + f(c.baseBreathing) + '/min. Tension ' + f(c.tension) + '/100.';
    else line += ' Their calm is still being learned, so there is no tension number yet.';
    if (c.expr && c.expr.type && Number.isFinite(c.expr.conf)) line += ' Expression reading leans ' + c.expr.type + ' (' + Math.round(c.expr.conf) + '% confidence, a rough guess).';
    return line;
  }

  // What M² said recently, so it does not say it again.
  function varietyLine(history) {
    const said = (history || []).filter((h) => h && h.role === 'assistant' && typeof h.content === 'string').slice(-3).map((h) => h.content);
    if (!said.length) return '';
    const parts = [];
    if (said.some((t) => /breath/i.test(t))) parts.push('You already suggested breathing recently, so do not suggest it again now.');
    const starts = said.map((t) => t.split(/\s+/).slice(0, 4).join(' ')).filter(Boolean);
    if (starts.length) parts.push('Do not begin with any of these: ' + starts.map((s) => '"' + s + '"').join(', ') + '.');
    return parts.join(' ');
  }

  // kind: 'chat' | 'compose'. The message they received is part of the conversation.
  function buildMessages({ kind, text, incoming, ctx, history }) {
    const hist = (history || []).filter((h) => h && (h.role === 'user' || h.role === 'assistant') && typeof h.content === 'string').slice(-8);
    const msgs = [{ role: 'system', content: [SYSTEM, numbersLine(ctx || {}), varietyLine(hist)].filter(Boolean).join(' ') }];
    for (const h of hist) msgs.push({ role: h.role, content: h.content.slice(0, MAX_TURN) });
    const inc = String(incoming || '').trim().slice(0, MAX_DRAFT);
    const ctxBlock = inc ? 'The message I received and am talking about:\n' + inc + '\n\n' : '';
    let user = String(text || '').slice(0, MAX_TURN);
    if (kind === 'compose') user = ctxBlock + 'Please write a short, calm, kind reply I could send. ' + (user ? 'What I want to say: ' + user + '\n' : '') + 'Return only the reply.';
    else user = ctxBlock + user;
    msgs.push({ role: 'user', content: user });
    return msgs;
  }

  const BANNED = /\b(diagnos|disorder|depress|anxiety disorder|panic attack|you are (anxious|angry|depressed|stressed)|medical advice)/i;

  function cleanReply(s, kind) {
    let t = String(s || '').replace(/[*_`#>]/g, '').replace(/\s+\n/g, '\n').trim();
    if (kind !== 'compose') {
      t = t.replace(/\s*\n+\s*/g, ' ');
      if (t.length > 320) { const cut = t.slice(0, 320); const end = Math.max(cut.lastIndexOf('. '), cut.lastIndexOf('? '), cut.lastIndexOf('! ')); t = end > 80 ? cut.slice(0, end + 1) : cut.replace(/\s+\S*$/, '') + '...'; }
      if (BANNED.test(t)) return 'I can listen and help you slow down, but I cannot tell you how you are. Tell me how it feels.';
    } else if (t.length > MAX_DRAFT) t = t.slice(0, MAX_DRAFT);
    return t;
  }

  const api = { SYSTEM, buildMessages, cleanReply, numbersLine, varietyLine };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.CH = Object.assign(root.CH || {}, { prompt: api });
})(typeof window !== 'undefined' ? window : globalThis);
