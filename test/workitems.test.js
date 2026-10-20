'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const W = require('../src/core/workitems');
const pr = require('../src/core/pr');

const repo = (remote) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bz-wi-'));
  execFileSync('git', ['init', '-q'], { cwd: root });
  if (remote) execFileSync('git', ['remote', 'add', 'origin', remote], { cwd: root });
  return root;
};
const AZ = 'https://dev.azure.com/acme/Shop%20App/_git/web';

test('target: the Azure DevOps origin remote, else the project config, else nothing', () => {
  assert.deepEqual(W.target(pr.parseRemote(AZ)), { orgUrl: 'https://dev.azure.com/acme', project: 'Shop App' });
  assert.deepEqual(W.target({ host: 'github' }, { workItems: { orgUrl: 'https://dev.azure.com/acme/', project: 'P' } }), { orgUrl: 'https://dev.azure.com/acme', project: 'P' });
  assert.equal(W.target({ host: 'github' }, {}), null);
  assert.equal(W.target({ host: 'github' }, { workItems: { orgUrl: 'http://evil', project: 'P' } }), null, 'https only');
});

test('wiql: mine / sprint, quotes in the project name are escaped, finished work is left out', () => {
  const mine = W.wiql('mine', "O'Brien App");
  assert.match(mine, /\[System\.TeamProject\] = 'O''Brien App'/);
  assert.match(mine, /\[System\.AssignedTo\] = @Me/);
  assert.match(mine, /NOT IN \('Closed', 'Done', 'Removed', 'Resolved', 'Completed'\)/);
  assert.doesNotMatch(mine, /@CurrentIteration/);
  const sprint = W.wiql('sprint', 'P');
  assert.match(sprint, /\[System\.IterationPath\] = @CurrentIteration/);
  assert.doesNotMatch(sprint, /@Me/);
  assert.doesNotMatch(mine, /"/, 'no double quotes: the query must survive cmd.exe');
});

test('parseList: az boards query output', () => {
  const out = JSON.stringify([
    { id: 12, fields: { 'System.Title': 'Add VAT field', 'System.WorkItemType': 'User Story', 'System.State': 'Active', 'System.AssignedTo': { displayName: 'Kurt Du Bois', uniqueName: 'k@x' }, 'System.Tags': 'billing; api' } },
    { id: 13, fields: { 'System.Title': 'Crash on save', 'System.WorkItemType': 'Bug', 'System.State': 'New' } },
    { fields: { 'System.Title': 'no id' } },
  ]);
  const l = W.parseList(out);
  assert.equal(l.length, 2);
  assert.deepEqual(l[0], { id: 12, title: 'Add VAT field', type: 'User Story', state: 'Active', assignedTo: 'Kurt Du Bois', tags: 'billing; api' });
  assert.equal(l[1].assignedTo, '');
  assert.deepEqual(W.parseList(''), []);
  assert.throws(() => W.parseList('Traceback...'), /unexpected output/);
});

test('htmlToText: Azure Boards HTML becomes readable text', () => {
  const t = W.htmlToText('<div>Users can enter a <b>VAT</b> number.<br>Format: BE0123.456.789</div><ul><li>validate &amp; store</li><li>show on invoice</li></ul><p>a&nbsp;&lt;b&gt;</p>');
  assert.equal(t, 'Users can enter a VAT number.\nFormat: BE0123.456.789\n- validate & store\n- show on invoice\n\na <b>');
  assert.equal(W.htmlToText(null), '');
});

test('parseItem + toTask: the text an agent gets, with AB# so the pull request links back', () => {
  const out = JSON.stringify({ id: 12, fields: { 'System.Title': 'Add VAT field', 'System.WorkItemType': 'User Story', 'System.State': 'Active', 'System.Description': '<div>Enter a VAT number.</div>', 'Microsoft.VSTS.Common.AcceptanceCriteria': '<ul><li>invalid numbers are rejected</li></ul>' }, _links: { html: { href: 'https://dev.azure.com/acme/_workitems/edit/12' } } });
  const item = W.parseItem(out);
  assert.equal(item.url, 'https://dev.azure.com/acme/_workitems/edit/12');
  const text = W.toTask(item);
  assert.equal(text, 'User Story AB#12: Add VAT field\n\nEnter a VAT number.\n\nAcceptance criteria:\n- invalid numbers are rejected');
  const bug = W.toTask(W.parseItem(JSON.stringify({ id: 5, fields: { 'System.Title': 'Crash', 'System.WorkItemType': 'Bug', 'Microsoft.VSTS.TCM.ReproSteps': '<div>1. open<br>2. save</div>' } })));
  assert.match(bug, /Bug AB#5: Crash\n\nSteps to reproduce:\n1\. open\n2\. save/);
  const long = W.toTask({ id: 1, title: 't', type: 'Task', description: 'word '.repeat(5000), url: 'u' }, { max: 200 });
  assert.ok(long.length < 400 && /shortened/.test(long));
  assert.throws(() => W.parseItem('null'), /not found/);
});

test('explain: the failures people actually hit get one clear instruction', () => {
  assert.match(W.explain({ code: 'ENOENT' }), /Azure CLI/);
  assert.match(W.explain({ stderr: "ERROR: 'boards' is misspelled or not recognized by the system." }), /az extension add --name azure-devops/);
  assert.match(W.explain({ stderr: "ERROR: Please run 'az login' to setup account." }), /az login/);
  assert.match(W.explain({ stderr: 'TF400813: The user is not authorized to access this resource.' }), /az login/);
  assert.equal(W.explain({ stderr: 'something\nelse broke' }), 'something else broke');
});

test('list / show: run az with the organization and project, argument by argument (fake az)', async () => {
  const root = repo(AZ);
  const calls = [];
  const exec = async (bin, args) => { calls.push([bin, args]); return { stdout: args[1] === 'query' ? JSON.stringify([{ id: 12, fields: { 'System.Title': 'T', 'System.WorkItemType': 'Bug', 'System.State': 'New' } }]) : JSON.stringify({ id: 12, fields: { 'System.Title': 'T', 'System.WorkItemType': 'Bug', 'System.Description': '<p>d</p>' } }) }; };
  const l = await W.list(root, { scope: 'mine', exec });
  assert.equal(l.items[0].id, 12);
  assert.deepEqual(calls[0][1].slice(0, 2), ['boards', 'query']);
  assert.equal(calls[0][1][calls[0][1].indexOf('--organization') + 1], 'https://dev.azure.com/acme');
  assert.equal(calls[0][1][calls[0][1].indexOf('--project') + 1], 'Shop App');
  const s = await W.show(root, '12', { exec });
  assert.match(s.text, /Bug AB#12: T\n\nd/);
  assert.equal(calls[1][1][calls[1][1].indexOf('--id') + 1], '12');
  assert.match((await W.show(root, '12; rm -rf', { exec })).error, /Not a work item number/);
  assert.match((await W.show(root, '-1', { exec })).error, /Not a work item number/);
  // errors become sentences
  assert.match((await W.list(root, { exec: async () => { const e = new Error('x'); e.code = 'ENOENT'; throw e; } })).error, /not installed/);
  assert.match((await W.list(repo('https://github.com/a/b.git'), { exec })).error, /No Azure DevOps project/);
  assert.equal((await W.list(repo('https://github.com/a/b.git'), { exec, cfg: { workItems: { orgUrl: 'https://dev.azure.com/o', project: 'P' } } })).items.length, 1);
});

test('regression: on Windows az runs through cmd.exe, so every argument is quoted (a query or title with spaces fell apart)', () => {
  assert.equal(pr.quoteWin('boards'), 'boards');
  assert.equal(pr.quoteWin('SELECT [System.Id] FROM WorkItems'), '"SELECT [System.Id] FROM WorkItems"');
  assert.equal(pr.quoteWin('Fix: add VAT & invoice'), '"Fix: add VAT & invoice"');
  assert.equal(pr.quoteWin(''), '""');
  assert.equal(pr.quoteWin('https://dev.azure.com/acme'), 'https://dev.azure.com/acme');
  assert.throws(() => pr.quoteWin('say "hi"'), /cmd\.exe/);
  assert.throws(() => pr.quoteWin('100%'), /cmd\.exe/);
});

test('comment: az work-item update --discussion with the organization, argument by argument; bad ids and empty text refused', async () => {
  const root = repo(AZ);
  const calls = [];
  const exec = async (bin, args) => { calls.push([bin, args]); return { stdout: '' }; };
  assert.deepEqual(await W.comment(root, '12', 'Done: all steps passed', { exec }), { ok: true });
  assert.deepEqual(calls[0], ['az', ['boards', 'work-item', 'update', '--id', '12', '--discussion', 'Done: all steps passed', '--organization', 'https://dev.azure.com/acme', '--output', 'none']]);
  assert.match((await W.comment(root, '12; rm', 'x', { exec })).error, /Not a work item number/);
  assert.match((await W.comment(root, '12', '   ', { exec })).error, /Nothing to post/);
  assert.match((await W.comment(root, '12', 'x', { exec: async () => { const e = new Error('x'); e.code = 'ENOENT'; throw e; } })).error, /not installed/);
});
