'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const S = require('../src/core/spring');

function project(files) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bazinga-spring-'));
  for (const [f, c] of Object.entries(files)) { fs.mkdirSync(path.dirname(path.join(dir, f)), { recursive: true }); fs.writeFileSync(path.join(dir, f), c); }
  return dir;
}
const APP = 'package be.acme.shop;\n\n@SpringBootApplication\npublic class ShopApplication {\n  public static void main(String[] a) {}\n}\n';

test('detects a Maven Spring Boot app, its main class, wrapper and profiles', () => {
  const dir = project({
    'pom.xml': '<project><artifactId>spring-boot-starter</artifactId></project>',
    'mvnw': '', 'src/main/java/be/acme/shop/ShopApplication.java': APP,
    'src/main/resources/application.yml': '', 'src/main/resources/application-dev.yml': '', 'src/main/resources/application-prod.properties': '',
  });
  const { modules } = S.detect(dir);
  assert.strictEqual(modules.length, 1);
  const m = modules[0];
  assert.deepStrictEqual([m.tool, m.wrapper, m.spring, m.dir], ['maven', true, true, '']);
  assert.deepStrictEqual(m.apps.map((a) => a.mainClass), ['be.acme.shop.ShopApplication']);
  assert.deepStrictEqual(m.profiles, ['dev', 'prod']); // application.yml itself is not a profile
});

test('detects Gradle (kts) modules in subfolders and ignores build output / node_modules', () => {
  const dir = project({
    'api/build.gradle.kts': 'plugins { id("org.springframework.boot") }', 'api/gradlew': '',
    'api/src/main/kotlin/x/Api.kt': 'package x\n@SpringBootApplication\nclass Api\n',
    'target/classes/pom.xml': '', 'node_modules/foo/pom.xml': '', 'lib/pom.xml': '<project/>',
  });
  const dirs = S.detect(dir).modules.map((m) => `${m.dir}:${m.tool}:${m.spring}`).sort();
  assert.deepStrictEqual(dirs, ['api:gradle:true', 'lib:maven:false']);
});

test('run command: wrapper vs plain, profile quoted per shell (PowerShell splits unquoted -Da.b=c)', () => {
  const mvn = { tool: 'maven', wrapper: true };
  assert.strictEqual(S.runCommand(mvn, { shellKind: 'posix' }), './mvnw spring-boot:run');
  assert.strictEqual(S.runCommand(mvn, { profile: 'dev', shellKind: 'posix' }), `./mvnw spring-boot:run '-Dspring-boot.run.profiles=dev'`);
  assert.strictEqual(S.runCommand(mvn, { profile: 'dev,local', shellKind: 'powershell' }), `.\\mvnw spring-boot:run '-Dspring-boot.run.profiles=dev,local'`);
  assert.strictEqual(S.runCommand({ tool: 'maven', wrapper: false }, { profile: 'x', shellKind: 'cmd' }), 'mvn spring-boot:run "-Dspring-boot.run.profiles=x"');
  assert.strictEqual(S.runCommand({ tool: 'gradle', wrapper: true }, { profile: 'dev', shellKind: 'posix' }), `./gradlew bootRun --args='--spring.profiles.active=dev'`);
  assert.strictEqual(S.runCommand({ tool: 'gradle', wrapper: false }, { shellKind: 'posix' }), 'gradle bootRun');
});

test('a profile that could inject shell syntax is rejected', () => {
  for (const bad of ['dev; rm -rf /', 'a b', '$(x)', "dev'", 'dev&&calc', '`x`']) {
    assert.throws(() => S.runCommand({ tool: 'maven', wrapper: false }, { profile: bad }), /valid Spring profile/, bad);
  }
});

test('task commands', () => {
  assert.strictEqual(S.taskCommand({ tool: 'maven', wrapper: false }, 'Package (skip tests)'), 'mvn package -DskipTests');
  assert.strictEqual(S.taskCommand({ tool: 'maven', wrapper: true }, 'Dependency tree', { shellKind: 'powershell' }), `.\\mvnw 'dependency:tree'`.replace(`'dependency:tree'`, 'dependency:tree'));
  assert.strictEqual(S.taskCommand({ tool: 'gradle', wrapper: true }, 'Build (skip tests)'), './gradlew build -x test');
  assert.throws(() => S.taskCommand({ tool: 'maven' }, 'rm -rf'), /Unknown task/);
});

test('env text: parsed, comments skipped, bad names rejected', () => {
  assert.deepStrictEqual(S.parseEnv('A=1\n# c\n\nDB_URL = jdbc:x=y\r\n'), { A: '1', DB_URL: 'jdbc:x=y' });
  assert.throws(() => S.parseEnv('1BAD=x'), /valid environment variable/);
  assert.throws(() => S.parseEnv('novalue'), /NAME=value/);
});

// ---------------------------------------------------------------- JVM arguments, debug port
test('maven: debug port and JVM args go into one quoted -Dspring-boot.run.jvmArguments', () => {
  const mvn = { tool: 'maven', wrapper: true };
  assert.strictEqual(S.runCommand(mvn, { debugPort: 5005, shellKind: 'posix' }),
    `./mvnw spring-boot:run '-Dspring-boot.run.jvmArguments=-agentlib:jdwp=transport=dt_socket,server=y,suspend=n,address=*:5005'`);
  assert.strictEqual(S.runCommand(mvn, { profile: 'dev', jvmArgs: '-Xmx512m -Dfoo=bar', shellKind: 'powershell' }),
    `.\\mvnw spring-boot:run '-Dspring-boot.run.profiles=dev' '-Dspring-boot.run.jvmArguments=-Xmx512m -Dfoo=bar'`);
  assert.strictEqual(S.runCommand(mvn, { debugPort: '5006', jvmArgs: '-Xms64m', shellKind: 'cmd' }),
    `.\\mvnw spring-boot:run "-Dspring-boot.run.jvmArguments=-agentlib:jdwp=transport=dt_socket,server=y,suspend=n,address=*:5006 -Xms64m"`);
});

test('gradle: --debug-jvm only on 5005; JVM args are refused with an explanation', () => {
  const g = { tool: 'gradle', wrapper: false };
  assert.strictEqual(S.runCommand(g, { debugPort: 5005, profile: 'dev' }), `gradle bootRun --debug-jvm --args='--spring.profiles.active=dev'`);
  assert.throws(() => S.runCommand(g, { debugPort: 6000 }), /5005/);
  assert.throws(() => S.runCommand(g, { jvmArgs: '-Xmx1g' }), /build\.gradle/);
});

test('JVM args and ports that could break out of the argument are rejected', () => {
  const mvn = { tool: 'maven', wrapper: false };
  for (const bad of ["-Dx='y'", '-Dx="y"', '-Dx=$(id)', '-Dx=`id`', '-Xmx1g; calc', '-Dx=a&b', '-Dx=a|b', '-Dx=a>b', '-Dx=%PATH%\n']) assert.throws(() => S.runCommand(mvn, { jvmArgs: bad }), /JVM arguments may only/, bad);
  for (const bad of [80, 70000, 'abc', 5005.5, -1]) assert.throws(() => S.runCommand(mvn, { debugPort: bad }), /Debug port/, String(bad));
  assert.strictEqual(S.checkDebugPort(''), 0); assert.strictEqual(S.checkDebugPort(undefined), 0);
});
