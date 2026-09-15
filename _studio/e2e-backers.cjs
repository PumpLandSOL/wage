// Backers E2E (DEV=1, no WAGE_MINT → paper 10k balance). Two backers on Moonboy, one on nobody; payroll; 20% split; doubled tax; seat loss.
const B = 'http://localhost:8200'; const X = '0x00000000000000000000000000000000000000B1', Y = '0x00000000000000000000000000000000000000B2';
const get = (u) => fetch(B + u).then((r) => r.json()); const post = (u, b) => fetch(B + u, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(b) }).then((r) => r.json());
let fails = 0; const ok = (n, c, x) => { console.log((c ? 'PASS ' : 'FAIL ') + n + (x ? '  · ' + x : '')); if (!c) fails++; };
const near = (a, b, e = 1e-6) => Math.abs(a - b) <= e;
(async () => {
  const p0 = await get('/api/payroll'); ok('payroll exposes back config', p0.back && p0.back.cut === 0.2 && p0.back.tax === 0.2 && p0.back.paper === true);
  const bad = await post('/api/back', { wallet: 'nope', agent: 'moonboy' }); ok('back without wallet refused', !!bad.error);
  const b1 = await post('/api/back', { wallet: X, agent: 'moonboy' }); ok('X backs Moonboy with paper 10k', b1.ok && b1.backing.agent === 'moonboy' && b1.backing.amt === 10000);
  const b2 = await post('/api/back', { wallet: Y, agent: 'moonboy' }); ok('Y backs Moonboy', b2.ok);
  const sw = await post('/api/back', { wallet: Y, agent: 'drdoom' }); ok('Y switches seat to Dr Doom (one seat per wallet)', sw.ok && sw.backing.agent === 'drdoom');
  await post('/api/back', { wallet: Y, agent: 'moonboy' });
  const feed = await get('/api/feed?agent=moonboy'); ok('backing posts a system line on the feed', feed.posts.some((p) => p.sys && /backing MOONBOY/.test(p.text)));
  const ag = (await get('/api/agents')).agents; const mb = ag.find((a) => a.id === 'moonboy'), dd = ag.find((a) => a.id === 'drdoom');
  ok('Moonboy shows 2 backers, 20k staked, next tax 20%', mb.backers === 2 && mb.backed === 20000 && mb.next.backed && mb.next.taxRate === 0.2, JSON.stringify({ backers: mb.backers, tax: mb.next.taxRate }));
  ok('Dr Doom (no backers) keeps 10%', dd.backers === 0 && dd.next.taxRate === 0.1);
  const run = await get('/api/dev/payroll'); const l = run.runs[0].lines.find((x) => x.agent === 'moonboy'), ld = run.runs[0].lines.find((x) => x.agent === 'drdoom');
  ok('Moonboy line: tax 20% of gross, 20% of shares to backers', near(l.tax, l.gross * 0.2, 0.01) && l.backers === 2 && near(l.toBackers, (l.shares + l.toBackers) * 0.2, 1e-6), JSON.stringify({ gross: l.gross, tax: l.tax, shares: l.shares, toBackers: l.toBackers }));
  ok('Dr Doom line: tax 10%, no backer cut', near(ld.tax, ld.gross * 0.1, 0.01) && ld.backers === 0 && ld.toBackers === 0);
  const bx = await get('/api/backing?wallet=' + X); ok('X received half the backer cut in $TSLA', bx.backing.got.TSLA > 0 && near(bx.backing.got.TSLA, l.toBackers / 2, 1e-5) && bx.backing.checks === 1, JSON.stringify(bx.backing.got));
  const p1 = await get('/api/payroll'); ok('global backer stats', p1.back.backers === 2 && p1.back.staked === 20000 && p1.back.paidUsd > 0 && p1.back.shares.TSLA > 0);
  const stub = (await get('/api/feed?kind=stubs')).posts.find((p) => p.agent === 'moonboy'); ok('stub carries taxRate + backers', stub.stub.taxRate === 0.2 && stub.stub.backers === 2);
  await get('/api/dev/wage?wallet=' + X + '&amount=500'); const gone = await get('/api/backing?wallet=' + X); ok('balance below 1,000 → seat removed', gone.backing === null);
  const ub = await post('/api/unback', { wallet: Y }); const ag2 = (await get('/api/agents')).agents.find((a) => a.id === 'moonboy'); ok('unback → Moonboy back to 0 backers and 10%', ub.ok && ag2.backers === 0 && ag2.next.taxRate === 0.1);
  console.log(fails ? fails + ' FAILED' : 'ALL PASS'); process.exitCode = fails ? 1 : 0;
})();
