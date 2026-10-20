'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { scanFile, SpringIndex, joinPath } = require('../src/core/springmap');
const { tmpdir, write } = require('./helpers');

const CTRL = `package demo;

import org.springframework.web.bind.annotation.*;

@RestController
@RequestMapping("/api/users")
public class UserController extends BaseController implements Marker {

    @GetMapping
    public List<User> all() { return List.of(); }

    @GetMapping("/{id}")
    public User one(@PathVariable Long id) { return null; }

    @PostMapping(
        value = "/new",
        consumes = "application/json")
    public User create(@RequestBody User u) { return u; }

    @RequestMapping(path = {"/a", "/b"}, method = {RequestMethod.PUT, RequestMethod.PATCH})
    public void multi() {}

    @RequestMapping("/any")
    void anything() {}

    @DeleteMapping("/{id}") public void del(@PathVariable Long id) {}
}
`;

test('endpoints: class base path, shorthand and RequestMapping, multi-line, several paths and methods', () => {
  const s = scanFile('UserController.java', CTRL);
  const key = (e) => `${e.method} ${e.path} ${e.handler}`;
  assert.deepStrictEqual(s.endpoints.map(key), [
    'GET /api/users all', 'GET /api/users/{id} one', 'POST /api/users/new create',
    'PUT /api/users/a multi', 'PUT /api/users/b multi', 'PATCH /api/users/a multi', 'PATCH /api/users/b multi',
    'ANY /api/users/any anything', 'DELETE /api/users/{id} del']);
  assert.strictEqual(s.endpoints[0].line, 10); // the handler line, where the lens goes
  assert.deepStrictEqual(s.components.map((c) => [c.name, c.stereotype]), [['UserController', 'RestController']]);
  assert.deepStrictEqual(s.types[0].supers.sort(), ['BaseController', 'Marker']);
});

test('beans: method name, explicit name, return type', () => {
  const s = scanFile('Cfg.java', `@Configuration
public class Cfg {
    @Bean
    public DataSource dataSource() { return null; }

    @Bean("custom")
    RestTemplate rest() { return null; }

    @Bean(name = "other") public Foo<Bar> foo() { return null; }
}`);
  assert.deepStrictEqual(s.beans.map((b) => [b.name, b.type]), [['dataSource', 'DataSource'], ['custom', 'RestTemplate'], ['other', 'Foo']]);
  assert.deepStrictEqual(s.components.map((c) => c.stereotype), ['Configuration']);
});

test('interfaces and implementations (Java extends/implements, Kotlin supertypes)', () => {
  const j = scanFile('A.java', 'public interface Repo extends Base<User>, Other {\n}\nclass Impl implements Repo, Serializable {\n}\nabstract class Abs extends Impl {\n}\nenum E implements Repo { A }\nrecord R(int x) implements Repo {}');
  assert.deepStrictEqual(j.types.map((t) => [t.name, t.kind, t.supers]), [['Repo', 'interface', ['Base', 'Other']], ['Impl', 'class', ['Repo', 'Serializable']], ['Abs', 'class', ['Impl']], ['E', 'enum', ['Repo']], ['R', 'record', ['Repo']]]);
  const k = scanFile('B.kt', 'interface Svc\nclass SvcImpl(val x: Int) : Svc, Closeable {\n}\nopen class K : SvcImpl(1)\n');
  assert.deepStrictEqual(k.types.map((t) => [t.name, t.supers]), [['Svc', []], ['SvcImpl', ['Svc', 'Closeable']], ['K', ['SvcImpl']]]);
});

test('Kotlin controller', () => {
  const s = scanFile('C.kt', `@RestController
@RequestMapping("/kt")
class C {
    @GetMapping("/x")
    fun x(): String = "x"
    @Bean
    fun b(): Thing = Thing()
}`);
  assert.deepStrictEqual(s.endpoints.map((e) => `${e.method} ${e.path}`), ['GET /kt/x']);
  assert.deepStrictEqual(s.beans.map((b) => [b.name, b.type]), [['b', 'Thing']]);
});

test('annotations that are not mappings, comments and strings do not create endpoints', () => {
  const s = scanFile('D.java', `public class D {
    // @GetMapping("/commented")
    @Deprecated
    public void plain() {}
    @Autowired private Foo foo;
    @GetMapping("/real")
    public String real() { return "@PostMapping(\\"/nope\\")"; }
}`);
  assert.deepStrictEqual(s.endpoints.map((e) => e.path), ['/real']);
});

test('joinPath normalises slashes', () => {
  assert.strictEqual(joinPath('/api/', '/x/'), '/api/x');
  assert.strictEqual(joinPath('', ''), '/');
  assert.strictEqual(joinPath('api', 'x'), '/api/x');
});

test('SpringIndex: overview, implementations, lens info, refresh after a change', async () => {
  const root = tmpdir();
  write(root, 'src/UserController.java', CTRL);
  write(root, 'src/Repo.java', 'public interface Repo {\n}\n');
  write(root, 'src/A.java', 'public class A implements Repo {\n}\n');
  write(root, 'src/B.java', 'public class B implements Repo {\n}\n');
  write(root, 'src/readme.md', '@GetMapping("/no")');
  const idx = new SpringIndex(root, async () => ['src/UserController.java', 'src/Repo.java', 'src/A.java', 'src/B.java', 'src/readme.md']);
  await idx.refresh();
  const ov = idx.overview();
  assert.strictEqual(ov.endpoints.length, 9);
  assert.ok(!ov.endpoints.some((e) => e.path === '/no'));
  assert.deepStrictEqual(idx.implementations('Repo').map((x) => x.name), ['A', 'B']);
  const li = idx.lensInfo('src/Repo.java');
  assert.strictEqual(li.impls[1].total, 2);
  assert.strictEqual(idx.lensInfo('src/missing.java').endpoints.length, 0);
  await new Promise((r) => setTimeout(r, 20));
  write(root, 'src/C.java', 'public class C extends A {\n}\nclass Repo2 implements Repo {}\n');
  idx.listFiles = async () => ['src/UserController.java', 'src/Repo.java', 'src/A.java', 'src/B.java', 'src/C.java'];
  idx.invalidate(); await idx.refresh();
  assert.deepStrictEqual(idx.implementations('Repo').map((x) => x.name), ['A', 'B', 'Repo2']);
  assert.deepStrictEqual(idx.implementations('A').map((x) => x.name), ['C']);
});
