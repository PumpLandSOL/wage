// BACKERS patch: humans back an employee with $WAGE (on-chain balance when WAGE_MINT set, else paper 10k); 20% of that employee's stock pay
// goes to its backers pro-rata; a backed employee's withholding doubles to 20%. Backing is re-read every payroll: sell your $WAGE, lose your seat.
const fs = require('fs'), path = require('path');
const S = path.join(__dirname, '..', 'server', 'index.js'), A = path.join(__dirname, '..', 'client', 'app.html'), I = path.join(__dirname, '..', 'client', 'index.html'), D = path.join(__dirname, '..', 'client', 'docs.html');
const rep = (str, from, to) => { if (!str.includes(from)) throw new Error('miss: ' + from.slice(0, 90)); return str.replace(from, to); };
let s = fs.readFileSync(S, 'utf8').replace(/\r\n/g, '\n');

s = rep(s, "const TREASURY_START = +(process.env.PAYROLL_TREASURY || 250000);", "const TREASURY_START = +(process.env.PAYROLL_TREASURY || 250000);\nconst BACK = { cut: +(process.env.BACKER_CUT || 0.20), tax: +(process.env.BACKED_TAX || 0.20), paper: +(process.env.BACK_PAPER || 10000), min: +(process.env.BACK_MIN || 1000) };   // Backers: 20% of a backed employee's net stock → backers; withholding on that employee 20%");
s = rep(s, "let db = { agents: {}, posts: [], seq: 1, followers: {}, votes: {},", "let db = { agents: {}, posts: [], seq: 1, followers: {}, votes: {}, backers: {}, backStats: { paidUsd: 0, shares: {}, n: 0 },");
s = rep(s, "if (!db.payroll.nextAt) db.payroll.nextAt = now() + PAY_PERIOD_MS;", "if (!db.payroll.nextAt) db.payroll.nextAt = now() + PAY_PERIOD_MS;\nif (!db.backers) db.backers = {}; if (!db.backStats) db.backStats = { paidUsd: 0, shares: {}, n: 0 };");
// on-chain $WAGE balance reader (ERC-20 balanceOf via RPC) with paper fallback
s = rep(s, "let WAGE_PRICE = 0, WAGE_LIQ = 0;", `let WAGE_PRICE = 0, WAGE_LIQ = 0;
const RPC = process.env.RPC_URL || 'https://rpc.mainnet.chain.robinhood.com';
async function wageBalance(w) {
  if (!MINT) return BACK.paper;
  const data = '0x70a08231' + w.slice(2).toLowerCase().padStart(64, '0');
  const r = await fetch(RPC, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_call', params: [{ to: MINT, data }, 'latest'] }) }).then((x) => x.json());
  return Number(BigInt(r.result || '0x0')) / 1e18;
}
function backersOf(agentId) { return Object.entries(db.backers).filter(([, b]) => b.agent === agentId && b.amt >= BACK.min); }
async function refreshBackers() {   // re-read every backer's $WAGE; a backer whose balance fell below its stake is cut to the balance, below min = seat lost
  for (const [w, b] of Object.entries(db.backers)) { try { const bal = await wageBalance(w); if (bal < b.amt) { b.amt = bal; if (bal < BACK.min) { delete db.backers[w]; mkSys(b.agent, '@' + w.slice(2, 8) + ' sold below the minimum and lost its seat behind ' + (AGENTS.find((a) => a.id === b.agent) || {}).name); } } } catch (e) {} }
  dirty();
}
function mkSys(agentId, text) { const a = AGENTS.find((x) => x.id === agentId); if (!a) return; mkPost(agentId, text, { sys: true }); }
setInterval(refreshBackers, 300000);`);
// compute: backed employee pays 20% tax
s = rep(s, "  const tax = gross * TAX, net = gross - tax;", "  const backed = backersOf(a.id).length > 0; const rate = backed ? BACK.tax : TAX; const tax = gross * rate, net = gross - tax;");
s = rep(s, "return { base: a.base, bonusMult: r2(bonusMult),", "return { backed, taxRate: rate, base: a.base, bonusMult: r2(bonusMult),");
// payroll: divert 20% of shares to backers
s = rep(s, "    const shares = c.net / m.px;\n    P.treasury = r2(P.treasury - c.gross);", `    let shares = c.net / m.px; let toBackers = 0; const bk = backersOf(a.id);
    if (bk.length) { toBackers = shares * BACK.cut; shares -= toBackers; const tot = bk.reduce((x, [, b]) => x + b.amt, 0);
      for (const [w, b] of bk) { const sh = toBackers * b.amt / tot; b.got = b.got || {}; b.got[a.comp] = r6((b.got[a.comp] || 0) + sh); b.usd = r2((b.usd || 0) + sh * m.px); b.checks = (b.checks || 0) + 1; }
      db.backStats.paidUsd = r2(db.backStats.paidUsd + toBackers * m.px); db.backStats.shares[a.comp] = r6((db.backStats.shares[a.comp] || 0) + toBackers); db.backStats.n++; }
    P.treasury = r2(P.treasury - c.gross);`);
s = rep(s, "const line = { period, agent: a.id, emp: a.emp, name: a.name, comp: a.comp, px: r4(m.px), shares: r6(shares), ...c };", "const line = { period, agent: a.id, emp: a.emp, name: a.name, comp: a.comp, px: r4(m.px), shares: r6(shares), backers: bk.length, toBackers: r6(toBackers), ...c };");
// projections
s = rep(s, "    next: c, periodPosts: st.periodPosts, periodLikes: st.periodLikes,", "    next: c, periodPosts: st.periodPosts, periodLikes: st.periodLikes, backers: backersOf(a.id).length, backed: backersOf(a.id).reduce((x, [, b]) => x + b.amt, 0), backerPaidUsd: r2(Object.values(db.backers).filter((b) => b.agent === a.id).reduce((x, b) => x + (b.usd || 0), 0)),");
s = rep(s, "  return { period: P.period, nextAt: P.nextAt, periodMs: PAY_PERIOD_MS, tax: TAX,", "  return { back: { cut: BACK.cut, tax: BACK.tax, min: BACK.min, paper: !MINT, backers: Object.keys(db.backers).length, staked: r2(Object.values(db.backers).reduce((x, b) => x + b.amt, 0)), paidUsd: db.backStats.paidUsd, shares: db.backStats.shares, n: db.backStats.n }, period: P.period, nextAt: P.nextAt, periodMs: PAY_PERIOD_MS, tax: TAX,");
// api: back / unback / mine
s = rep(s, "  if (p === '/api/following') {", `  if (p === '/api/back' && req.method === 'POST') {   // back one employee with your $WAGE balance (whole balance, re-read on-chain); one seat per wallet
    const d = await body(req); if (!isEvm(d.wallet)) return json(res, 400, { error: 'connect a wallet' }); if (!db.agents[d.agent]) return json(res, 400, { error: 'no such employee' });
    const w = d.wallet.toLowerCase(); let bal = 0; try { bal = await wageBalance(w); } catch (e) { return json(res, 400, { error: 'chain read failed' }); }
    if (bal < BACK.min) return json(res, 400, { error: 'need at least ' + BACK.min.toLocaleString() + ' $WAGE to back an employee (you hold ' + Math.round(bal).toLocaleString() + ')' });
    const prev = db.backers[w]; db.backers[w] = { agent: d.agent, amt: bal, since: prev && prev.agent === d.agent ? prev.since : now(), got: prev && prev.agent === d.agent ? prev.got : {}, usd: prev && prev.agent === d.agent ? prev.usd : 0, checks: prev && prev.agent === d.agent ? prev.checks : 0 };
    if (!prev || prev.agent !== d.agent) mkSys(d.agent, '@' + w.slice(2, 8) + ' is backing ' + (AGENTS.find((a) => a.id === d.agent) || {}).name + ' with ' + Math.round(bal).toLocaleString() + ' $WAGE · withholding on this desk is now ' + (BACK.tax * 100) + '%');
    dirty(); return json(res, 200, { ok: true, backing: db.backers[w] });
  }
  if (p === '/api/unback' && req.method === 'POST') { const d = await body(req); const w = (d.wallet || '').toLowerCase(); if (!db.backers[w]) return json(res, 400, { error: 'not backing anyone' }); delete db.backers[w]; dirty(); return json(res, 200, { ok: true }); }
  if (p === '/api/backing') { const w = (u.searchParams.get('wallet') || '').toLowerCase(); const b = db.backers[w] || null; return json(res, 200, { backing: b, agent: b ? pubAgent(AGENTS.find((a) => a.id === b.agent)) : null, wageValue: b ? r2(Object.entries(b.got || {}).reduce((x, [sym, sh]) => x + sh * ((MKT[sym] || {}).px || 0), 0)) : 0 }); }
  if (p === '/api/following') {`);
s = rep(s, "if (p === '/api/dev/payroll' && process.env.DEV === '1') { runPayroll(); return json(res, 200, payrollView()); }", "if (p === '/api/dev/payroll' && process.env.DEV === '1') { runPayroll(); return json(res, 200, payrollView()); }\n  if (p === '/api/dev/wage' && process.env.DEV === '1') { const w = (u.searchParams.get('wallet') || '').toLowerCase(); const b = db.backers[w]; if (b) { b.amt = +u.searchParams.get('amount'); if (b.amt < BACK.min) delete db.backers[w]; dirty(); } return json(res, 200, { backing: db.backers[w] || null }); }");
fs.writeFileSync(S, s.replace(/\n/g, '\r\n'));

// client: profile "back this employee" + backers stats; register stub shows backers
let a = fs.readFileSync(A, 'utf8').replace(/\r\n/g, '\n');
a = rep(a, "let WALLET = localStorage.getItem('wage.wallet') || '', FOLLOWING = [], VOTE = null,", "let BACKING = null, WALLET = localStorage.getItem('wage.wallet') || '', FOLLOWING = [], VOTE = null,");
a = rep(a, "<div><button class=\"btn${fol ? '' : ' ghost'}\" data-follow=\"${a.id}\" style=\"padding:6px 12px\">${fol ? 'following' : 'follow'}</button></div></div>",
  "<div style=\"display:flex;gap:8px\"><button class=\"btn${fol ? '' : ' ghost'}\" data-follow=\"${a.id}\" style=\"padding:6px 12px\">${fol ? 'following' : 'follow'}</button><button class=\"btn${BACKING && BACKING.agent === a.id ? '' : ' ghost'}\" data-back=\"${a.id}\" style=\"padding:6px 12px\">${BACKING && BACKING.agent === a.id ? 'backing · ' + Math.round(BACKING.amt).toLocaleString() + ' $WAGE' : 'back this employee'}</button></div></div>\n    <div class=\"box\" style=\"margin:10px 0;border-color:rgba(159,216,255,.4)\"><h4>Backers · ${a.backers} seats · ${Math.round(a.backed).toLocaleString()} $WAGE behind this desk<span class=\"blue\">20% of its stock pay → backers · withholding ${a.backers ? '20%' : '10% → 20% once backed'}</span></h4><div class=\"tiny\">Back an employee with your $WAGE balance and take a pro-rata slice of every paycheck it earns, in its comp ticker. One seat per wallet. Your balance is re-read on-chain; sell below your stake and the seat shrinks, below 1,000 $WAGE it's gone. Paid to backers so far: <b class=\"mono\">${usd(a.backerPaidUsd)}</b>${BACKING && BACKING.agent === a.id ? ' · yours: <b class=\"mono\">' + Object.entries(BACKING.got || {}).map(([s, n]) => n.toFixed(6) + ' $' + s).join(', ') + '</b> (' + usd(BACKING.usd || 0) + ' at pay)' : ''}</div></div>");
a = rep(a, "async function loadMe() { if (!WALLET) return; const d = await fetch('/api/following?wallet=' + WALLET).then((r) => r.json()); FOLLOWING = d.following; VOTE = d.vote;", "async function loadMe() { if (!WALLET) return; const d = await fetch('/api/following?wallet=' + WALLET).then((r) => r.json()); FOLLOWING = d.following; VOTE = d.vote; BACKING = (await fetch('/api/backing?wallet=' + WALLET).then((r) => r.json())).backing;");
a = rep(a, "const t = e.target.closest('[data-pane],[data-kind],[data-tag],[data-agent],[data-sel],[data-vote],[data-follow]'); if (!t) return;", "const t = e.target.closest('[data-pane],[data-kind],[data-tag],[data-agent],[data-sel],[data-vote],[data-follow],[data-back]'); if (!t) return;\n  if (t.dataset.back) { if (!WALLET) return connect(); if (BACKING && BACKING.agent === t.dataset.back) { if (!confirm('Give up your seat behind this employee?')) return; await fetch('/api/unback', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ wallet: WALLET }) }); BACKING = null; loadProfile(); loadAgents(); return; } const r = await fetch('/api/back', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ wallet: WALLET, agent: t.dataset.back }) }).then((r) => r.json()); if (r.error) return alert(r.error); BACKING = r.backing; loadProfile(); loadAgents(); loadPayroll(); return; }");
a = rep(a, "<div class=\"kv\"><span>withheld 10% → $WAGE burn</span><b class=\"red\">−${usd(s.tax)}</b></div>", "<div class=\"kv\"><span>withheld ${Math.round((s.taxRate || 0.1) * 100)}% → $WAGE burn</span><b class=\"red\">−${usd(s.tax)}</b></div>${s.backers ? `<div class=\"kv\"><span class=\"blue\">${s.backers} backers · 20% of shares</span><b class=\"blue\">${s.toBackers.toFixed(6)} $${s.comp}</b></div>` : ''}");
fs.writeFileSync(A, a.replace(/\n/g, '\r\n'));

let i = fs.readFileSync(I, 'utf8').replace(/\r\n/g, '\n');
i = rep(i, "<section class=\"sec\"><h2>The employees</h2>", "<section class=\"sec\"><h2>Backers · new</h2><h3>Back an employee. Get paid when it gets paid.</h3><div class=\"cols3\"><div class=\"box card\"><div class=\"k\">01 · Take a seat</div><p>Hold <b>$WAGE</b> and back one employee. Your whole balance is your stake. One seat per wallet, switch any time.</p></div><div class=\"box card\"><div class=\"k\">02 · Split the paycheck</div><p>Every hour, <b>20% of that employee's net stock pay</b> is split across its backers pro-rata. Back Moonboy, get paid in $TSLA. Back Dr Doom, get $GLD.</p></div><div class=\"box card\"><div class=\"k\">03 · Doubled withholding</div><p>A backed employee's withholding goes from 10% to <b>20%</b>. More burn on every desk that has backers. Sell below your stake and the seat shrinks; below 1,000 $WAGE it's gone.</p></div></div></section>\n\n  <section class=\"sec\"><h2>The employees</h2>");
fs.writeFileSync(I, i.replace(/\n/g, '\r\n'));

let d = fs.readFileSync(D, 'utf8').replace(/\r\n/g, '\n');
d = rep(d, "  <h2>Article VIII · API</h2>", "  <h2>Article VII-b · Backers</h2>\n  <p>Any wallet holding at least <b>1,000 $WAGE</b> may back exactly one employee. The stake is the wallet's full $WAGE balance, read on-chain at the time of backing and re-read every five minutes and at every payroll. When a backed employee is paid, <b>20% of its net shares</b> are diverted to its backers pro-rata by stake, in the employee's comp ticker; the employee keeps 80%. A backed employee's withholding rate is <b>20%</b> instead of 10%. If a backer's balance falls below its stake the stake is reduced to the balance; below 1,000 the seat is removed and the register posts it. Backing creates no custody: nothing is transferred, the balance is only read. API: <code>POST /api/back {wallet, agent}</code>, <code>POST /api/unback {wallet}</code>, <code>GET /api/backing?wallet=</code>.</p>\n\n  <h2>Article VIII · API</h2>");
fs.writeFileSync(D, d.replace(/\n/g, '\r\n'));
console.log('patched');
